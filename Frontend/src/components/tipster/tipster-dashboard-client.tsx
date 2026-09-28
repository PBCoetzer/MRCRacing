"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  FilePenLine,
  HandCoins,
  Loader2,
  PackageCheck,
  Palette,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ProfileSettingsClient } from "@/components/account/profile-settings-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatCredits, formatMeetingCardPrice, formatRaceDateTime } from "@/lib/racing/format";
import { meetingCardSalesOpen } from "@/lib/racing/availability";
import {
  defaultTipsterTheme,
  resolveTipsterTheme,
  tipsterThemeAccentStyle,
  tipsterThemeButtonStyle,
  tipsterThemeCardStyle,
  tipsterThemePanelStyle,
  type TipsterTheme,
} from "@/lib/racing/tipster-theme";
import type {
  RaceMeeting,
  TipCard,
  TipsterPackage,
  TipsterProfile,
} from "@/lib/racing/types";

type FinanceEntry = {
  id: string;
  createdAt: string;
  entryType: "sale" | "refund" | "allocation_adjustment";
  purchaseType: "meeting" | "subscription";
  purchaseStatus: string;
  sourceLabel: string;
  purchasedCredits: number;
  rewardCreditsExcluded: number;
  horseCareCredits: number;
  platformCredits: number;
  tipsterCredits: number;
  payoutRequestId: string | null;
  payoutStatus: "available" | "requested" | "paid" | "received" | "not_applicable";
  allocationVersion: string;
};

type FinancePayoutRequest = {
  requestId: string;
  status: "requested" | "paid" | "received";
  amountCredits: number;
  requestedThrough: string;
  requestedAt: string;
  paidAt: string | null;
  paymentReference: string | null;
  adminNote: string | null;
  receivedAt: string | null;
};

type TipsterFinanceDashboard = {
  policy: {
    allocationVersion: string;
    effectiveAt: string;
    horseCareRate: number;
    platformRate: number;
    tipsterRate: number;
    rewardCreditsExcluded: boolean;
  };
  summary: {
    totalEarnedCredits: number;
    availableToRequestCredits: number;
    requestedCredits: number;
    paidAwaitingConfirmationCredits: number;
    receivedCredits: number;
  };
  entries: FinanceEntry[];
  requests: FinancePayoutRequest[];
  generatedAt: string;
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
  selected_place_entry_id: string | null;
  selected_place_position: number | null;
  result_summary: string | null;
  settled_at: string;
};

const packageDurations = [1, 3, 6, 12] as const;
const emptyPackageDraft: PackageDraft = { 1: "", 3: "", 6: "", 12: "" };
const liveRefreshMs = 60_000;

type TipsterWorkspaceView =
  | "overview"
  | "meeting-cards"
  | "packages"
  | "earnings"
  | "client-theme"
  | "profile";

const tipsterWorkspaceViews = new Set<TipsterWorkspaceView>([
  "overview",
  "meeting-cards",
  "packages",
  "earnings",
  "client-theme",
  "profile",
]);

function tipsterWorkspaceViewFromLocation(): TipsterWorkspaceView {
  if (typeof window === "undefined") {
    return "overview";
  }

  if (new URLSearchParams(window.location.search).has("card")) {
    return "meeting-cards";
  }

  const hash = window.location.hash.replace(/^#/, "");
  return tipsterWorkspaceViews.has(hash as TipsterWorkspaceView)
    ? hash as TipsterWorkspaceView
    : "overview";
}

function tipsterWorkspaceViewFromEvent(event: Event): TipsterWorkspaceView | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") {
    return null;
  }

  return tipsterWorkspaceViews.has(event.detail as TipsterWorkspaceView)
    ? event.detail as TipsterWorkspaceView
    : null;
}

function meetingLabel(meeting: RaceMeeting | undefined) {
  if (!meeting) {
    return "Meeting unavailable";
  }

  return `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}`;
}

