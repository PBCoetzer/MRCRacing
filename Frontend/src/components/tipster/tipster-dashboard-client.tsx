"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Coins,
  Database,
  FilePenLine,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatCredits, formatRaceDateTime } from "@/lib/racing/format";
import { meetingCardSalesOpen } from "@/lib/racing/availability";
import type {
  RaceMeeting,
  TipCard,
  TipsterPackage,
  TipsterProfile,
} from "@/lib/racing/types";

type EarningRow = {
  id: string;
  entry_type: "sale" | "refund";
  gross_coins: number;
  platform_fee_coins: number;
  net_coins: number;
  created_at: string;
};

type PackageDraft = Record<1 | 3 | 6 | 12, string>;

type CardFixture = {
  id: string;
  meeting_id: string;
  starts_at: string;
  status: string;
  result_summary: string | null;
};

type CardOutcome = {
  tip_card_id: string;
  fixture_id: string;
  selected_winner_entry_id: string | null;
  selected_winner_position: number | null;
  winner_hit: boolean | null;
  selected_place_position: number | null;
  result_summary: string | null;
  settled_at: string;
};

const packageDurations = [1, 3, 6, 12] as const;
const emptyPackageDraft: PackageDraft = { 1: "", 3: "", 6: "", 12: "" };
const liveRefreshMs = 60_000;

function meetingLabel(meeting: RaceMeeting | undefined) {
  if (!meeting) {
    return "Meeting unavailable";
  }

  return `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}`;
}

