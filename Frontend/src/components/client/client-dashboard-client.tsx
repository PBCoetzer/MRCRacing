"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Coins,
  CreditCard,
  Eye,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatCoins, formatRaceDateTime } from "@/lib/racing/format";
import type {
  MeetingBetOption,
  RaceEntry,
  RaceFixture,
  RaceMeeting,
  RaceTipSelection,
  TipCard,
  TipCardMultiple,
  TipCardMultipleSelection,
  TipsterPackage,
  TipsterProfile,
} from "@/lib/racing/types";

type PurchaseRow = {
  id: string;
  purchase_type: "meeting" | "subscription";
  tip_card_id: string | null;
  tipster_package_id: string | null;
  gross_coins: number;
  status: "active" | "refunded" | "disputed";
  created_at: string;
};

type SubscriptionRow = {
  id: string;
  tipster_id: string;
  package_id: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "expired" | "refunded";
};

type EntitlementRow = {
  id: string;
  tip_card_id: string;
  source_type: "meeting" | "subscription";
  revoked_at: string | null;
};

type DisputeRow = {
  id: string;
  purchase_id: string;
  status: "open" | "approved" | "rejected";
  reason: string;
  created_at: string;
};

type WalletRow = {
  balance: number;
};

function messageFrom(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

export function ClientDashboardClient() {
  const [loadedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [walletBalance, setWalletBalance] = useState(0);
  const [cards, setCards] = useState<TipCard[]>([]);
  const [meetings, setMeetings] = useState<RaceMeeting[]>([]);
  const [tipsters, setTipsters] = useState<TipsterProfile[]>([]);
  const [packages, setPackages] = useState<TipsterPackage[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [fixtures, setFixtures] = useState<RaceFixture[]>([]);
  const [entries, setEntries] = useState<RaceEntry[]>([]);
  const [raceSelections, setRaceSelections] = useState<RaceTipSelection[]>([]);
  const [multiples, setMultiples] = useState<TipCardMultiple[]>([]);
  const [multipleSelections, setMultipleSelections] = useState<TipCardMultipleSelection[]>([]);
  const [betOptions, setBetOptions] = useState<MeetingBetOption[]>([]);
  const [disputeReasons, setDisputeReasons] = useState<Record<string, string>>({});

  const loadDashboard = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(userError?.message ?? "Please sign in again.");
      }

      const [
        walletResult,
        cardResult,
        meetingResult,
        tipsterResult,
        packageResult,
        purchaseResult,
        subscriptionResult,
        entitlementResult,
        disputeResult,
      ] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("tip_cards")
          .select("id,tipster_id,meeting_id,title,summary,coin_price,status,revision,listed_at,published_at,voided_at,updated_at")
          .in("status", ["coming_soon", "published"])
          .order("updated_at", { ascending: false }),
        supabase
          .from("race_meetings")
          .select("id,venue,country_code,meeting_date,first_race_at,last_race_at,status,is_test,source_name,source_url")
          .order("first_race_at"),
        supabase
          .from("tipsters")
          .select("id,user_id,display_name,biography,is_verified,commission_rate_override")
          .eq("is_verified", true),
        supabase
          .from("tipster_packages")
          .select("id,tipster_id,name,duration_months,coin_price,is_active,created_at")
          .eq("is_active", true)
          .order("duration_months"),
        supabase
          .from("content_purchases")
          .select("id,purchase_type,tip_card_id,tipster_package_id,gross_coins,status,created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("tipster_subscriptions")
          .select("id,tipster_id,package_id,starts_at,ends_at,status")
          .order("created_at", { ascending: false }),
        supabase
          .from("tip_card_entitlements")
          .select("id,tip_card_id,source_type,revoked_at")
          .is("revoked_at", null),
        supabase
          .from("purchase_disputes")
          .select("id,purchase_id,status,reason,created_at")
          .order("created_at", { ascending: false }),
      ]);

      const firstError =
        walletResult.error ??
        cardResult.error ??
        meetingResult.error ??
        tipsterResult.error ??
        packageResult.error ??
        purchaseResult.error ??
        subscriptionResult.error ??
        entitlementResult.error ??
        disputeResult.error;

      if (firstError) {
        throw firstError;
      }

      const loadedCards = (cardResult.data ?? []) as TipCard[];
      const loadedMeetings = (meetingResult.data ?? []) as RaceMeeting[];
      const loadedEntitlements = (entitlementResult.data ?? []) as EntitlementRow[];
      const accessibleCardIds = new Set(loadedEntitlements.map((item) => item.tip_card_id));
      const accessibleCards = loadedCards.filter(
        (tipCard) => tipCard.status === "published" && accessibleCardIds.has(tipCard.id),
      );
      const accessibleMeetingIds = [...new Set(accessibleCards.map((tipCard) => tipCard.meeting_id))];

      let loadedFixtures: RaceFixture[] = [];
      let loadedEntries: RaceEntry[] = [];
      let loadedRaceSelections: RaceTipSelection[] = [];
      let loadedMultiples: TipCardMultiple[] = [];
      let loadedMultipleSelections: TipCardMultipleSelection[] = [];
      let loadedOptions: MeetingBetOption[] = [];

      if (accessibleMeetingIds.length) {
        const { data: fixtureData, error: fixtureError } = await supabase
          .from("fixtures")
          .select("id,meeting_id,race_number,title,venue,starts_at,distance_m,race_class,status,result_summary")
          .in("meeting_id", accessibleMeetingIds)
          .order("race_number");

        if (fixtureError) {
          throw fixtureError;
        }

        loadedFixtures = (fixtureData ?? []) as RaceFixture[];
      }

      if (accessibleCards.length) {
        const cardIds = accessibleCards.map((tipCard) => tipCard.id);
        const [raceResult, multipleResult, optionResult] = await Promise.all([
          supabase
            .from("race_tip_selections")
            .select("id,tip_card_id,fixture_id,winner_entry_id,place_entry_id,comments")
            .in("tip_card_id", cardIds),
          supabase
            .from("tip_card_multiples")
            .select("id,tip_card_id,bet_option_id,custom_name,comments")
            .in("tip_card_id", cardIds),
          supabase
            .from("meeting_bet_options")
            .select("id,meeting_id,bet_type,display_name,cutoff_at,leg_count,sort_order")
            .in("meeting_id", accessibleMeetingIds),
        ]);

        if (raceResult.error || multipleResult.error || optionResult.error) {
          throw raceResult.error ?? multipleResult.error ?? optionResult.error;
        }

        loadedRaceSelections = (raceResult.data ?? []) as RaceTipSelection[];
        loadedMultiples = (multipleResult.data ?? []) as TipCardMultiple[];
        loadedOptions = (optionResult.data ?? []) as MeetingBetOption[];
      }

      if (loadedFixtures.length) {
        const { data: entryData, error: entryError } = await supabase
          .from("race_entries")
          .select("id,fixture_id,saddle_number,horse_name,jockey_name,trainer_name,draw,odds,status,result_position")
          .in("fixture_id", loadedFixtures.map((fixture) => fixture.id))
          .order("saddle_number");

        if (entryError) {
          throw entryError;
        }

        loadedEntries = (entryData ?? []) as RaceEntry[];
      }

      if (loadedMultiples.length) {
        const { data: selectionData, error: selectionError } = await supabase
          .from("tip_card_multiple_selections")
          .select("multiple_id,leg_number,fixture_id,entry_id")
          .in("multiple_id", loadedMultiples.map((multiple) => multiple.id));

        if (selectionError) {
          throw selectionError;
        }

        loadedMultipleSelections = (selectionData ?? []) as TipCardMultipleSelection[];
      }

      setWalletBalance(Number((walletResult.data as WalletRow | null)?.balance ?? 0));
      setCards(loadedCards);
      setMeetings(loadedMeetings);
      setTipsters((tipsterResult.data ?? []) as TipsterProfile[]);
      setPackages((packageResult.data ?? []) as TipsterPackage[]);
      setPurchases((purchaseResult.data ?? []) as PurchaseRow[]);
      setSubscriptions((subscriptionResult.data ?? []) as SubscriptionRow[]);
      setEntitlements(loadedEntitlements);
      setDisputes((disputeResult.data ?? []) as DisputeRow[]);
      setFixtures(loadedFixtures);
      setEntries(loadedEntries);
      setRaceSelections(loadedRaceSelections);
      setMultiples(loadedMultiples);
      setMultipleSelections(loadedMultipleSelections);
      setBetOptions(loadedOptions);
    } catch (loadError) {
      setError(messageFrom(loadError, "Could not load the client marketplace."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDashboard();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDashboard]);

  const meetingById = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.id, meeting])),
    [meetings],
  );
  const tipsterById = useMemo(
    () => new Map(tipsters.map((tipster) => [tipster.id, tipster])),
    [tipsters],
  );
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const fixtureById = useMemo(
    () => new Map(fixtures.map((fixture) => [fixture.id, fixture])),
    [fixtures],
  );
  const optionById = useMemo(
    () => new Map(betOptions.map((option) => [option.id, option])),
    [betOptions],
  );
  const entitlementIds = useMemo(
    () => new Set(entitlements.map((item) => item.tip_card_id)),
    [entitlements],
  );
  const activeSubscriptionTipsters = useMemo(
    () => new Set(
      subscriptions
        .filter((subscription) =>
          subscription.status === "active" &&
          new Date(subscription.ends_at).getTime() > loadedAt,
        )
        .map((subscription) => subscription.tipster_id),
    ),
    [loadedAt, subscriptions],
  );

  async function purchaseMeeting(tipCard: TipCard) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessingId(tipCard.id);
    setError("");
    setMessage("");

    try {
      const { error: purchaseError } = await supabase.rpc("purchase_meeting_card", {
        p_tip_card_id: tipCard.id,
        p_idempotency_key: crypto.randomUUID(),
      });

      if (purchaseError) {
        throw purchaseError;
      }

      setMessage(`The complete ${tipCard.title} card is now linked to your account.`);
      await loadDashboard();
    } catch (purchaseError) {
      setError(messageFrom(purchaseError, "The meeting card could not be purchased."));
    } finally {
      setProcessingId("");
    }
  }

  async function purchaseSubscription(tipsterPackage: TipsterPackage) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    setProcessingId(tipsterPackage.id);
    setError("");
    setMessage("");

    try {
      const { error: purchaseError } = await supabase.rpc("purchase_tipster_subscription", {
        p_package_id: tipsterPackage.id,
        p_idempotency_key: crypto.randomUUID(),
      });

      if (purchaseError) {
        throw purchaseError;
      }

      setMessage("Subscription access starts immediately and will not auto-renew.");
      await loadDashboard();
    } catch (purchaseError) {
      setError(messageFrom(purchaseError, "The subscription could not be purchased."));
    } finally {
      setProcessingId("");
    }
  }

  async function submitDispute(purchaseId: string) {
    const supabase = createClient();
    const reason = disputeReasons[purchaseId]?.trim() ?? "";

    if (!supabase) {
      return;
    }

    if (reason.length < 10) {
      setError("Please explain the dispute in at least ten characters.");
      return;
    }

    setProcessingId(purchaseId);
    setError("");
    setMessage("");

    try {
      const { error: disputeError } = await supabase.rpc("request_purchase_dispute", {
        p_purchase_id: purchaseId,
        p_reason: reason,
      });

      if (disputeError) {
        throw disputeError;
      }

      setDisputeReasons((current) => ({ ...current, [purchaseId]: "" }));
      setMessage("Your dispute was submitted for administrator review.");
      await loadDashboard();
    } catch (disputeError) {
      setError(messageFrom(disputeError, "The dispute could not be submitted."));
    } finally {
      setProcessingId("");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-52 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin text-primary" />
          Loading wallet, cards, and subscriptions…
        </CardContent>
      </Card>
    );
  }

  const accessibleCards = cards.filter(
    (tipCard) => tipCard.status === "published" && entitlementIds.has(tipCard.id),
  );

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Client action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Access updated</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Coin balance", value: walletBalance, icon: Coins },
          { label: "Meeting access", value: entitlements.length, icon: TicketCheck },
          { label: "Active subscriptions", value: activeSubscriptionTipsters.size, icon: ShieldCheck },
          { label: "Open disputes", value: disputes.filter((item) => item.status === "open").length, icon: Bell },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="flex items-center gap-2 font-mono text-3xl">
                <stat.icon className="size-5 text-primary" />
                {stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Meeting card marketplace</CardTitle>
            <CardDescription>
              A one-off purchase unlocks the entire venue/date card. Coming Soon cards support pre-purchase.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadDashboard()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {cards.map((tipCard) => {
            const meeting = meetingById.get(tipCard.meeting_id);
            const tipster = tipsterById.get(tipCard.tipster_id);
            const entitled = entitlementIds.has(tipCard.id);

            return (
              <div key={tipCard.id} className="rounded-lg border bg-background/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={tipCard.status === "published" ? "default" : "secondary"}>
                    {tipCard.status.replace("_", " ")}
                  </Badge>
                  {meeting?.is_test ? <Badge variant="outline">Private test</Badge> : null}
                  {entitled ? <Badge variant="outline">Purchased</Badge> : null}
                </div>
                <h3 className="mt-3 font-heading text-xl text-white">{tipCard.title}</h3>
                <p className="mt-1 text-sm text-brand-cyan">{tipster?.display_name ?? "Verified tipster"}</p>
                <p className="mt-3 text-sm text-muted-foreground">{tipCard.summary || "Premium meeting analysis."}</p>
                <p className="mt-3 text-sm">
                  {meeting ? `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}` : "Meeting details unavailable"}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono font-semibold">{formatCoins(tipCard.coin_price)}</span>
                  {entitled ? (
                    <Badge>
                      <Eye className="size-3" />
                      Access below
                    </Badge>
                  ) : (
                    <Button
                      disabled={processingId === tipCard.id}
                      type="button"
                      onClick={() => void purchaseMeeting(tipCard)}
                    >
                      {processingId === tipCard.id ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                      Unlock meeting
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!cards.length ? (
            <p className="text-sm text-muted-foreground">No cards are listed for sale yet.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tipster subscriptions</CardTitle>
          <CardDescription>
            Subscriptions belong to one tipster, begin immediately, and expire after the selected calendar period.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {packages.map((tipsterPackage) => {
            const tipster = tipsterById.get(tipsterPackage.tipster_id);
            const active = activeSubscriptionTipsters.has(tipsterPackage.tipster_id);

            return (
              <div key={tipsterPackage.id} className="rounded-lg border p-4">
                <Badge variant={active ? "default" : "secondary"}>
                  {tipsterPackage.duration_months} month{tipsterPackage.duration_months > 1 ? "s" : ""}
                </Badge>
                <h3 className="mt-3 font-semibold">{tipster?.display_name ?? "Verified tipster"}</h3>
                <p className="mt-2 font-mono text-xl">{formatCoins(tipsterPackage.coin_price)}</p>
                <Button
                  className="mt-4 w-full"
                  disabled={active || processingId === tipsterPackage.id}
                  type="button"
                  variant={active ? "outline" : "default"}
                  onClick={() => void purchaseSubscription(tipsterPackage)}
                >
                  {processingId === tipsterPackage.id ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  {active ? "Subscription active" : "Subscribe"}
                </Button>
              </div>
            );
          })}
          {!packages.length ? (
            <p className="text-sm text-muted-foreground">No subscription packages are active.</p>
          ) : null}
        </CardContent>
      </Card>

      <div id="unlocked-tips" className="scroll-mt-24 space-y-4">
        <div>
          <h2 className="font-heading text-2xl text-white">Your unlocked meeting tips</h2>
          <p className="text-sm text-muted-foreground">
            Premium selections are returned by Supabase only when your entitlement is active.
          </p>
        </div>
        {accessibleCards.map((tipCard) => {
          const meeting = meetingById.get(tipCard.meeting_id);
          const cardFixtures = fixtures.filter((fixture) => fixture.meeting_id === tipCard.meeting_id);
          const cardRaceSelections = raceSelections.filter((selection) => selection.tip_card_id === tipCard.id);
          const cardMultiples = multiples.filter((multiple) => multiple.tip_card_id === tipCard.id);

          return (
            <Card key={tipCard.id} className="border-brand-cyan/35">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Published</Badge>
                  <Badge variant="outline">Revision {tipCard.revision}</Badge>
                </div>
                <CardTitle className="font-heading text-2xl text-white">{tipCard.title}</CardTitle>
                <CardDescription>
                  {meeting ? `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-3 lg:grid-cols-2">
                  {cardFixtures.map((fixture) => {
                    const selection = cardRaceSelections.find((item) => item.fixture_id === fixture.id);
                    const winner = selection?.winner_entry_id ? entryById.get(selection.winner_entry_id) : null;
                    const place = selection?.place_entry_id ? entryById.get(selection.place_entry_id) : null;

                    return (
                      <div key={fixture.id} className="rounded-lg border bg-background/40 p-4">
                        <p className="font-semibold">Race {fixture.race_number}: {fixture.title}</p>
                        <p className="text-xs text-muted-foreground">{formatRaceDateTime(fixture.starts_at)}</p>
                        <dl className="mt-3 grid gap-2 text-sm">
                          <div><dt className="text-muted-foreground">Winner</dt><dd>{winner ? `${winner.saddle_number}. ${winner.horse_name}` : "No selection"}</dd></div>
                          <div><dt className="text-muted-foreground">Best place</dt><dd>{place ? `${place.saddle_number}. ${place.horse_name}` : "No selection"}</dd></div>
                          <div><dt className="text-muted-foreground">Comments</dt><dd>{selection?.comments || "No comments"}</dd></div>
                        </dl>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <h3 className="font-heading text-xl text-white">PA, Pick 6, Bipot, Jackpots and Other</h3>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {cardMultiples.map((multiple) => {
                      const option = optionById.get(multiple.bet_option_id);
                      const selections = multipleSelections.filter((item) => item.multiple_id === multiple.id);
                      const grouped = new Map<number, TipCardMultipleSelection[]>();

                      for (const selection of selections) {
                        grouped.set(selection.leg_number, [
                          ...(grouped.get(selection.leg_number) ?? []),
                          selection,
                        ]);
                      }

                      return (
                        <div key={multiple.id} className="rounded-lg border p-4">
                          <p className="font-semibold">{multiple.custom_name || option?.display_name || "Meeting bet"}</p>
                          <div className="mt-3 space-y-2 text-sm">
                            {[...grouped.entries()].sort(([left], [right]) => left - right).map(([legNumber, legSelections]) => {
                              const fixture = fixtureById.get(legSelections[0]?.fixture_id ?? "");
                              return (
                                <p key={legNumber}>
                                  <span className="text-muted-foreground">Leg {legNumber}{fixture ? ` / Race ${fixture.race_number}` : ""}: </span>
                                  {legSelections
                                    .map((item) => entryById.get(item.entry_id))
                                    .filter(Boolean)
                                    .map((entry) => `${entry?.saddle_number}. ${entry?.horse_name}`)
                                    .join(", ")}
                                </p>
                              );
                            })}
                          </div>
                          {multiple.comments ? <p className="mt-3 text-sm text-muted-foreground">{multiple.comments}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!accessibleCards.length ? (
          <Alert>
            <History className="size-4" />
            <AlertTitle>No published card access yet</AlertTitle>
            <AlertDescription>
              Buy a listed meeting card or subscribe to a tipster. Coming Soon purchases unlock automatically after publication.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Card id="purchases" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Purchases and disputes</CardTitle>
          <CardDescription>
            Unpublished or cancelled meeting cards refund automatically. Subscription purchases are reviewed manually.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Coins</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dispute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((purchase) => {
                const existingDispute = disputes.find((item) => item.purchase_id === purchase.id);

                return (
                  <TableRow key={purchase.id}>
                    <TableCell>{formatRaceDateTime(purchase.created_at)}</TableCell>
                    <TableCell>{purchase.purchase_type}</TableCell>
                    <TableCell>{formatCoins(purchase.gross_coins)}</TableCell>
                    <TableCell><Badge variant="outline">{purchase.status}</Badge></TableCell>
                    <TableCell>
                      {existingDispute ? (
                        <Badge variant={existingDispute.status === "rejected" ? "destructive" : "secondary"}>
                          {existingDispute.status}
                        </Badge>
                      ) : purchase.status === "active" ? (
                        <div className="flex min-w-64 gap-2">
                          <Input
                            placeholder="Reason for dispute"
                            value={disputeReasons[purchase.id] ?? ""}
                            onChange={(event) => setDisputeReasons((current) => ({
                              ...current,
                              [purchase.id]: event.target.value,
                            }))}
                          />
                          <Button
                            disabled={processingId === purchase.id}
                            type="button"
                            variant="outline"
                            onClick={() => void submitDispute(purchase.id)}
                          >
                            Submit
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!purchases.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No purchases yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
