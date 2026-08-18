"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Heart,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCredits, formatRaceDateTime } from "@/lib/racing/format";
import { meetingCardSalesOpen } from "@/lib/racing/availability";
import type {
  RaceMeeting,
  TipCard,
  TipsterPackage,
  TipsterPerformanceStats,
  TipsterProfile,
} from "@/lib/racing/types";
import { createClient } from "@/lib/supabase/client";

export function TipsterProfileClient() {
  const [loadedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tipster, setTipster] = useState<TipsterProfile | null>(null);
  const [stats, setStats] = useState<TipsterPerformanceStats | null>(null);
  const [packages, setPackages] = useState<TipsterPackage[]>([]);
  const [cards, setCards] = useState<TipCard[]>([]);
  const [meetings, setMeetings] = useState<RaceMeeting[]>([]);
  const [userId, setUserId] = useState("");
  const [favourite, setFavourite] = useState(false);

  const loadProfile = useCallback(async () => {
    const tipsterId = new URLSearchParams(window.location.search).get("tipster");
    const supabase = createClient();

    if (!tipsterId || !supabase) {
      setError("Choose a valid tipster profile.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [tipsterResult, statsResult, packageResult, cardResult, favouriteResult] =
      await Promise.all([
        supabase
          .from("tipsters")
          .select(
            "id,slug,user_id,display_name,biography,photo_path,is_verified,ranking,commission_rate_override",
          )
          .eq("id", tipsterId)
          .eq("is_verified", true)
          .maybeSingle(),
        supabase
          .from("tipster_performance_stats")
          .select(
            "tipster_id,published_winner_tips,settled_winner_tips,winner_hits,winner_strike_rate,roi_percent,updated_at",
          )
          .eq("tipster_id", tipsterId)
          .maybeSingle(),
        supabase
          .from("tipster_packages")
          .select(
            "id,tipster_id,name,duration_months,coin_price,is_active,created_at",
          )
          .eq("tipster_id", tipsterId)
          .eq("is_active", true)
          .order("duration_months"),
        supabase
          .from("tip_cards")
          .select(
            "id,tipster_id,meeting_id,title,summary,coin_price,status,revision,listed_at,published_at,voided_at,updated_at",
          )
          .eq("tipster_id", tipsterId)
          .in("status", ["coming_soon", "published"])
          .order("updated_at", { ascending: false }),
        user
          ? supabase
              .from("client_tipster_favourites")
              .select("tipster_id")
              .eq("user_id", user.id)
              .eq("tipster_id", tipsterId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    const firstError =
      tipsterResult.error ??
      statsResult.error ??
      packageResult.error ??
      cardResult.error ??
      favouriteResult.error;
    const loadedCards = (cardResult.data ?? []) as TipCard[];
    let loadedMeetings: RaceMeeting[] = [];

    if (loadedCards.length) {
      const meetingResult = await supabase
        .from("race_meetings")
        .select(
          "id,venue,country_code,meeting_date,first_race_at,last_race_at,status,is_test,source_name,source_url",
        )
        .in("id", [...new Set(loadedCards.map((card) => card.meeting_id))]);

      if (meetingResult.error) {
        setError(meetingResult.error.message);
      } else {
        loadedMeetings = (meetingResult.data ?? []) as RaceMeeting[];
      }
    }

    setUserId(user?.id ?? "");
    setTipster((tipsterResult.data as TipsterProfile | null) ?? null);
    setStats(
      (statsResult.data as TipsterPerformanceStats | null) ?? null,
    );
    setPackages((packageResult.data ?? []) as TipsterPackage[]);
    setCards(loadedCards);
    setMeetings(loadedMeetings);
    setFavourite(Boolean(favouriteResult.data));
    setError(firstError?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProfile();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadProfile]);

  const meetingById = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.id, meeting])),
    [meetings],
  );
  const availableCards = cards.filter((card) => {
    const meeting = meetingById.get(card.meeting_id);
    return meetingCardSalesOpen(meeting, loadedAt);
  });

  function requireClient(action: string) {
    if (userId) {
      return true;
    }

    const currentPath = `${window.location.pathname}${window.location.search}`;
    window.location.assign(
      `/login/?next=${encodeURIComponent(currentPath)}&action=${action}`,
    );
    return false;
  }

  async function toggleFavourite() {
    const supabase = createClient();

    if (!supabase || !tipster || !requireClient("favourite")) {
      return;
    }

    setProcessing("favourite");
    const response = favourite
      ? await supabase
          .from("client_tipster_favourites")
          .delete()
          .eq("user_id", userId)
          .eq("tipster_id", tipster.id)
      : await supabase
          .from("client_tipster_favourites")
          .insert({ user_id: userId, tipster_id: tipster.id });

    if (response.error) {
      setError(response.error.message);
    } else {
      setFavourite(!favourite);
    }
    setProcessing("");
  }

  async function purchaseMeeting(card: TipCard) {
    const supabase = createClient();

    if (!supabase || !requireClient("meeting")) {
      return;
    }

    setProcessing(card.id);
    setError("");
    const { error: purchaseError } = await supabase.rpc(
      "purchase_meeting_card",
      {
        p_tip_card_id: card.id,
        p_idempotency_key: crypto.randomUUID(),
      },
    );

    setProcessing("");
    if (purchaseError) {
      setError(purchaseError.message);
    } else {
      setMessage("The full meeting card is now available in your client dashboard.");
    }
  }

  async function purchaseSubscription(tipsterPackage: TipsterPackage) {
    const supabase = createClient();

    if (!supabase || !requireClient("subscription")) {
      return;
    }

    setProcessing(tipsterPackage.id);
    setError("");
    const { error: purchaseError } = await supabase.rpc(
      "purchase_tipster_subscription",
      {
        p_package_id: tipsterPackage.id,
        p_idempotency_key: crypto.randomUUID(),
      },
    );

    setProcessing("");
    if (purchaseError) {
      setError(purchaseError.message);
    } else {
      setMessage(
        "Your subscription starts immediately and will not auto-renew.",
      );
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60svh] w-full max-w-7xl items-center justify-center px-4 py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  if (!tipster) {
    return (
      <main className="mx-auto min-h-[60svh] w-full max-w-3xl px-4 py-12">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Tipster not found</AlertTitle>
          <AlertDescription>{error || "This profile is not publicly available."}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Action failed</AlertTitle>
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

      <Card className="overflow-hidden border-brand-gold/30 bg-brand-purple-deep text-white">
        <CardContent className="grid gap-8 p-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Badge className="bg-brand-gold text-brand-purple-deep">
              <BadgeCheck className="size-3" />
              Verified tipster
            </Badge>
            <h1 className="mt-5 font-heading text-4xl">{tipster.display_name}</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-white/72">
              {tipster.biography || "Verified South African horse-racing tipster."}
            </p>
          </div>
          <div className="grid min-w-60 grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/12 bg-white/8 p-4">
              <p className="text-xs text-white/62">Winner strike rate</p>
              <p className="mt-1 font-mono text-2xl font-bold">
                {stats?.winner_strike_rate === null ||
                stats?.winner_strike_rate === undefined
                  ? "—"
                  : `${Number(stats.winner_strike_rate).toFixed(1)}%`}
              </p>
            </div>
            <div className="rounded-lg border border-white/12 bg-white/8 p-4">
              <p className="text-xs text-white/62">Settled tips</p>
              <p className="mt-1 font-mono text-2xl font-bold">
                {stats?.settled_winner_tips ?? 0}
              </p>
            </div>
            <Button
              type="button"
              variant={favourite ? "default" : "outline"}
              className="col-span-2"
              disabled={processing === "favourite"}
              onClick={() => void toggleFavourite()}
            >
              {processing === "favourite" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Heart className={favourite ? "size-4 fill-current" : "size-4"} />
              )}
              {favourite ? "Favourite tipster" : "Add to favourites"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <BadgeCheck className="size-4" />
        <AlertTitle>Truthful performance reporting</AlertTitle>
        <AlertDescription>
          Winner strike rate uses resulted races only. ROI remains hidden until
          authoritative odds or dividends support a verified unit-stake calculation.
        </AlertDescription>
      </Alert>

      <section>
        <h2 className="flex items-center gap-2 font-heading text-2xl text-white">
          <CalendarDays className="size-5 text-brand-gold" />
          Upcoming meeting cards
        </h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {availableCards.map((card) => {
            const meeting = meetingById.get(card.meeting_id);

            return (
              <Card key={card.id}>
                <CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{card.status.replace("_", " ")}</Badge>
                    <Badge variant="outline">{formatCredits(card.coin_price)}</Badge>
                  </div>
                  <CardTitle>{card.title}</CardTitle>
                  <CardDescription>
                    {meeting
                      ? `${meeting.venue} · ${formatRaceDateTime(meeting.first_race_at)}`
                      : "Meeting details unavailable"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {card.summary || "Complete premium meeting analysis."}
                  </p>
                  <Button
                    className="mt-5"
                    disabled={processing === card.id}
                    onClick={() => void purchaseMeeting(card)}
                  >
                    {processing === card.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                    Unlock full meeting
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          {!availableCards.length ? (
            <p className="text-sm text-muted-foreground">
              No meeting cards are listed for this tipster yet.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 font-heading text-2xl text-white">
          <ShieldCheck className="size-5 text-brand-cyan" />
          Subscription options
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Starts immediately, covers meetings starting during the active period, and
          never auto-renews.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {packages.map((tipsterPackage) => (
            <Card key={tipsterPackage.id}>
              <CardHeader>
                <Badge className="w-fit" variant="outline">
                  {tipsterPackage.duration_months} month
                  {tipsterPackage.duration_months > 1 ? "s" : ""}
                </Badge>
                <CardTitle>{tipsterPackage.name}</CardTitle>
                <CardDescription>
                  {formatCredits(tipsterPackage.coin_price)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  disabled={processing === tipsterPackage.id}
                  onClick={() => void purchaseSubscription(tipsterPackage)}
                >
                  {processing === tipsterPackage.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  Subscribe
                </Button>
              </CardContent>
            </Card>
          ))}
          {!packages.length ? (
            <p className="text-sm text-muted-foreground">
              This tipster has not enabled subscription packages.
            </p>
          ) : null}
        </div>
      </section>

      <Button asChild variant="outline">
        <Link href="/tipsters/">Back to all tipsters</Link>
      </Button>
    </main>
  );
}
