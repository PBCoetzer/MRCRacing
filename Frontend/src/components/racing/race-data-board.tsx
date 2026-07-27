"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CalendarClock, Database, ExternalLink, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type RaceRecord = {
  id: string;
  title: string;
  venue: string | null;
  league: string | null;
  starts_at: string;
  status: string;
  result_summary: string | null;
  source_name: string | null;
  source_url: string | null;
  source_updated_at: string | null;
};

type RaceState = {
  data: RaceRecord[];
  error: string;
  loading: boolean;
};

const initialState: RaceState = {
  data: [],
  error: "",
  loading: true,
};

function createInitialState(error: string): RaceState {
  if (isSupabaseConfigured) {
    return initialState;
  }

  return {
    data: [],
    error,
    loading: false,
  };
}

function formatRaceTime(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function formatSyncTime(value: string | null) {
  if (!value) {
    return "Awaiting first sync";
  }

  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function SourceLine({ race }: { race: RaceRecord }) {
  const label = race.source_name || "MRC manual entry";
  const safeSourceUrl = race.source_url?.startsWith("https://") ? race.source_url : null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/62">
      <span>Source: {label}</span>
      <span>Updated: {formatSyncTime(race.source_updated_at)}</span>
      {safeSourceUrl ? (
        <a
          href={safeSourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand-cyan hover:underline"
        >
          Verify
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

export function UpcomingRaceBoard() {
  const [state, setState] = useState<RaceState>(() =>
    createInitialState("The live race database is not configured for this build."),
  );

  useEffect(() => {
    let isActive = true;
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    async function loadUpcomingRaces() {
      const response = await supabase
        .from("fixtures")
        .select(
          "id,title,venue,league,starts_at,status,result_summary,source_name,source_url,source_updated_at",
        )
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(6);

      if (!isActive) {
        return;
      }

      setState({
        data: (response.data ?? []) as RaceRecord[],
        error: response.error?.message ?? "",
        loading: false,
      });
    }

    void loadUpcomingRaces();

    return () => {
      isActive = false;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="rounded-lg border border-brand-gold/16 bg-white/8 p-4 text-sm text-white/72">
        Loading upcoming races from the live database…
      </div>
    );
  }

  if (state.error) {
    return (
      <Alert variant="destructive" className="border-brand-red/40 bg-brand-red/10 text-white">
        <AlertCircle className="size-4" />
        <AlertTitle>Race feed unavailable</AlertTitle>
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  }

  if (state.data.length === 0) {
    return (
      <div className="rounded-lg border border-brand-gold/20 bg-white/8 p-4">
        <p className="font-semibold">No upcoming races have been imported yet.</p>
        <p className="mt-1 text-sm text-white/68">
          The database is ready for a licensed South African racing feed. Unsourced demo races are
          intentionally not shown.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {state.data.map((race) => (
        <div key={race.id} className="rounded-lg border border-brand-gold/16 bg-white/8 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase text-brand-cyan">
                {race.venue || race.league || "South African racing"}
              </p>
              <p className="mt-1 font-semibold">{race.title}</p>
              <p className="text-sm text-white/68">{formatRaceTime(race.starts_at)}</p>
            </div>
            <Badge variant="outline" className="border-brand-gold/30 text-brand-gold">
              {race.status}
            </Badge>
          </div>
          <SourceLine race={race} />
        </div>
      ))}
    </div>
  );
}

export function RaceResultsHistory() {
  const [state, setState] = useState<RaceState>(() =>
    createInitialState("The results database is not configured for this build."),
  );

  useEffect(() => {
    let isActive = true;
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    async function loadResultsHistory() {
      const response = await supabase
        .from("fixtures")
        .select(
          "id,title,venue,league,starts_at,status,result_summary,source_name,source_url,source_updated_at",
        )
        .not("result_summary", "is", null)
        .order("starts_at", { ascending: false })
        .limit(6);

      if (!isActive) {
        return;
      }

      setState({
        data: (response.data ?? []) as RaceRecord[],
        error: response.error?.message ?? "",
        loading: false,
      });
    }

    void loadResultsHistory();

    return () => {
      isActive = false;
    };
  }, []);

  if (state.loading) {
    return (
      <Card className="lg:col-span-3">
        <CardContent className="flex items-center gap-3 py-3 text-muted-foreground">
          <Database className="size-4 text-brand-cyan" />
          Loading verified race history…
        </CardContent>
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card className="lg:col-span-3 border-brand-red/35">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-brand-red" />
            Results feed unavailable
          </CardTitle>
          <CardDescription>{state.error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.data.length === 0) {
    return (
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-brand-gold" />
            Verified results history
          </CardTitle>
          <CardDescription>
            Results will appear here after the first licensed data import. Each result retains its
            source link and sync timestamp.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return state.data.map((race) => (
    <Card key={race.id}>
      <CardHeader>
        <CardTitle className="flex items-start gap-2 text-lg">
          <Trophy className="mt-0.5 size-4 shrink-0 text-brand-gold" />
          {race.title}
        </CardTitle>
        <CardDescription>
          {race.venue || race.league || "South African racing"} · {formatRaceTime(race.starts_at)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-semibold">{race.result_summary}</p>
        <div className="mt-3 text-xs text-muted-foreground">
          <p>Source: {race.source_name || "MRC manual entry"}</p>
          <p>Updated: {formatSyncTime(race.source_updated_at)}</p>
          {race.source_url?.startsWith("https://") ? (
            <a
              href={race.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-brand-cyan hover:underline"
            >
              Verify result
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  ));
}
