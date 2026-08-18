"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { minimumUpcomingFirstRace } from "@/lib/racing/availability";
import { professionalSourceName, publicSourceUrl } from "@/lib/racing/source-brand";

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

type MeetingRecord = {
  id: string;
  venue: string;
  meeting_date: string;
  first_race_at: string;
  last_race_at: string | null;
  status: string;
  source_name: string;
  source_url: string | null;
  source_updated_at: string | null;
};

type MeetingState = {
  data: MeetingRecord[];
  fixtures: RaceRecord[];
  error: string;
  loading: boolean;
};

function formatRaceClock(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function formatMeetingDay(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "short",
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

export function UpcomingMeetingBoard() {
  const [state, setState] = useState<MeetingState>(() => ({
    data: [],
    fixtures: [],
    error: isSupabaseConfigured
      ? ""
      : "The live race database is not configured for this build.",
    loading: isSupabaseConfigured,
  }));

  useEffect(() => {
    let isActive = true;
    const supabase = createClient();

    if (!supabase) {
      return;
    }

    async function loadUpcomingMeetings() {
      const response = await supabase
        .from("race_meetings")
        .select(
          "id,venue,meeting_date,first_race_at,last_race_at,status,source_name,source_url,source_updated_at",
        )
        .eq("status", "scheduled")
        .gt("first_race_at", minimumUpcomingFirstRace())
        .order("first_race_at", { ascending: true })
        .limit(7);

      if (!isActive) {
        return;
      }

      const meetings = (response.data ?? []) as MeetingRecord[];
      let fixtures: RaceRecord[] = [];
      let fixtureError = "";

      if (meetings.length) {
        const fixtureResponse = await supabase
          .from("fixtures")
          .select(
            "id,meeting_id,title,venue,league,starts_at,status,result_summary,source_name,source_url,source_updated_at,race_number",
          )
          .in("meeting_id", meetings.map((meeting) => meeting.id))
          .order("starts_at", { ascending: true });

        fixtures = (fixtureResponse.data ?? []) as RaceRecord[];
        fixtureError = fixtureResponse.error?.message ?? "";
      }

      setState({
        data: meetings,
        fixtures,
        error: response.error?.message ?? fixtureError,
        loading: false,
      });
    }

    void loadUpcomingMeetings();
    const intervalId = window.setInterval(() => {
      void loadUpcomingMeetings();
    }, 60_000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  if (state.loading) {
    return (
      <div className="rounded-lg border border-brand-gold/16 bg-white/8 p-4 text-sm text-white/72">
        Loading upcoming race meetings from the live database…
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
        <p className="font-semibold">No upcoming public meetings have been imported yet.</p>
        <p className="mt-1 text-sm text-white/68">
          The database is ready for a licensed South African racing feed. Unsourced demo races are
          intentionally not shown.
        </p>
      </div>
    );
  }

  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-4">
      {state.data.map((meeting) => {
        const sourceUrl = publicSourceUrl(meeting.source_name, meeting.source_url);
        const meetingFixtures = state.fixtures.filter(
          (fixture) => "meeting_id" in fixture &&
            String((fixture as RaceRecord & { meeting_id: string }).meeting_id) === meeting.id,
        );

        return (
          <article
            key={meeting.id}
            className="min-w-[18rem] snap-start rounded-xl border border-brand-gold/24 bg-brand-purple-deep/70 p-5 text-white shadow-[0_18px_44px_rgba(0,0,0,0.24)] sm:min-w-[22rem]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-brand-cyan">
                  {formatMeetingDay(meeting.first_race_at)}
                </p>
                <h3 className="mt-1 font-heading text-xl">{meeting.venue}</h3>
              </div>
              <Badge
                variant="outline"
                className="border-brand-gold/45 text-brand-gold capitalize"
              >
                {meeting.status.replace("_", " ")}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {meetingFixtures.map((race) => (
                <span
                  key={race.id}
                  className="rounded-md border border-white/12 bg-white/8 px-2.5 py-1.5 text-xs"
                >
                  R{(race as RaceRecord & { race_number: number }).race_number}{" "}
                  <span className="text-white/66">{formatRaceClock(race.starts_at)}</span>
                </span>
              ))}
              {!meetingFixtures.length ? (
                <span className="text-sm text-white/64">Race times awaiting import</span>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs text-white/62">
              <span>
                Verified by {professionalSourceName(meeting.source_name)} · Updated {formatSyncTime(meeting.source_updated_at)}
              </span>
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-cyan hover:underline"
                >
                  Source
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export const UpcomingRaceBoard = UpcomingMeetingBoard;
