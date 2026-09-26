"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  FilePenLine,
  Loader2,
  PackageCheck,
  Palette,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MfaProfileCard } from "@/components/auth/mfa-profile-card";
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

type EarningRow = {
  id: string;
  entry_type: "sale" | "refund" | "allocation_adjustment";
  purchase_type: "meeting" | "subscription";
  source_label: string;
  purchaser_email: string | null;
  gross_coins: number;
  platform_fee_coins: number;
  horse_care_coins: number;
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
  selected_place_entry_id: string | null;
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
  const [themeDraft, setThemeDraft] = useState<TipsterTheme>(defaultTipsterTheme);
  const [meetingPageIndex, setMeetingPageIndex] = useState(0);
  const loadInFlight = useRef(false);
  const themeDraftTouched = useRef(false);

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
        earningResult,
        earningTotalResult,
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
        supabase.rpc("get_my_tipster_earnings_ledger_v2", { p_limit: 20 }),
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
      setEarnings((earningResult.data ?? []) as EarningRow[]);
      setCardFixtures(loadedCardFixtures);
      setCardOutcomes(loadedCardOutcomes);
      setRecordedEarnings(Number(earningTotalResult.data ?? 0));
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

      <MfaProfileCard />

      {preparationCards.length ? (
        <Card className="border-brand-cyan/45 bg-brand-cyan/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FilePenLine className="size-5 text-brand-cyan" />
              Continue preparing meeting cards
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" />
            Client-facing theme
          </CardTitle>
          <CardDescription>
            Choose the colors clients see on your public profile and your meeting cards. Changes do not affect another tipster.
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

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Upcoming horse-racing meetings</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>Your meeting cards</CardTitle>
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
          <CardDescription>
            Meeting-card and subscription sales are identified separately. Meeting settlement never reverses a subscription sale.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Client email</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>MRC</TableHead>
                <TableHead>Horse Care</TableHead>
                <TableHead>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatRaceDateTime(entry.created_at)}</TableCell>
                  <TableCell>
                    <p className="font-medium">
                      {entry.purchase_type === "meeting" ? "Meeting card" : "Subscription"}
                    </p>
                    <p className="max-w-72 text-xs text-muted-foreground">{entry.source_label}</p>
                  </TableCell>
                  <TableCell className="max-w-64 break-all text-sm">
                    {entry.purchaser_email ?? "Email unavailable"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.entry_type === "refund" ? "destructive" : "outline"}>
                      {entry.entry_type === "allocation_adjustment"
                        ? "10/20/70 adjustment"
                        : `${entry.purchase_type} ${entry.entry_type}`}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCredits(entry.gross_coins)}</TableCell>
                  <TableCell>{formatCredits(entry.platform_fee_coins)}</TableCell>
                  <TableCell>{formatCredits(entry.horse_care_coins)}</TableCell>
                  <TableCell>{formatCredits(entry.net_coins)}</TableCell>
                </TableRow>
              ))}
              {!earnings.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
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