export function TipsterDashboardClient() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [savingPackages, setSavingPackages] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tipster, setTipster] = useState<TipsterProfile | null>(null);
  const [meetings, setMeetings] = useState<RaceMeeting[]>([]);
  const [cards, setCards] = useState<TipCard[]>([]);
  const [packages, setPackages] = useState<TipsterPackage[]>([]);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [cardFixtures, setCardFixtures] = useState<CardFixture[]>([]);
  const [cardOutcomes, setCardOutcomes] = useState<CardOutcome[]>([]);
  const [recordedEarnings, setRecordedEarnings] = useState(0);
  const [packageDraft, setPackageDraft] = useState<PackageDraft>(emptyPackageDraft);
  const loadInFlight = useRef(false);

  const loadDashboard = useCallback(async (silent = false) => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    if (loadInFlight.current) {
      return;
    }

    loadInFlight.current = true;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(userError?.message ?? "Please sign in again.");
      }

      const { data: tipsterData, error: tipsterError } = await supabase
        .from("tipsters")
        .select("id,user_id,display_name,biography,is_verified,commission_rate_override")
        .eq("user_id", user.id)
        .maybeSingle();

      if (tipsterError) {
        throw tipsterError;
      }

      if (!tipsterData?.is_verified) {
        throw new Error("A verified tipster profile is required before meeting cards can be created.");
      }

      const verifiedTipster = tipsterData as TipsterProfile;
      const [
        meetingResult,
        cardResult,
        packageResult,
        earningResult,
        earningTotalResult,
      ] = await Promise.all([
        supabase
          .from("race_meetings")
          .select("id,venue,country_code,meeting_date,first_race_at,last_race_at,status,is_test,source_name,source_url")
          .order("first_race_at", { ascending: false }),
        supabase
          .from("tip_cards")
          .select("id,tipster_id,meeting_id,title,summary,coin_price,status,revision,listed_at,published_at,voided_at,updated_at")
          .eq("tipster_id", verifiedTipster.id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("tipster_packages")
          .select("id,tipster_id,name,duration_months,coin_price,is_active,created_at")
          .eq("tipster_id", verifiedTipster.id)
          .order("duration_months"),
        supabase
          .from("tipster_earnings")
          .select("id,entry_type,gross_coins,platform_fee_coins,net_coins,created_at")
          .eq("tipster_id", verifiedTipster.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.rpc("get_my_tipster_recorded_earnings"),
      ]);

      const firstError =
        meetingResult.error ??
        cardResult.error ??
        packageResult.error ??
        earningResult.error ??
        earningTotalResult.error;

      if (firstError) {
        throw firstError;
      }

      const loadedPackages = (packageResult.data ?? []) as TipsterPackage[];
      const loadedCards = (cardResult.data ?? []) as TipCard[];
      const nextDraft = { ...emptyPackageDraft };
      let loadedCardFixtures: CardFixture[] = [];
      let loadedCardOutcomes: CardOutcome[] = [];

      if (loadedCards.length) {
        const fixtureResult = await supabase
          .from("fixtures")
          .select("id,meeting_id,starts_at,status,result_summary")
          .in("meeting_id", [...new Set(loadedCards.map((card) => card.meeting_id))])
          .order("starts_at");

        if (fixtureResult.error) {
          throw fixtureResult.error;
        }

        loadedCardFixtures = (fixtureResult.data ?? []) as CardFixture[];

        const outcomeResult = await supabase
          .from("tip_card_race_outcomes")
          .select("tip_card_id,fixture_id,selected_winner_entry_id,selected_winner_position,winner_hit,selected_place_position,result_summary,settled_at")
          .in("tip_card_id", loadedCards.map((card) => card.id))
          .order("settled_at", { ascending: false });
        if (outcomeResult.error) throw outcomeResult.error;
        loadedCardOutcomes = (outcomeResult.data ?? []) as CardOutcome[];
      }

      for (const tipsterPackage of loadedPackages) {
        nextDraft[tipsterPackage.duration_months] = String(tipsterPackage.coin_price);
      }

      setTipster(verifiedTipster);
      setMeetings((meetingResult.data ?? []) as RaceMeeting[]);
      setCards(loadedCards);
      setPackages(loadedPackages);
      setEarnings((earningResult.data ?? []) as EarningRow[]);
      setCardFixtures(loadedCardFixtures);
      setCardOutcomes(loadedCardOutcomes);
      setRecordedEarnings(Number(earningTotalResult.data ?? 0));
      setPackageDraft(nextDraft);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load tipster data.");
    } finally {
      const completedAt = new Date();
      loadInFlight.current = false;
      setLastCheckedAt(completedAt.toISOString());
      setCheckedAt(completedAt.getTime());
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    const intervalId = window.setInterval(() => {
      void loadDashboard(true);
    }, liveRefreshMs);
    const handleFocus = () => void loadDashboard(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadDashboard(true);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDashboard]);

  const meetingById = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.id, meeting])),
    [meetings],
  );
  const cardMeetingIds = useMemo(() => new Set(cards.map((card) => card.meeting_id)), [cards]);
  const upcomingMeetings = meetings.filter((meeting) =>
    meetingCardSalesOpen(meeting, checkedAt),
  );
  const availableMeetings = upcomingMeetings.filter(
    (meeting) =>
      !cardMeetingIds.has(meeting.id),
  );
  const currentCards = cards.filter((card) => {
    const meeting = meetingById.get(card.meeting_id);
    return (
      !["settled", "void"].includes(card.status) &&
      Boolean(meeting && !["completed", "cancelled"].includes(meeting.status))
    );
  });
  const activePackageCount = packages.filter((item) => item.is_active).length;

  async function savePackages() {
    const supabase = createClient();

    if (!supabase || !tipster) {
      return;
    }

    setSavingPackages(true);
    setError("");
    setMessage("");

    try {
      const upserts = packageDurations.flatMap((duration) => {
        const price = Number(packageDraft[duration]);

        if (!Number.isInteger(price) || price <= 0) {
          return [];
        }

        return [{
          tipster_id: tipster.id,
          name: `${duration}-month MRC Racing access`,
          duration_months: duration,
          coin_price: price,
          is_active: true,
        }];
      });

      if (upserts.length === 0) {
        throw new Error("Enter at least one positive whole-Credit package price.");
      }

      const { error: upsertError } = await supabase
        .from("tipster_packages")
        .upsert(upserts, { onConflict: "tipster_id,duration_months" });

      if (upsertError) {
        throw upsertError;
      }

      setMessage("Subscription packages saved.");
      await loadDashboard(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save packages.");
    } finally {
      setSavingPackages(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin text-primary" />
          Loading live tipster workspace…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <ShieldCheck className="size-4" />
          <AlertTitle>Tipster workspace issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <PackageCheck className="size-4" />
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/45 px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-2 text-brand-cyan" aria-live="polite">
          {refreshing ? <RefreshCw className="size-4 animate-spin" /> : <Database className="size-4" />}
          {refreshing
            ? "Refreshing live dashboard data"
            : lastCheckedAt
              ? `Live database checked ${formatRaceDateTime(lastCheckedAt)}`
              : "Connecting to the live database"}
        </span>
        <span className="text-xs text-muted-foreground">Automatically refreshes every minute</span>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          {
            label: "Upcoming meetings",
            value: upcomingMeetings.length,
            detail: `${availableMeetings.length} still need a card`,
            icon: CalendarDays,
          },
          {
            label: "Current meeting cards",
            value: currentCards.length,
            detail: `${cards.length} total including history`,
            icon: FilePenLine,
          },
          {
            label: "Active packages",
            value: activePackageCount,
            detail: "Live subscription offers",
            icon: PackageCheck,
          },
          {
            label: "Recorded earnings",
            value: formatCredits(recordedEarnings),
            detail: "All sales and refund reversals",
            icon: Coins,
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="space-y-1">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="flex items-center gap-2 font-mono text-2xl">
                <stat.icon className="size-5 text-primary" />
                {stat.value}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{stat.detail}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Upcoming horse-racing meetings</CardTitle>
            <CardDescription>
              Create one meeting card per venue/date. Private test meetings remain hidden from public users.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" disabled={refreshing} onClick={() => void loadDashboard(true)}>
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {availableMeetings.length ? availableMeetings.map((meeting) => (
            <div key={meeting.id} className="rounded-lg border bg-background/45 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading text-lg text-white">{meeting.venue}</p>
                {meeting.is_test ? <Badge variant="secondary">Private test</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                First race {formatRaceDateTime(meeting.first_race_at)}
              </p>
              <Button asChild className="mt-4">
                <Link href={`/tipster/manage-tips/?meeting=${encodeURIComponent(meeting.id)}`}>
                  Create meeting card
                </Link>
              </Button>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">
              Every visible upcoming meeting already has a card.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your meeting cards</CardTitle>
          <CardDescription>Draft, pre-sale, publication, and revision status from Supabase.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meeting</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Winner record</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.map((card) => {
                const fixtures = cardFixtures.filter(
                  (fixture) => fixture.meeting_id === card.meeting_id,
                );
                const resultCount = fixtures.filter(
                  (fixture) => fixture.result_summary || fixture.status === "resulted",
                ).length;
                const openCount = fixtures.filter(
                  (fixture) => new Date(fixture.starts_at).getTime() > checkedAt,
                ).length;
                const outcomes = cardOutcomes.filter((outcome) => outcome.tip_card_id === card.id);
                const graded = outcomes.filter((outcome) => outcome.selected_winner_position != null);
                const hits = graded.filter((outcome) => outcome.winner_hit === true).length;
                const actionLabel =
                  openCount === 0 || (fixtures.length > 0 && resultCount === fixtures.length)
                    ? "View results"
                    : card.status === "published"
                      ? "Review / correct"
                      : "Edit tips";

                return (
                  <TableRow key={card.id}>
                    <TableCell>
                      <p className="font-semibold">{card.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {meetingLabel(meetingById.get(card.meeting_id))}
                      </p>
                      <p className="mt-1 text-xs text-brand-cyan">
                        {resultCount
                          ? `${resultCount}/${fixtures.length} results available`
                          : openCount
                            ? `${openCount}/${fixtures.length} races still open`
                            : "Meeting locked"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={["published", "settled"].includes(card.status) ? "default" : "secondary"}>
                        {card.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{card.revision}</TableCell>
                    <TableCell className="font-mono">{formatCredits(card.coin_price)}</TableCell>
                    <TableCell className="font-mono">
                      {card.status === "settled" ? `${hits}/${graded.length} hits` : `${resultCount}/${fixtures.length} results`}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline">
                        <Link href={`/tipster/manage-tips/?card=${encodeURIComponent(card.id)}`}>
                          {actionLabel}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!cards.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No meeting cards yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription packages</CardTitle>
          <CardDescription>
            Access starts immediately, uses calendar months, and never auto-renews.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {packageDurations.map((duration) => (
              <div key={duration} className="space-y-2">
                <Label htmlFor={`package-${duration}`}>{duration} month{duration > 1 ? "s" : ""}</Label>
                <Input
                  id={`package-${duration}`}
                  inputMode="numeric"
                  min={1}
                  placeholder="Credit price"
                  type="number"
                  value={packageDraft[duration]}
                  onChange={(event) => {
                    setPackageDraft((current) => ({
                      ...current,
                      [duration]: event.target.value,
                    }));
                  }}
                />
              </div>
            ))}
          </div>
          <Button type="button" disabled={savingPackages} onClick={() => void savePackages()}>
            {savingPackages ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
            Save packages
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent earnings ledger</CardTitle>
          <CardDescription>Sales and exact refund reversals are recorded for future settlement.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatRaceDateTime(entry.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant={entry.entry_type === "refund" ? "destructive" : "outline"}>
                      {entry.entry_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCredits(entry.gross_coins)}</TableCell>
                  <TableCell>{formatCredits(entry.platform_fee_coins)}</TableCell>
                  <TableCell>{formatCredits(entry.net_coins)}</TableCell>
                </TableRow>
              ))}
              {!earnings.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No earnings entries yet.
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
