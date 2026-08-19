"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Clock3,
  FilePenLine,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  Trophy,
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
import { meetingCardSalesOpen } from "@/lib/racing/availability";
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
  TipCardChangeAlert,
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

export function ManageTipsClient() {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
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
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [coinPrice, setCoinPrice] = useState("25");
  const [listingStatus, setListingStatus] = useState<Extract<TipCardStatus, "draft" | "coming_soon">>("draft");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [raceDrafts, setRaceDrafts] = useState<RaceDraftMap>({});
  const [multipleDrafts, setMultipleDrafts] = useState<MultipleDraftMap>({});
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [changeAlerts, setChangeAlerts] = useState<TipCardChangeAlert[]>([]);
  const [acknowledgingAlertId, setAcknowledgingAlertId] = useState("");

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
          .select("id,meeting_id,race_number,title,venue,starts_at,selection_lock_at,distance_m,race_class,status,result_summary")
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
              .select("id,fixture_id,saddle_number,horse_name,jockey_name,trainer_name,draw,status,result_position")
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
      let loadedChangeAlerts: TipCardChangeAlert[] = [];

      if (loadedCard) {
        const [raceSelectionResult, multipleResult] = await Promise.all([
          supabase
            .from("race_tip_selections")
            .select("id,tip_card_id,fixture_id,winner_entry_id,place_entry_id,comments")
            .eq("tip_card_id", loadedCard.id),
          supabase
            .from("tip_card_multiples")
            .select("id,tip_card_id,bet_option_id,custom_name,tip_text,comments")
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

        const { data: alertData, error: alertError } = await supabase.rpc(
          "tipster_get_card_change_alerts",
          { p_card_id: loadedCard.id },
        );

        if (alertError) {
          throw alertError;
        }

        loadedChangeAlerts = Array.isArray(alertData)
          ? alertData as TipCardChangeAlert[]
          : [];
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

        if (!multiple) {
          continue;
        }

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
          tipText: multiple?.tip_text ?? "",
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
      setRaceDrafts(nextRaceDrafts);
      setMultipleDrafts(nextMultipleDrafts);
      setTitle(loadedCard?.title ?? `${loadedMeeting.venue} ${formatRaceDate(loadedMeeting.first_race_at)} Meeting Card`);
      setSummary(loadedCard?.summary ?? "");
      setCoinPrice(String(loadedCard?.coin_price ?? 25));
      setListingStatus(loadedCard?.status === "coming_soon" ? "coming_soon" : "draft");
      setChangeAlerts(loadedChangeAlerts);
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

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

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
  const creationWindowClosed = !isPublished && Boolean(
    meeting && !meetingCardSalesOpen(meeting, currentTime),
  );
  const isReadOnlyCard = card?.status === "settled" || card?.status === "void" || creationWindowClosed;
  const unusedBetOptions = betOptions.filter((option) => !multipleDrafts[option.id]);
  const hasEditableSelections =
    fixtures.some((fixture) => new Date(fixture.selection_lock_at).getTime() > currentTime) ||
    betOptions.some((option) => new Date(option.cutoff_at).getTime() > currentTime);

  function isOpen(value: string) {
    return new Date(value).getTime() > currentTime;
  }

  async function acknowledgeChange(alertId: string) {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setAcknowledgingAlertId(alertId);
    setError("");

    try {
      const { error: acknowledgeError } = await supabase.rpc(
        "acknowledge_tip_card_change",
        {
          p_alert_id: alertId,
          p_note: "Reviewed; the current tip remains valid.",
        },
      );

      if (acknowledgeError) {
        throw acknowledgeError;
      }

      setChangeAlerts((current) => current.map((alert) =>
        alert.id === alertId
          ? { ...alert, status: "acknowledged", acknowledgedAt: new Date().toISOString() }
          : alert
      ));
      setMessage("Race-data change acknowledged. Clients were not notified because the tip remains unchanged.");
    } catch (acknowledgeError) {
      setError(getErrorMessage(acknowledgeError, "Could not acknowledge the race-data change."));
    } finally {
      setAcknowledgingAlertId("");
    }
  }

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

  function addMultiple() {
    const option = betOptions.find((item) => item.id === selectedOptionId);

    if (!option || multipleDrafts[option.id]) {
      return;
    }

    setMultipleDrafts((current) => ({
      ...current,
      [option.id]: {
        betOptionId: option.id,
        customName: option.bet_type === "other" ? "Other" : "",
        tipText: "",
        comments: "",
        legs: [],
      },
    }));
    setSelectedOptionId("");
  }

  function removeMultiple(optionId: string) {
    setMultipleDrafts((current) => {
      const next = { ...current };
      delete next[optionId];
      return next;
    });
  }

  async function invokeNotificationWorker() {
    const supabase = createClient();

    if (!supabase) {
      return "Notification worker is not configured.";
    }

    const { error: workerError } = await supabase.functions.invoke("deliver-tip-notifications", {
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
      setError("Enter a positive whole-Credit meeting price.");
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
          .filter((fixture) => isOpen(fixture.starts_at))
          .map((fixture) => {
            const draft = raceDrafts[fixture.id];
            const remove = !draft.winnerEntryId && !draft.placeEntryId && !draft.comments.trim();

            return remove
              ? { fixtureId: fixture.id, remove: true }
              : draft;
          });
        const multipleChanges = betOptions
          .filter((option) => isOpen(option.cutoff_at))
          .map((option) => {
            const draft = multipleDrafts[option.id];
            const hasLegacySelections = draft?.legs.some(
              (leg) => leg.entryIds.length > 0,
            );

            return draft && (draft.tipText.trim() || hasLegacySelections)
              ? draft
              : { betOptionId: option.id, remove: true };
          });
        const { data, error: revisionError } = await supabase.rpc("revise_tip_card_v2", {
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
        const revisedCard = data as TipCard;
        setCard(revisedCard);
        setChangeAlerts((current) => current.map((alert) =>
          alert.status === "pending"
            ? {
                ...alert,
                status: "resolved",
                resolvedAt: new Date().toISOString(),
                resolvedRevision: revisedCard.revision,
              }
            : alert
        ));
        setRevisionSummary("");
        setMessage(`Correction published. ${notificationMessage}`);
        return;
      }

      const raceSelections = fixtures.map((fixture) => raceDrafts[fixture.id]);
      const multiples = Object.values(multipleDrafts)
        .filter((draft) =>
          draft.tipText.trim() ||
          draft.legs.some((leg) => leg.entryIds.length > 0) ||
          draft.customName.trim() ||
          draft.comments.trim(),
        );
      const { data: savedData, error: saveError } = await supabase.rpc("save_tip_card_draft_v2", {
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
        const { data: publishedData, error: publishError } = await supabase.rpc("publish_tip_card_v2", {
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

      {changeAlerts.some((alert) => ["pending", "locked"].includes(alert.status)) ? (
        <Card className="border-brand-gold/50 bg-brand-gold/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="size-5 text-brand-gold" />
              Race data changed — review required
            </CardTitle>
            <CardDescription>
              These factual source changes may affect this published meeting card. Clients are notified only after you publish a correction.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {changeAlerts
              .filter((alert) => ["pending", "locked"].includes(alert.status))
              .map((alert) => (
                <div key={alert.id} className="rounded-lg border border-brand-gold/30 bg-background/55 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{alert.summary}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {alert.raceNumber ? `Race ${alert.raceNumber}` : "Meeting change"}
                        {alert.horseName ? ` · ${alert.horseName}` : ""}
                        {alert.changedFields.length ? ` · ${alert.changedFields.join(", ")}` : ""}
                      </p>
                    </div>
                    <Badge variant={alert.status === "locked" ? "destructive" : "outline"}>
                      {alert.status === "locked" ? "Changed after lock" : "Review required"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                    <div className="rounded-md border bg-black/10 p-3">
                      <p className="mb-1 font-semibold text-muted-foreground">Previous data</p>
                      <pre className="whitespace-pre-wrap break-words font-mono">
                        {JSON.stringify(alert.beforeValues, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-md border bg-black/10 p-3">
                      <p className="mb-1 font-semibold text-muted-foreground">Updated data</p>
                      <pre className="whitespace-pre-wrap break-words font-mono">
                        {JSON.stringify(alert.afterValues, null, 2)}
                      </pre>
                    </div>
                  </div>
                  {alert.status === "pending" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void acknowledgeChange(alert.id)}
                        disabled={acknowledgingAlertId === alert.id}
                      >
                        {acknowledgingAlertId === alert.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        Tip remains valid
                      </Button>
                      <p className="self-center text-xs text-muted-foreground">
                        Otherwise edit the affected selection and publish a correction below.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      This change arrived after cutoff. The existing tip remains immutable and clients are not notified.
                    </p>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
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
            First publication must happen before Race 1. Race tips and Exotic&apos;s and
            Multiples lock at their official cutoffs.
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
            <Label htmlFor="coin-price">Meeting price in Credits</Label>
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
          const locked = !isOpen(fixture.selection_lock_at) || isReadOnlyCard;
          const resultAvailable = Boolean(
            fixture.result_summary ||
              fixtureEntries.some((entry) => entry.result_position !== null),
          );
          const selectedWinner = fixtureEntries.find(
            (entry) => entry.id === draft?.winnerEntryId,
          );
          const selectedPlace = fixtureEntries.find(
            (entry) => entry.id === draft?.placeEntryId,
          );
          const officialWinner = fixtureEntries.find(
            (entry) => entry.result_position === 1,
          );

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
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={resultAvailable ? "default" : locked ? "destructive" : "outline"}
                    >
                      {resultAvailable ? (
                        <Trophy className="size-3" />
                      ) : (
                        <Clock3 className="size-3" />
                      )}
                      {resultAvailable ? "Result Available" : locked ? "Locked" : "Open"}
                    </Badge>
                    {!locked ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          document.getElementById(`winner-${fixture.id}`)?.focus()
                        }
                      >
                        <FilePenLine className="size-3" />
                        Edit tips
                      </Button>
                    ) : null}
                  </div>
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
                        {entry.saddle_number}. {entry.horse_name}{entry.jockey_name ? ` · ${entry.jockey_name}` : ""}
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
                {resultAvailable ? (
                  <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan/8 p-4 md:col-span-2">
                    <p className="font-semibold">
                      Official result:{" "}
                      {fixture.result_summary ||
                        (officialWinner
                          ? `${officialWinner.saddle_number}. ${officialWinner.horse_name} won`
                          : "Result positions imported")}
                    </p>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground">Winner selection</p>
                        <p>
                          {selectedWinner
                            ? `${selectedWinner.saddle_number}. ${selectedWinner.horse_name} · ${
                                selectedWinner.result_position
                                  ? `finished ${selectedWinner.result_position}`
                                  : "position unavailable"
                              }`
                            : "No selection"}
                        </p>
                        {selectedWinner?.result_position ? (
                          <Badge
                            className="mt-2"
                            variant={selectedWinner.result_position === 1 ? "default" : "destructive"}
                          >
                            {selectedWinner.result_position === 1 ? "Winner hit" : "Winner miss"}
                          </Badge>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-muted-foreground">Best-place selection</p>
                        <p>
                          {selectedPlace
                            ? `${selectedPlace.saddle_number}. ${selectedPlace.horse_name} · ${
                                selectedPlace.result_position
                                  ? `finished ${selectedPlace.result_position}`
                                  : "position unavailable"
                              }`
                            : "No selection"}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Finishing position only. No monetary win is claimed without
                          authoritative place terms or dividends.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-2xl text-white">Exotic&apos;s and Multiples</h2>
          <p className="text-sm text-muted-foreground">
            Add only the meeting options you want to publish. At least one added option
            needs a completed tip before publication.
          </p>
        </div>
        {!isReadOnlyCard && unusedBetOptions.length ? (
          <Card className="border-dashed border-brand-gold/45">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="add-multiple">Add Exotic or Multiple</Label>
                <select
                  id="add-multiple"
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  value={selectedOptionId}
                  onChange={(event) => setSelectedOptionId(event.target.value)}
                >
                  <option value="">Choose an unused option</option>
                  {unusedBetOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                disabled={!selectedOptionId}
                onClick={addMultiple}
              >
                <Plus className="size-4" />
                Add Exotic or Multiple
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {betOptions.filter((option) => multipleDrafts[option.id]).map((option) => {
          const draft = multipleDrafts[option.id];
          const locked = !isOpen(option.cutoff_at) || isReadOnlyCard;
          const legacySelections = draft.legs.flatMap((leg) =>
            leg.entryIds.map((entryId) => ({
              entryId,
              legNumber: leg.legNumber,
              fixtureId: leg.fixtureId,
            })),
          );
          const isLegacy = legacySelections.length > 0 && !draft.tipText.trim();

          return (
            <Card key={option.id} className={locked ? "opacity-75" : ""}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>{option.display_name}</CardTitle>
                    <CardDescription>
                      Cutoff {formatRaceDateTime(option.cutoff_at)}
                      {isLegacy ? " · legacy structured selection" : " · free-text meeting tip"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={locked ? "destructive" : "secondary"}>
                      {locked ? "Cutoff passed" : "Tip open"}
                    </Badge>
                    {!locked && !isPublished ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Remove ${option.display_name}`}
                        onClick={() => removeMultiple(option.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLegacy ? (
                  <div className="rounded-lg border bg-background/40 p-4">
                    <p className="font-semibold">Historical structured selection</p>
                    <div className="mt-3 space-y-2 text-sm">
                      {draft.legs.map((leg) => {
                        const fixture = fixturesById.get(leg.fixtureId);
                        const legEntries = leg.entryIds
                          .map((entryId) => entries.find((entry) => entry.id === entryId))
                          .filter(Boolean);

                        return (
                          <p key={`${option.id}-${leg.legNumber}`}>
                            <span className="text-muted-foreground">
                              Leg {leg.legNumber}
                              {fixture ? ` / Race ${fixture.race_number}` : ""}:{" "}
                            </span>
                            {legEntries
                              .map((entry) => `${entry?.saddle_number}. ${entry?.horse_name}`)
                              .join(", ")}
                          </p>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Legacy structured records remain readable. New entries use the
                      free-text format below.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor={`multiple-tip-${option.id}`}>
                      {option.display_name} tip
                    </Label>
                    <Textarea
                      id={`multiple-tip-${option.id}`}
                      disabled={locked}
                      required
                      rows={6}
                      placeholder="Enter your full multiline Exotic or Multiple tip exactly as clients should receive it."
                      value={draft.tipText}
                      onChange={(event) =>
                        updateMultipleDraft(option.id, { tipText: event.target.value })
                      }
                    />
                  </div>
                )}
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
        {!Object.keys(multipleDrafts).length ? (
          <Alert>
            <Plus className="size-4" />
            <AlertTitle>No Exotic or Multiple added</AlertTitle>
            <AlertDescription>
              Use the Add Exotic or Multiple control to add PA, Pick 6, Bipot,
              Jackpot, or Other only when needed.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Card className="sticky bottom-4 z-20 border-brand-gold bg-card/95 shadow-2xl backdrop-blur">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{tipster?.display_name}</p>
            <p className="text-sm text-muted-foreground">
              {isReadOnlyCard || (isPublished && !hasEditableSelections)
                ? "All selections are locked. This card is now a read-only results record."
                : isPublished
                ? "Corrections are audited and only unlocked future selections can change."
                : "Save privately, list as Coming Soon, or publish the completed card."}
            </p>
          </div>
          {isReadOnlyCard || (isPublished && !hasEditableSelections) ? (
            <Badge variant="outline">
              <Trophy className="size-3" />
              View results only
            </Badge>
          ) : isPublished ? (
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
