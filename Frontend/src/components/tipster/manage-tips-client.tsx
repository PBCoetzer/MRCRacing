"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Clock3,
  Loader2,
  Save,
  Send,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { formatRaceDate, formatRaceDateTime } from "@/lib/racing/format";
import type {
  MeetingBetLeg,
  MeetingBetOption,
  MultipleDraft,
  RaceEntry,
  RaceFixture,
  RaceMeeting,
  RaceSelectionDraft,
  RaceTipSelection,
  TipCard,
  TipCardMultiple,
  TipCardMultipleSelection,
  TipCardStatus,
  TipsterProfile,
} from "@/lib/racing/types";

type RaceDraftMap = Record<string, RaceSelectionDraft>;
type MultipleDraftMap = Record<string, MultipleDraft>;

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

function isUnlocked(value: string) {
  return new Date(value).getTime() > Date.now();
}

export function ManageTipsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tipster, setTipster] = useState<TipsterProfile | null>(null);
  const [meeting, setMeeting] = useState<RaceMeeting | null>(null);
  const [card, setCard] = useState<TipCard | null>(null);
  const [fixtures, setFixtures] = useState<RaceFixture[]>([]);
  const [entries, setEntries] = useState<RaceEntry[]>([]);
  const [betOptions, setBetOptions] = useState<MeetingBetOption[]>([]);
  const [betLegs, setBetLegs] = useState<MeetingBetLeg[]>([]);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [coinPrice, setCoinPrice] = useState("25");
  const [listingStatus, setListingStatus] = useState<Extract<TipCardStatus, "draft" | "coming_soon">>("draft");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [raceDrafts, setRaceDrafts] = useState<RaceDraftMap>({});
  const [multipleDrafts, setMultipleDrafts] = useState<MultipleDraftMap>({});

  const loadEditor = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedCardId = searchParams.get("card");
      const requestedMeetingId = searchParams.get("meeting");
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

      if (tipsterError || !tipsterData?.is_verified) {
        throw new Error(tipsterError?.message ?? "A verified tipster profile is required.");
      }

      let loadedCard: TipCard | null = null;

      if (requestedCardId) {
        const { data: cardData, error: cardError } = await supabase
          .from("tip_cards")
          .select("id,tipster_id,meeting_id,title,summary,coin_price,status,revision,listed_at,published_at,voided_at,updated_at")
          .eq("id", requestedCardId)
          .eq("tipster_id", tipsterData.id)
          .maybeSingle();

        if (cardError || !cardData) {
          throw new Error(cardError?.message ?? "The requested meeting card was not found.");
        }

        loadedCard = cardData as TipCard;
      }

      const resolvedMeetingId = loadedCard?.meeting_id ?? requestedMeetingId;

      if (!resolvedMeetingId) {
        throw new Error("Choose a meeting from the tipster dashboard first.");
      }

      const { data: meetingData, error: meetingError } = await supabase
        .from("race_meetings")
        .select("id,venue,country_code,meeting_date,first_race_at,last_race_at,status,is_test,source_name,source_url")
        .eq("id", resolvedMeetingId)
        .maybeSingle();

      if (meetingError || !meetingData) {
        throw new Error(meetingError?.message ?? "The meeting is unavailable.");
      }

      const [fixtureResult, optionResult] = await Promise.all([
        supabase
          .from("fixtures")
          .select("id,meeting_id,race_number,title,venue,starts_at,distance_m,race_class,status,result_summary")
          .eq("meeting_id", resolvedMeetingId)
          .order("race_number"),
        supabase
          .from("meeting_bet_options")
          .select("id,meeting_id,bet_type,display_name,cutoff_at,leg_count,sort_order")
          .eq("meeting_id", resolvedMeetingId)
          .order("sort_order"),
      ]);

      if (fixtureResult.error || optionResult.error) {
        throw fixtureResult.error ?? optionResult.error;
      }

      const loadedFixtures = (fixtureResult.data ?? []) as RaceFixture[];
      const loadedOptions = (optionResult.data ?? []) as MeetingBetOption[];
      const fixtureIds = loadedFixtures.map((fixture) => fixture.id);
      const optionIds = loadedOptions.map((option) => option.id);

      const [entryResult, legResult] = await Promise.all([
        fixtureIds.length
          ? supabase
              .from("race_entries")
              .select("id,fixture_id,saddle_number,horse_name,jockey_name,trainer_name,draw,odds,status,result_position")
              .in("fixture_id", fixtureIds)
              .order("saddle_number")
          : Promise.resolve({ data: [], error: null }),
        optionIds.length
          ? supabase
              .from("meeting_bet_legs")
              .select("bet_option_id,leg_number,fixture_id")
              .in("bet_option_id", optionIds)
              .order("leg_number")
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (entryResult.error || legResult.error) {
        throw entryResult.error ?? legResult.error;
      }

      let loadedRaceSelections: RaceTipSelection[] = [];
      let loadedMultiples: TipCardMultiple[] = [];
      let loadedMultipleSelections: TipCardMultipleSelection[] = [];

      if (loadedCard) {
        const [raceSelectionResult, multipleResult] = await Promise.all([
          supabase
            .from("race_tip_selections")
            .select("id,tip_card_id,fixture_id,winner_entry_id,place_entry_id,comments")
            .eq("tip_card_id", loadedCard.id),
          supabase
            .from("tip_card_multiples")
            .select("id,tip_card_id,bet_option_id,custom_name,comments")
            .eq("tip_card_id", loadedCard.id),
        ]);

        if (raceSelectionResult.error || multipleResult.error) {
          throw raceSelectionResult.error ?? multipleResult.error;
        }

        loadedRaceSelections = (raceSelectionResult.data ?? []) as RaceTipSelection[];
        loadedMultiples = (multipleResult.data ?? []) as TipCardMultiple[];

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
      }

      const raceSelectionByFixture = new Map(
        loadedRaceSelections.map((selection) => [selection.fixture_id, selection]),
      );
      const nextRaceDrafts: RaceDraftMap = {};

      for (const fixture of loadedFixtures) {
        const selection = raceSelectionByFixture.get(fixture.id);
        nextRaceDrafts[fixture.id] = {
          fixtureId: fixture.id,
          winnerEntryId: selection?.winner_entry_id ?? "",
          placeEntryId: selection?.place_entry_id ?? "",
          comments: selection?.comments ?? "",
        };
      }

      const multipleByOption = new Map(
        loadedMultiples.map((multiple) => [multiple.bet_option_id, multiple]),
      );
      const nextMultipleDrafts: MultipleDraftMap = {};

      for (const option of loadedOptions) {
        const multiple = multipleByOption.get(option.id);
        const officialLegs = ((legResult.data ?? []) as MeetingBetLeg[])
          .filter((leg) => leg.bet_option_id === option.id)
          .sort((left, right) => left.leg_number - right.leg_number);
        const optionLegs = option.bet_type === "other"
          ? loadedFixtures.map((fixture) => ({
              bet_option_id: option.id,
              leg_number: fixture.race_number,
              fixture_id: fixture.id,
            }))
          : officialLegs;

        nextMultipleDrafts[option.id] = {
          betOptionId: option.id,
          customName: multiple?.custom_name ?? "",
          comments: multiple?.comments ?? "",
          legs: optionLegs.map((leg) => ({
            legNumber: leg.leg_number,
            fixtureId: leg.fixture_id,
            entryIds: multiple
              ? loadedMultipleSelections
                  .filter(
                    (selection) =>
                      selection.multiple_id === multiple.id &&
                      selection.leg_number === leg.leg_number,
                  )
                  .map((selection) => selection.entry_id)
              : [],
          })),
        };
      }

      const loadedMeeting = meetingData as RaceMeeting;
      setTipster(tipsterData as TipsterProfile);
      setMeeting(loadedMeeting);
      setCard(loadedCard);
      setFixtures(loadedFixtures);
      setEntries((entryResult.data ?? []) as RaceEntry[]);
      setBetOptions(loadedOptions);
      setBetLegs((legResult.data ?? []) as MeetingBetLeg[]);
      setRaceDrafts(nextRaceDrafts);
      setMultipleDrafts(nextMultipleDrafts);
      setTitle(loadedCard?.title ?? `${loadedMeeting.venue} ${formatRaceDate(loadedMeeting.first_race_at)} Meeting Card`);
      setSummary(loadedCard?.summary ?? "");
      setCoinPrice(String(loadedCard?.coin_price ?? 25));
      setListingStatus(loadedCard?.status === "coming_soon" ? "coming_soon" : "draft");
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load the meeting card editor."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEditor();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadEditor]);

  const entriesByFixture = useMemo(() => {
    const grouped = new Map<string, RaceEntry[]>();

    for (const entry of entries) {
      const current = grouped.get(entry.fixture_id) ?? [];
      current.push(entry);
      grouped.set(entry.fixture_id, current);
    }

    return grouped;
  }, [entries]);
  const fixturesById = useMemo(
    () => new Map(fixtures.map((fixture) => [fixture.id, fixture])),
    [fixtures],
  );
  const isPublished = card?.status === "published";

  function updateRaceDraft(fixtureId: string, patch: Partial<RaceSelectionDraft>) {
    setRaceDrafts((current) => ({
      ...current,
      [fixtureId]: {
        ...current[fixtureId],
        ...patch,
      },
    }));
  }

  function updateMultipleDraft(optionId: string, patch: Partial<MultipleDraft>) {
    setMultipleDrafts((current) => ({
      ...current,
      [optionId]: {
        ...current[optionId],
        ...patch,
      },
    }));
  }

  function toggleMultipleEntry(
    optionId: string,
    legNumber: number,
    entryId: string,
  ) {
    setMultipleDrafts((current) => {
      const draft = current[optionId];

      return {
        ...current,
        [optionId]: {
          ...draft,
          legs: draft.legs.map((leg) => {
            if (leg.legNumber !== legNumber) {
              return leg;
            }

            const selected = leg.entryIds.includes(entryId);
            return {
              ...leg,
              entryIds: selected
                ? leg.entryIds.filter((id) => id !== entryId)
                : [...leg.entryIds, entryId],
            };
          }),
        },
      };
    });
  }

  async function invokeNotificationWorker() {
    const supabase = createClient();

    if (!supabase) {
      return "Notification worker is not configured.";
    }

    const { error: workerError } = await supabase.functions.invoke("process-tip-notifications", {
      body: { source: "tip-card-editor" },
    });

    return workerError
      ? "The card was saved, but queued email delivery still needs the Resend production secret."
      : "Entitled clients were queued for email delivery.";
  }

  async function saveCard(action: "draft" | "publish" | "revise") {
    const supabase = createClient();

    if (!supabase || !meeting || !tipster) {
      return;
    }

    const parsedPrice = Number(coinPrice);

    if (!Number.isInteger(parsedPrice) || parsedPrice <= 0) {
      setError("Enter a positive whole-coin meeting price.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (action === "revise") {
        if (!card) {
          throw new Error("Save and publish the card before creating a correction.");
        }

        if (revisionSummary.trim().length < 5) {
          throw new Error("Describe the correction in at least five characters.");
        }

        const raceChanges = fixtures
          .filter((fixture) => isUnlocked(fixture.starts_at))
          .map((fixture) => {
            const draft = raceDrafts[fixture.id];
            const remove = !draft.winnerEntryId && !draft.placeEntryId && !draft.comments.trim();

            return remove
              ? { fixtureId: fixture.id, remove: true }
              : draft;
          });
        const multipleChanges = betOptions
          .filter((option) => isUnlocked(option.cutoff_at))
          .map((option) => {
            const draft = multipleDrafts[option.id];
            const hasSelections = draft.legs.some((leg) => leg.entryIds.length > 0);

            return hasSelections
              ? draft
              : { betOptionId: option.id, remove: true };
          });
        const { data, error: revisionError } = await supabase.rpc("revise_tip_card", {
          p_card_id: card.id,
          p_expected_revision: card.revision,
          p_revision_summary: revisionSummary.trim(),
          p_race_changes: raceChanges,
          p_multiple_changes: multipleChanges,
        });

        if (revisionError) {
          throw revisionError;
        }

        const notificationMessage = await invokeNotificationWorker();
        setCard(data as TipCard);
        setRevisionSummary("");
        setMessage(`Correction published. ${notificationMessage}`);
        return;
      }

      const raceSelections = fixtures.map((fixture) => raceDrafts[fixture.id]);
      const multiples = betOptions
        .map((option) => multipleDrafts[option.id])
        .filter((draft) =>
          draft.legs.some((leg) => leg.entryIds.length > 0) ||
          draft.customName.trim() ||
          draft.comments.trim(),
        );
      const { data: savedData, error: saveError } = await supabase.rpc("save_tip_card_draft", {
        p_card_id: card?.id ?? null,
        p_meeting_id: meeting.id,
        p_title: title,
        p_summary: summary,
        p_coin_price: parsedPrice,
        p_expected_revision: card?.revision ?? 0,
        p_listing_status: action === "publish" ? "draft" : listingStatus,
        p_race_selections: raceSelections,
        p_multiples: multiples,
      });

      if (saveError) {
        throw saveError;
      }

      const savedCard = savedData as TipCard;
      setCard(savedCard);

      if (action === "publish") {
        const { data: publishedData, error: publishError } = await supabase.rpc("publish_tip_card", {
          p_card_id: savedCard.id,
          p_expected_revision: savedCard.revision,
        });

        if (publishError) {
          throw publishError;
        }

        const notificationMessage = await invokeNotificationWorker();
        setCard(publishedData as TipCard);
        setMessage(`Meeting card published. ${notificationMessage}`);
      } else {
        const nextUrl = `/tipster/manage-tips/?card=${encodeURIComponent(savedCard.id)}`;
        window.history.replaceState(null, "", nextUrl);
        setMessage(
          listingStatus === "coming_soon"
            ? "Coming Soon card saved and available for pre-purchase."
            : "Draft saved privately.",
        );
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save the meeting card."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-56 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin text-primary" />
          Loading races, runners, and betting legs…
        </CardContent>
      </Card>
    );
  }

  if (!meeting) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Meeting unavailable</AlertTitle>
        <AlertDescription>{error || "Return to the tipster dashboard and choose a meeting."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost">
        <Link href="/tipster/">
          <ArrowLeft className="size-4" />
          Tipster dashboard
        </Link>
      </Button>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Card could not be saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Meeting card updated</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-brand-gold/40">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{meeting.venue}</Badge>
            {meeting.is_test ? <Badge variant="secondary">Private test meeting</Badge> : null}
            <Badge variant="outline">Race 1: {formatRaceDateTime(meeting.first_race_at)}</Badge>
            {card ? <Badge variant="outline">Revision {card.revision}</Badge> : null}
          </div>
          <CardTitle className="font-heading text-2xl text-white">Meeting card setup</CardTitle>
          <CardDescription>
            First publication must happen before Race 1. Race tips and meeting bets lock at their official cutoffs.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="card-title">Card title</Label>
            <Input
              id="card-title"
              disabled={isPublished}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="card-summary">Client preview</Label>
            <Textarea
              id="card-summary"
              disabled={isPublished}
              placeholder="Describe your approach without revealing premium selections."
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coin-price">Meeting price in coins</Label>
            <Input
              id="coin-price"
              disabled={isPublished}
              min={1}
              type="number"
              value={coinPrice}
              onChange={(event) => setCoinPrice(event.target.value)}
            />
          </div>
          {!isPublished ? (
            <div className="space-y-2">
              <Label htmlFor="listing-status">Pre-publication visibility</Label>
              <select
                id="listing-status"
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                value={listingStatus}
                onChange={(event) => setListingStatus(event.target.value as "draft" | "coming_soon")}
              >
                <option value="draft">Private draft</option>
                <option value="coming_soon">Coming Soon / pre-purchase</option>
              </select>
            </div>
          ) : (
            <div className="rounded-lg border border-brand-cyan/35 bg-brand-cyan/8 p-3 text-sm">
              Published cards use the audited correction workflow. Price and preview remain snapshotted.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-2xl text-white">Race-by-race tips</h2>
          <p className="text-sm text-muted-foreground">
            Select one optional winner, one optional best-place option, and add race comments.
          </p>
        </div>
        {fixtures.map((fixture) => {
          const fixtureEntries = entriesByFixture.get(fixture.id) ?? [];
          const draft = raceDrafts[fixture.id];
          const locked = isPublished && !isUnlocked(fixture.starts_at);

          return (
            <Card key={fixture.id} className={locked ? "opacity-75" : ""}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>Race {fixture.race_number}: {fixture.title}</CardTitle>
                    <CardDescription>
                      {formatRaceDateTime(fixture.starts_at)}
                      {fixture.distance_m ? ` · ${fixture.distance_m}m` : ""}
                      {fixture.race_class ? ` · ${fixture.race_class}` : ""}
                    </CardDescription>
                  </div>
                  <Badge variant={locked ? "destructive" : "outline"}>
                    <Clock3 className="size-3" />
                    {locked ? "Locked" : "Open"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`winner-${fixture.id}`}>Race winner</Label>
                  <select
                    id={`winner-${fixture.id}`}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                    disabled={locked}
                    value={draft?.winnerEntryId ?? ""}
                    onChange={(event) => updateRaceDraft(fixture.id, { winnerEntryId: event.target.value })}
                  >
                    <option value="">No selection</option>
                    {fixtureEntries.map((entry) => (
                      <option key={entry.id} value={entry.id} disabled={entry.status === "scratched"}>
                        {entry.saddle_number}. {entry.horse_name}{entry.jockey_name ? ` · ${entry.jockey_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`place-${fixture.id}`}>Best place option</Label>
                  <select
                    id={`place-${fixture.id}`}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                    disabled={locked}
                    value={draft?.placeEntryId ?? ""}
                    onChange={(event) => updateRaceDraft(fixture.id, { placeEntryId: event.target.value })}
                  >
                    <option value="">No selection</option>
                    {fixtureEntries.map((entry) => (
                      <option key={entry.id} value={entry.id} disabled={entry.status === "scratched"}>
                        {entry.saddle_number}. {entry.horse_name}{entry.odds ? ` · ${entry.odds}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor={`comments-${fixture.id}`}>Race comments</Label>
                  <Textarea
                    id={`comments-${fixture.id}`}
                    disabled={locked}
                    placeholder="Pace, draw, form, confidence, and race-shape notes."
                    value={draft?.comments ?? ""}
                    onChange={(event) => updateRaceDraft(fixture.id, { comments: event.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-2xl text-white">Meeting-level bets</h2>
          <p className="text-sm text-muted-foreground">
            Complete at least one PA, Pick 6, Bipot, Jackpot, or custom Other bet before publication.
          </p>
        </div>
        {betOptions.map((option) => {
          const draft = multipleDrafts[option.id];
          const locked = isPublished && !isUnlocked(option.cutoff_at);
          const officialLegCount = betLegs.filter((leg) => leg.bet_option_id === option.id).length;

          return (
            <Card key={option.id} className={locked ? "opacity-75" : ""}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>{option.display_name}</CardTitle>
                    <CardDescription>
                      Cutoff {formatRaceDateTime(option.cutoff_at)}
                      {option.bet_type !== "other" ? ` · ${officialLegCount} official legs` : " · custom multi-race bet"}
                    </CardDescription>
                  </div>
                  <Badge variant={locked ? "destructive" : "secondary"}>
                    {locked ? "Cutoff passed" : "Selections open"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {option.bet_type === "other" ? (
                  <div className="space-y-2">
                    <Label htmlFor={`custom-name-${option.id}`}>Custom bet name</Label>
                    <Input
                      id={`custom-name-${option.id}`}
                      disabled={locked}
                      placeholder="Example: Daily double"
                      value={draft?.customName ?? ""}
                      onChange={(event) => updateMultipleDraft(option.id, { customName: event.target.value })}
                    />
                  </div>
                ) : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  {draft?.legs.map((leg) => {
                    const fixture = fixturesById.get(leg.fixtureId);
                    const legEntries = entriesByFixture.get(leg.fixtureId) ?? [];

                    return (
                      <div key={`${option.id}-${leg.legNumber}`} className="rounded-lg border bg-background/40 p-3">
                        <p className="font-semibold">
                          Leg {leg.legNumber}
                          {fixture ? ` · Race ${fixture.race_number}` : ""}
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {legEntries.map((entry) => {
                            const checked = leg.entryIds.includes(entry.id);

                            return (
                              <label
                                key={entry.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm has-checked:border-brand-gold has-checked:bg-brand-gold/10"
                              >
                                <input
                                  checked={checked}
                                  disabled={locked || entry.status === "scratched"}
                                  type="checkbox"
                                  onChange={() => toggleMultipleEntry(option.id, leg.legNumber, entry.id)}
                                />
                                <span>{entry.saddle_number}. {entry.horse_name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`multiple-comments-${option.id}`}>{option.display_name} comments</Label>
                  <Textarea
                    id={`multiple-comments-${option.id}`}
                    disabled={locked}
                    placeholder="Optional strategy or banker notes."
                    value={draft?.comments ?? ""}
                    onChange={(event) => updateMultipleDraft(option.id, { comments: event.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="sticky bottom-4 z-20 border-brand-gold bg-card/95 shadow-2xl backdrop-blur">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{tipster?.display_name}</p>
            <p className="text-sm text-muted-foreground">
              {isPublished
                ? "Corrections are audited and only unlocked future selections can change."
                : "Save privately, list as Coming Soon, or publish the completed card."}
            </p>
          </div>
          {isPublished ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-96">
              <Input
                placeholder="Required correction summary"
                value={revisionSummary}
                onChange={(event) => setRevisionSummary(event.target.value)}
              />
              <Button disabled={saving} type="button" onClick={() => void saveCard("revise")}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
                Publish audited correction
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={saving} type="button" variant="outline" onClick={() => void saveCard("draft")}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save {listingStatus === "coming_soon" ? "Coming Soon" : "draft"}
              </Button>
              <Button disabled={saving} type="button" onClick={() => void saveCard("publish")}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Publish meeting card
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