function cardSelectionWinRecord(outcomes: CardOutcome[]) {
  const gradedEntryIds = new Set<string>();
  const winningEntryIds = new Set<string>();

  for (const outcome of outcomes) {
    const selections = [
      [outcome.selected_winner_entry_id, outcome.selected_winner_position],
      [outcome.selected_place_entry_id, outcome.selected_place_position],
    ] as const;

    for (const [entryId, position] of selections) {
      if (!entryId || position == null) {
        continue;
      }

      gradedEntryIds.add(entryId);
      if (position === 1) {
        winningEntryIds.add(entryId);
      }
    }
  }

  return {
    graded: gradedEntryIds.size,
    wins: winningEntryIds.size,
  };
}

export function TipsterDashboardClient() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [savingPackages, setSavingPackages] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [confirmingPayoutId, setConfirmingPayoutId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tipster, setTipster] = useState<TipsterProfile | null>(null);
  const [meetings, setMeetings] = useState<RaceMeeting[]>([]);
  const [cards, setCards] = useState<TipCard[]>([]);
  const [packages, setPackages] = useState<TipsterPackage[]>([]);
  const [finance, setFinance] = useState<TipsterFinanceDashboard | null>(null);
  const [cardFixtures, setCardFixtures] = useState<CardFixture[]>([]);
  const [cardOutcomes, setCardOutcomes] = useState<CardOutcome[]>([]);
  const [packageDraft, setPackageDraft] = useState<PackageDraft>(emptyPackageDraft);
  const [themeDraft, setThemeDraft] = useState<TipsterTheme>(defaultTipsterTheme);
  const [meetingPageIndex, setMeetingPageIndex] = useState(0);
  const [activeView, setActiveView] = useState<TipsterWorkspaceView>("overview");
  const loadInFlight = useRef(false);
  const themeDraftTouched = useRef(false);

  useEffect(() => {
    const syncView = () => setActiveView(tipsterWorkspaceViewFromLocation());
    const syncDashboardView = (event: Event) => {
      const requestedView = tipsterWorkspaceViewFromEvent(event);
      if (requestedView) {
        setActiveView(requestedView);
      }
    };

    syncView();
    window.addEventListener("hashchange", syncView);
    window.addEventListener("mrc-dashboard-view-change", syncDashboardView);

    return () => {
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("mrc-dashboard-view-change", syncDashboardView);
    };
  }, []);

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
        .select("id,slug,user_id,display_name,biography,is_verified,is_public,commission_rate_override,theme_primary_color,theme_secondary_color,theme_surface_color")
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
        financeResult,
      ] = await Promise.all([
        supabase
          .from("race_meetings")
          .select("id,venue,country_code,meeting_date,first_race_at,last_race_at,status,is_test,source_name,source_url")
          .order("first_race_at", { ascending: true }),
        supabase
          .from("tip_cards")
          .select("id,tipster_id,meeting_id,title,summary,coin_price,status,revision,confirmed_revision_count,listed_at,published_at,voided_at,updated_at")
          .eq("tipster_id", verifiedTipster.id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("tipster_packages")
          .select("id,tipster_id,name,duration_months,coin_price,is_active,created_at")
          .eq("tipster_id", verifiedTipster.id)
          .order("duration_months"),
        supabase.rpc("get_my_tipster_finance_dashboard", { p_limit: 100 }),
      ]);

      const firstError =
        meetingResult.error ??
        cardResult.error ??
        packageResult.error ??
        financeResult.error;

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
          .select("tip_card_id,fixture_id,selected_winner_entry_id,selected_winner_position,winner_hit,selected_place_entry_id,selected_place_position,result_summary,settled_at")
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
      setFinance(financeResult.data as TipsterFinanceDashboard);
      setCardFixtures(loadedCardFixtures);
      setCardOutcomes(loadedCardOutcomes);
      setPackageDraft(nextDraft);
      if (!themeDraftTouched.current) {
        setThemeDraft(resolveTipsterTheme(verifiedTipster));
      }
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
  const availableMeetings = upcomingMeetings
    .filter((meeting) => !cardMeetingIds.has(meeting.id))
    .toSorted(
      (left, right) =>
        new Date(left.first_race_at).getTime() - new Date(right.first_race_at).getTime(),
    );
  const meetingPageCount = Math.max(1, Math.ceil(availableMeetings.length / 4));
  const activeMeetingPage = Math.min(meetingPageIndex, meetingPageCount - 1);
  const visibleAvailableMeetings = availableMeetings.slice(
    activeMeetingPage * 4,
    activeMeetingPage * 4 + 4,
  );
  const currentCards = cards.filter((card) => {
    const meeting = meetingById.get(card.meeting_id);
    return (
      !["settled", "void"].includes(card.status) &&
      Boolean(meeting && !["completed", "cancelled"].includes(meeting.status))
    );
  });
  const preparationCards = currentCards.filter((card) =>
    ["draft", "coming_soon"].includes(card.status)
  );
  const activePackageCount = packages.filter((item) => item.is_active).length;
  const overallSelectionRecord = cardSelectionWinRecord(cardOutcomes);
  const nextAvailableMeeting = availableMeetings[0];
  const latestCard = cards[0];

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

  function updateThemeColor(color: keyof TipsterTheme, value: string) {
    themeDraftTouched.current = true;
    setThemeDraft((current) => ({ ...current, [color]: value.toUpperCase() }));
  }

  async function saveTheme() {
    const supabase = createClient();

    if (!supabase || !tipster) {
      return;
    }

    setSavingTheme(true);
    setError("");
    setMessage("");

    try {
      const { error: saveError } = await supabase.rpc("update_my_tipster_theme", {
        p_primary_color: themeDraft.primary,
        p_secondary_color: themeDraft.secondary,
        p_surface_color: themeDraft.surface,
      });

      if (saveError) {
        throw saveError;
      }

      themeDraftTouched.current = false;
      setMessage("Your client-facing profile and meeting-card theme has been saved.");
      await loadDashboard(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your theme.");
    } finally {
      setSavingTheme(false);
    }
  }

  async function requestPayout() {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setRequestingPayout(true);
    setError("");
    setMessage("");

    try {
      const { data, error: requestError } = await supabase.rpc("request_my_tipster_payout");
      if (requestError) {
        throw requestError;
      }

      const result = data as { amountCredits: number };
      setMessage(`Payout requested for ${formatCredits(result.amountCredits)}. New earnings will accumulate in your available balance.`);
      await loadDashboard(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request a payout.");
    } finally {
      setRequestingPayout(false);
    }
  }

  async function confirmPayoutReceived(requestId: string) {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setConfirmingPayoutId(requestId);
    setError("");
    setMessage("");

    try {
      const { error: confirmError } = await supabase.rpc("confirm_my_tipster_payout_received", {
        p_request_id: requestId,
      });
      if (confirmError) {
        throw confirmError;
      }

      setMessage("Payment receipt confirmed. The payout remains in your permanent ledger history.");
      await loadDashboard(true);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Could not confirm the payout receipt.");
    } finally {
      setConfirmingPayoutId(null);
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

  const themedPreview = tipster
    ? {
        ...tipster,
        theme_primary_color: themeDraft.primary,
        theme_secondary_color: themeDraft.secondary,
        theme_surface_color: themeDraft.surface,
      }
    : null;
  const availableEarnings = Number(finance?.summary.availableToRequestCredits ?? 0);
  const openPayoutRequest = finance?.requests.find((request) => request.status !== "received") ?? null;

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

      <div className={activeView === "overview" ? "space-y-6" : "hidden"}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            label: "Current Period Balance",
            value: formatCredits(availableEarnings),
            detail: "Available new-period earnings not assigned to a payout",
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

      {preparationCards.length ? (
        <Card className="border-brand-cyan/45 bg-brand-cyan/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FilePenLine className="size-5 text-brand-cyan" />
              Continue Preparing Meeting Cards
            </CardTitle>
            <CardDescription>
              Private drafts are visible only to you and administrators. Saving a private draft does not
              notify clients. Publish only when the complete card is ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {preparationCards.map((draftCard) => {
              const draftMeeting = meetingById.get(draftCard.meeting_id);
              const editingOpen = meetingCardSalesOpen(draftMeeting, checkedAt);

              return (
                <article key={draftCard.id} className="rounded-xl border bg-background/45 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">{draftCard.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {meetingLabel(draftMeeting)}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {draftCard.status === "draft" ? "Private draft" : "Coming Soon"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {editingOpen
                      ? "Continue editing, save privately again, or publish publicly when ready."
                      : "The first-publication cutoff has passed. This draft remains available as a read-only record."}
                  </p>
                  <Button asChild className="mt-4 min-h-11 w-full" variant={editingOpen ? "default" : "outline"}>
                    <Link href={`/tipster/manage-tips/?card=${encodeURIComponent(draftCard.id)}`}>
                      {editingOpen ? "Continue preparing card" : "View locked draft"}
                    </Link>
                  </Button>
                </article>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Publishing Priorities</CardTitle>
            <CardDescription>Your next useful actions based on the live race and card data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {nextAvailableMeeting ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/40 p-4">
                <div>
                  <p className="font-semibold text-white">Create {nextAvailableMeeting.venue} meeting card</p>
                  <p className="text-sm text-muted-foreground">
                    First race {formatRaceDateTime(nextAvailableMeeting.first_race_at)}
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link href={`/tipster/manage-tips/?meeting=${encodeURIComponent(nextAvailableMeeting.id)}`}>
                    Create Card
                  </Link>
                </Button>
              </div>
            ) : (
              <p className="rounded-lg border bg-background/40 p-4 text-sm text-muted-foreground">
                Every visible upcoming meeting already has a card.
              </p>
            )}
            {latestCard ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/40 p-4">
                <div>
                  <p className="font-semibold text-white">Latest card: {latestCard.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {latestCard.status.replace("_", " ")} · Revision {latestCard.confirmed_revision_count}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/tipster/manage-tips/?card=${encodeURIComponent(latestCard.id)}`}>
                    Review Card
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance &amp; Business</CardTitle>
            <CardDescription>A concise view of published performance and current earnings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-background/40 p-4">
                <p className="text-sm text-muted-foreground">Selections won</p>
                <p className="mt-1 font-mono text-2xl text-white">
                  {overallSelectionRecord.wins}/{overallSelectionRecord.graded}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Graded selections in recorded results</p>
              </div>
              <div className="rounded-lg border bg-background/40 p-4">
                <p className="text-sm text-muted-foreground">Current period balance</p>
                <p className="mt-1 font-mono text-2xl text-white">{formatCredits(availableEarnings)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Available 70% earnings not assigned to a payout</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/tipster/#meeting-cards">Manage Meeting Cards</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/tipster/#earnings">View Earnings Ledger</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/tipsters/${tipster?.slug ?? ""}/`}>View Public Profile</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>

      <Card id="client-theme" className={activeView === "client-theme" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" />
            Client Theme Settings
          </CardTitle>
          <CardDescription>
            Choose the colors clients see on your public profile and meeting cards. These settings affect only your Tipster account.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            {([
              ["primary", "Primary accent"],
              ["secondary", "Secondary accent"],
              ["surface", "Card background"],
            ] as const).map(([color, label]) => (
              <div key={color} className="space-y-2">
                <Label htmlFor={`theme-${color}`}>{label}</Label>
                <div className="flex items-center gap-3 rounded-lg border bg-background/45 p-2">
                  <input
                    id={`theme-${color}`}
                    type="color"
                    value={themeDraft[color]}
                    className="h-10 w-14 cursor-pointer rounded border-0 bg-transparent p-0"
                    onChange={(event) => updateThemeColor(color, event.target.value)}
                  />
                  <span className="font-mono text-sm">{themeDraft[color]}</span>
                </div>
              </div>
            ))}
            <Button type="button" disabled={savingTheme} onClick={() => void saveTheme()}>
              {savingTheme ? <Loader2 className="size-4 animate-spin" /> : <Palette className="size-4" />}
              Save client theme
            </Button>
          </div>

          <div className="rounded-xl border p-5 text-white" style={tipsterThemePanelStyle(themedPreview)}>
            <Badge style={tipsterThemeButtonStyle(themedPreview)}>Client preview</Badge>
            <h3 className="mt-4 font-heading text-3xl">{tipster?.display_name}</h3>
            <p className="mt-2 text-sm" style={tipsterThemeAccentStyle(themedPreview)}>
              Verified tipster profile and meeting-card presentation
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-4" style={tipsterThemeCardStyle(themedPreview)}>
                <p className="font-semibold">Race 1 selection</p>
                <p className="mt-1 text-sm text-white/70">Your analysis remains clear and readable.</p>
              </div>
              <div className="rounded-lg border p-4" style={tipsterThemeCardStyle(themedPreview)}>
                <p className="font-semibold">Meeting option</p>
                <p className="mt-1 text-sm text-white/70">Accents identify your own published card.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {activeView === "profile" ? <ProfileSettingsClient /> : null}

      <Card id="meeting-cards" className={activeView === "meeting-cards" ? "scroll-mt-24" : "hidden"}>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Upcoming Horse-Racing Meetings</CardTitle>
            <CardDescription>
              Create your own independent Tipster version for each venue/date. Race facts are shared,
              but your selections, comments, price, revisions, and clients remain attached only to your card.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" disabled={refreshing} onClick={() => void loadDashboard(true)}>
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {visibleAvailableMeetings.length ? visibleAvailableMeetings.map((meeting) => (
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
                    Create my version
                  </Link>
                </Button>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground">
                Every visible upcoming meeting already has a card.
              </p>
            )}
          </div>
          {meetingPageCount > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {activeMeetingPage * 4 + 1}–{Math.min((activeMeetingPage + 1) * 4, availableMeetings.length)} of {availableMeetings.length}, soonest first
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={activeMeetingPage === 0} onClick={() => setMeetingPageIndex(Math.max(0, activeMeetingPage - 1))}>
                  <ChevronLeft className="size-4" />Previous
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={activeMeetingPage >= meetingPageCount - 1} onClick={() => setMeetingPageIndex(Math.min(meetingPageCount - 1, activeMeetingPage + 1))}>
                  Next meetings<ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className={activeView === "meeting-cards" ? "" : "hidden"}>
        <CardHeader>
          <CardTitle>Your Meeting Cards</CardTitle>
          <CardDescription>
            Only cards owned by your Tipster account appear here. Another Tipster can create a separate
            version for the same factual race meeting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
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
              const selectionWinRecord = cardSelectionWinRecord(outcomes);
              const actionLabel =
                openCount === 0 || (fixtures.length > 0 && resultCount === fixtures.length)
                  ? "View results"
                  : card.status === "published"
                    ? "Review / correct"
                    : "Edit tips";

              return (
                <article key={card.id} className="rounded-xl border bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">{card.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {meetingLabel(meetingById.get(card.meeting_id))}
                      </p>
                    </div>
                    <Badge variant={["published", "settled"].includes(card.status) ? "default" : "secondary"}>
                      {card.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Revision</dt>
                      <dd className="font-mono">{card.confirmed_revision_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Price</dt>
                      <dd className="font-mono">{formatMeetingCardPrice(card.coin_price)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Selections won</dt>
                      <dd className="font-mono">
                        {card.status === "settled"
                          ? `${selectionWinRecord.wins}/${selectionWinRecord.graded} wins`
                          : `${resultCount}/${fixtures.length} results`}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-brand-cyan">
                    {resultCount
                      ? `${resultCount}/${fixtures.length} results available`
                      : openCount
                        ? `${openCount}/${fixtures.length} races still open`
                        : "Meeting locked"}
                  </p>
                  <Button asChild variant="outline" className="mt-4 min-h-11 w-full">
                    <Link href={`/tipster/manage-tips/?card=${encodeURIComponent(card.id)}`}>
                      {actionLabel}
                    </Link>
                  </Button>
                </article>
              );
            })}
            {!cards.length ? (
              <p className="rounded-xl border bg-background/40 p-4 text-center text-sm text-muted-foreground">
                No meeting cards yet.
              </p>
            ) : null}
          </div>
          <div className="hidden md:block">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meeting</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Selections won</TableHead>
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
                const selectionWinRecord = cardSelectionWinRecord(outcomes);
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
                    <TableCell className="font-mono">{card.confirmed_revision_count}</TableCell>
                    <TableCell className="font-mono">{formatMeetingCardPrice(card.coin_price)}</TableCell>
                    <TableCell className="font-mono">
                      {card.status === "settled"
                        ? `${selectionWinRecord.wins}/${selectionWinRecord.graded} wins`
                        : `${resultCount}/${fixtures.length} results`}
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
          </div>
        </CardContent>
      </Card>

      <Card id="packages" className={activeView === "packages" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle>Subscription Packages</CardTitle>
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

      <Card id="earnings" className={activeView === "earnings" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="size-5 text-brand-cyan" />
            Earnings &amp; Payout Ledger
          </CardTitle>
          <CardDescription>
            This workspace includes only the forward 10/20/70 period. Settled legacy earnings are kept separately and cannot be requested again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Coins className="size-4" />
            <AlertTitle>Purchased Credits only</AlertTitle>
            <AlertDescription>
              Your earnings are 70% of Purchased Credits when clients use them on your content. Reward Credits are shown for transparency but create no payout allocation.
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Total earned", finance?.summary.totalEarnedCredits ?? 0],
              ["Available", finance?.summary.availableToRequestCredits ?? 0],
              ["Requested", finance?.summary.requestedCredits ?? 0],
              ["Paid, confirm receipt", finance?.summary.paidAwaitingConfirmationCredits ?? 0],
              ["Received", finance?.summary.receivedCredits ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-background/40 p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-xl text-white">{formatCredits(Number(value))}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border bg-background/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-heading text-lg">Payout Request</h3>
                {openPayoutRequest?.status === "requested" ? (
                  <p className="text-sm text-muted-foreground">
                    {formatCredits(openPayoutRequest.amountCredits)} is awaiting administrator payment.
                  </p>
                ) : openPayoutRequest?.status === "paid" ? (
                  <p className="text-sm text-muted-foreground">
                    Payment was recorded{openPayoutRequest.paymentReference ? ` as ${openPayoutRequest.paymentReference}` : ""}. Confirm only after the funds reach you.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Request your full available balance. The assigned amount moves out of Available while new earnings continue accumulating separately.
                  </p>
                )}
              </div>
              {openPayoutRequest?.status === "paid" ? (
                <Button
                  type="button"
                  disabled={confirmingPayoutId === openPayoutRequest.requestId}
                  onClick={() => void confirmPayoutReceived(openPayoutRequest.requestId)}
                >
                  {confirmingPayoutId === openPayoutRequest.requestId ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirm Payment Received
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={requestingPayout || availableEarnings <= 0 || Boolean(openPayoutRequest)}
                  onClick={() => void requestPayout()}
                >
                  {requestingPayout ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
                  Request {formatCredits(availableEarnings)}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-heading text-lg">Payout History</h3>
            {finance?.requests.map((request) => (
              <div key={request.requestId} className="grid gap-3 rounded-lg border bg-background/35 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-lg text-white">{formatCredits(request.amountCredits)}</p>
                    <Badge variant={request.status === "requested" ? "default" : "outline"}>{request.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested {formatRaceDateTime(request.requestedAt)} · earnings through {formatRaceDateTime(request.requestedThrough)}
                  </p>
                  {request.paymentReference ? <p className="mt-2 text-sm">Payment reference: {request.paymentReference}</p> : null}
                  {request.adminNote ? <p className="mt-1 text-sm text-muted-foreground">{request.adminNote}</p> : null}
                  {request.receivedAt ? <p className="mt-1 text-sm text-emerald-400">Confirmed received {formatRaceDateTime(request.receivedAt)}</p> : null}
                </div>
                {request.status === "paid" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={confirmingPayoutId === request.requestId}
                    onClick={() => void confirmPayoutReceived(request.requestId)}
                  >
                    {confirmingPayoutId === request.requestId ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Confirm Received
                  </Button>
                ) : null}
              </div>
            ))}
            {!finance?.requests.length ? (
              <p className="rounded-lg border bg-background/35 p-4 text-sm text-muted-foreground">No payout requests have been submitted in the new period.</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="font-heading text-lg">10/20/70 Transaction Ledger</h3>
              <p className="text-sm text-muted-foreground">Each row is tied to the stored allocation recorded when Purchased Credits were used.</p>
            </div>
            <div className="space-y-3 md:hidden">
              {finance?.entries.map((entry) => (
                <article key={entry.id} className="space-y-4 rounded-lg border bg-background/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{entry.purchaseType === "meeting" ? "Meeting card" : "Subscription"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{entry.sourceLabel}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{formatRaceDateTime(entry.createdAt)}</p>
                    </div>
                    <Badge variant={entry.entryType === "refund" ? "destructive" : "outline"}>{entry.entryType}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Purchased</dt>
                      <dd className="font-mono">{formatCredits(entry.purchasedCredits)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Reward excluded</dt>
                      <dd className="font-mono text-brand-cyan">{formatCredits(entry.rewardCreditsExcluded)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Horse Care 10%</dt>
                      <dd className="font-mono">{formatCredits(entry.horseCareCredits)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Platform 20%</dt>
                      <dd className="font-mono">{formatCredits(entry.platformCredits)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Your 70%</dt>
                      <dd className="font-mono font-semibold">{formatCredits(entry.tipsterCredits)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Payout</dt>
                      <dd className="mt-1">
                        <Badge variant="outline">
                          {entry.payoutStatus === "not_applicable" ? "Reward excluded" : entry.payoutStatus}
                        </Badge>
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
              {!finance?.entries.length ? (
                <p className="rounded-lg border bg-background/35 p-4 text-sm text-muted-foreground">No new-period earnings entries yet.</p>
              ) : null}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Purchased</TableHead>
                    <TableHead>Reward excluded</TableHead>
                    <TableHead>Horse Care 10%</TableHead>
                    <TableHead>Platform 20%</TableHead>
                    <TableHead>Your 70%</TableHead>
                    <TableHead>Payout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finance?.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatRaceDateTime(entry.createdAt)}</TableCell>
                      <TableCell>
                        <p className="font-medium">{entry.purchaseType === "meeting" ? "Meeting card" : "Subscription"}</p>
                        <p className="max-w-72 text-xs text-muted-foreground">{entry.sourceLabel}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.entryType === "refund" ? "destructive" : "outline"}>{entry.entryType}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{formatCredits(entry.purchasedCredits)}</TableCell>
                      <TableCell className="font-mono text-brand-cyan">{formatCredits(entry.rewardCreditsExcluded)}</TableCell>
                      <TableCell className="font-mono">{formatCredits(entry.horseCareCredits)}</TableCell>
                      <TableCell className="font-mono">{formatCredits(entry.platformCredits)}</TableCell>
                      <TableCell className="font-mono font-semibold">{formatCredits(entry.tipsterCredits)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {entry.payoutStatus === "not_applicable" ? "Reward excluded" : entry.payoutStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!finance?.entries.length ? (
                    <TableRow>
                      <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">No new-period earnings entries yet.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
