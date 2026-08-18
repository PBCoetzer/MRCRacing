"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Heart,
  Loader2,
  Trophy,
  Users,
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
import type {
  ClientTipsterFavourite,
  TipsterPerformanceStats,
  TipsterProfile,
} from "@/lib/racing/types";
import { createClient } from "@/lib/supabase/client";

function TipsterCard({
  tipster,
  stats,
  favourite,
  onFavourite,
}: {
  tipster: TipsterProfile;
  stats?: TipsterPerformanceStats;
  favourite: boolean;
  onFavourite: (tipsterId: string, favourite: boolean) => void;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <Badge className="w-fit">
            <BadgeCheck className="size-3" />
            Verified
          </Badge>
          <Button
            type="button"
            size="icon-sm"
            variant={favourite ? "default" : "outline"}
            aria-label={favourite ? "Remove favourite" : "Add favourite"}
            onClick={() => onFavourite(tipster.id, favourite)}
          >
            <Heart className={favourite ? "size-4 fill-current" : "size-4"} />
          </Button>
        </div>
        <CardTitle className="font-heading text-2xl">{tipster.display_name}</CardTitle>
        <CardDescription className="line-clamp-3">
          {tipster.biography || "Verified South African horse-racing tipster."}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-background/45 p-3">
          <div>
            <p className="text-xs text-muted-foreground">Winner strike rate</p>
            <p className="mt-1 font-mono text-xl font-bold">
              {stats?.winner_strike_rate === null ||
              stats?.winner_strike_rate === undefined
                ? "—"
                : `${Number(stats.winner_strike_rate).toFixed(1)}%`}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Settled sample</p>
            <p className="mt-1 font-mono text-xl font-bold">
              {stats?.settled_winner_tips ?? 0}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          ROI is not shown until authoritative dividends support a verified calculation.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href={`/tipsters/${tipster.slug}/`}>View profile</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function TipsterDirectoryClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tipsters, setTipsters] = useState<TipsterProfile[]>([]);
  const [stats, setStats] = useState<TipsterPerformanceStats[]>([]);
  const [favourites, setFavourites] = useState<ClientTipsterFavourite[]>([]);
  const [userId, setUserId] = useState("");

  const loadDirectory = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [tipsterResult, statsResult, favouriteResult] = await Promise.all([
      supabase
        .from("tipsters")
        .select(
          "id,slug,user_id,display_name,biography,photo_path,is_verified,ranking,commission_rate_override",
        )
        .eq("is_verified", true)
        .order("ranking", { ascending: true, nullsFirst: false }),
      supabase
        .from("tipster_performance_stats")
        .select(
          "tipster_id,published_winner_tips,settled_winner_tips,winner_hits,winner_strike_rate,roi_percent,updated_at",
        ),
      user
        ? supabase
            .from("client_tipster_favourites")
            .select("user_id,tipster_id,created_at")
            .eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const firstError =
      tipsterResult.error ?? statsResult.error ?? favouriteResult.error;

    setUserId(user?.id ?? "");
    setTipsters((tipsterResult.data ?? []) as TipsterProfile[]);
    setStats((statsResult.data ?? []) as TipsterPerformanceStats[]);
    setFavourites(
      (favouriteResult.data ?? []) as ClientTipsterFavourite[],
    );
    setError(firstError?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDirectory();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDirectory]);

  const statsByTipster = useMemo(
    () => new Map(stats.map((item) => [item.tipster_id, item])),
    [stats],
  );
  const favouriteIds = useMemo(
    () => new Set(favourites.map((item) => item.tipster_id)),
    [favourites],
  );
  const favouriteTipsters = tipsters.filter((tipster) =>
    favouriteIds.has(tipster.id),
  );
  const topTipsters = [...tipsters]
    .filter(
      (tipster) =>
        (statsByTipster.get(tipster.id)?.settled_winner_tips ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        Number(statsByTipster.get(right.id)?.winner_strike_rate ?? 0) -
        Number(statsByTipster.get(left.id)?.winner_strike_rate ?? 0),
    )
    .slice(0, 3);

  async function toggleFavourite(tipsterId: string, favourite: boolean) {
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    if (!userId) {
      window.location.assign(
        `/login/?next=${encodeURIComponent("/tipsters/")}`,
      );
      return;
    }

    const response = favourite
      ? await supabase
          .from("client_tipster_favourites")
          .delete()
          .eq("user_id", userId)
          .eq("tipster_id", tipsterId)
      : await supabase
          .from("client_tipster_favourites")
          .insert({ user_id: userId, tipster_id: tipsterId });

    if (response.error) {
      setError(response.error.message);
      return;
    }

    await loadDirectory();
  }

  function renderGrid(items: TipsterProfile[]) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((tipster) => (
          <TipsterCard
            key={tipster.id}
            tipster={tipster}
            stats={statsByTipster.get(tipster.id)}
            favourite={favouriteIds.has(tipster.id)}
            onFavourite={(tipsterId, favourite) =>
              void toggleFavourite(tipsterId, favourite)
            }
          />
        ))}
      </div>
    );
  }

  return (
    <main>
      <section className="border-b border-brand-gold/20 bg-brand-purple-deep text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <Badge className="bg-brand-gold text-brand-purple-deep">
            Verified profiles
          </Badge>
          <h1 className="mt-5 font-heading text-4xl sm:text-5xl">
            Discover horse-racing tipsters
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-white/72">
            Compare settled winner strike rates, meeting prices, and each tipster&apos;s
            own non-renewing subscription packages.
          </p>
        </div>
      </section>
      <section className="mx-auto w-full max-w-7xl space-y-12 px-4 py-12 sm:px-6 lg:px-8">
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Tipsters unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <Card>
            <CardContent className="flex min-h-48 items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin text-primary" />
              Loading verified tipsters…
            </CardContent>
          </Card>
        ) : (
          <>
            {favouriteTipsters.length ? (
              <section>
                <h2 className="flex items-center gap-2 font-heading text-2xl text-white">
                  <Heart className="size-5 fill-brand-red text-brand-red" />
                  Your favourite tipsters
                </h2>
                <div className="mt-5">{renderGrid(favouriteTipsters)}</div>
              </section>
            ) : null}
            {topTipsters.length ? (
              <section>
                <h2 className="flex items-center gap-2 font-heading text-2xl text-white">
                  <Trophy className="size-5 text-brand-gold" />
                  Best verified winner strike rates
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ranked only from resulted races, with the settled sample shown.
                </p>
                <div className="mt-5">{renderGrid(topTipsters)}</div>
              </section>
            ) : null}
            <section>
              <h2 className="flex items-center gap-2 font-heading text-2xl text-white">
                <Users className="size-5 text-brand-cyan" />
                All verified tipsters
              </h2>
              <div className="mt-5">{renderGrid(tipsters)}</div>
              {!tipsters.length ? (
                <p className="text-sm text-muted-foreground">
                  No verified tipsters are publicly listed yet.
                </p>
              ) : null}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
