"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, Database, ExternalLink, Flag, RefreshCw, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicRaceMeeting } from "@/lib/public-content";
import { professionalSourceName, publicSourceUrl } from "@/lib/racing/source-brand";
import { createClient } from "@/lib/supabase/client";

const LIVE_REFRESH_MS = 60_000;
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "abandoned"]);

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function normalizeMeetingSources(meeting: PublicRaceMeeting): PublicRaceMeeting {
  return {
    ...meeting,
    sourceName: professionalSourceName(meeting.sourceName),
    sourceUrl: publicSourceUrl(meeting.sourceName, meeting.sourceUrl),
    races: meeting.races.map((race) => ({
      ...race,
      sourceName: professionalSourceName(race.sourceName),
      sourceUrl: publicSourceUrl(race.sourceName, race.sourceUrl),
    })),
  };
}

export function PublicRaceMeetingLive({ initialMeeting }: { initialMeeting: PublicRaceMeeting }) {
  const [meeting, setMeeting] = useState(initialMeeting);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    async function refreshMeeting() {
      const supabase = createClient();
      if (!supabase) {
        setLiveError("Live race data is temporarily unavailable. The last verified snapshot is shown.");
        return;
      }

      setRefreshing(true);
      const { data, error } = await supabase.rpc("get_public_race_meeting", {
        p_venue_slug: initialMeeting.venueSlug,
        p_meeting_date: initialMeeting.meetingDate,
      });

      if (disposed) return;

      setRefreshing(false);
      setLastCheckedAt(new Date().toISOString());

      if (error || !data) {
        setLiveError("Live race data could not be refreshed. The last verified snapshot is shown.");
        refreshTimer = setTimeout(refreshMeeting, LIVE_REFRESH_MS);
        return;
      }

      const refreshedMeeting = normalizeMeetingSources(data as PublicRaceMeeting);
      setMeeting(refreshedMeeting);
      setLiveError(null);

      if (!TERMINAL_STATUSES.has(refreshedMeeting.status)) {
        refreshTimer = setTimeout(refreshMeeting, LIVE_REFRESH_MS);
      }
    }

    void refreshMeeting();

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [initialMeeting.meetingDate, initialMeeting.venueSlug]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{meeting.status.replaceAll("_", " ")}</Badge>
        <span className="inline-flex items-center gap-1.5 text-xs text-brand-cyan" aria-live="polite">
          {refreshing ? <RefreshCw className="size-3 animate-spin" /> : <Database className="size-3" />}
          {refreshing
            ? "Refreshing live results"
            : lastCheckedAt
              ? `Live database checked ${formatTime(lastCheckedAt)} SAST`
              : "Live database"}
        </span>
      </div>

      {liveError ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {liveError}
        </p>
      ) : null}

      <h1 className="mt-4 font-heading text-4xl text-white sm:text-5xl">
        {meeting.venue} racecard and results
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">
        {formatDate(meeting.meetingDate)} · All displayed times are South African Standard Time (SAST).
      </p>

      <div className="mt-8 space-y-6">
        {meeting.races.map((race) => (
          <Card key={race.id} className="border-brand-gold/20">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Race {race.raceNumber ?? "—"}</Badge>
                <Badge variant="secondary"><Clock3 className="size-3" />{formatTime(race.startsAt)} SAST</Badge>
              </div>
              <CardTitle>{race.title}</CardTitle>
              <CardDescription>
                {[race.distanceMetres ? `${race.distanceMetres}m` : null, race.raceClass, race.status].filter(Boolean).join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {race.resultSummary ? (
                <p className="mb-4 rounded-lg border border-brand-cyan/25 bg-brand-cyan/8 p-3 text-sm">
                  <Trophy className="mr-2 inline size-4 text-brand-cyan" />{race.resultSummary}
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b text-muted-foreground">
                    <tr><th className="p-2">Pos.</th><th className="p-2">No.</th><th className="p-2">Horse</th><th className="p-2">Jockey</th><th className="p-2">Trainer</th><th className="p-2">Draw</th><th className="p-2">Weight</th><th className="p-2">Status</th></tr>
                  </thead>
                  <tbody>
                    {race.runners.map((runner) => (
                      <tr key={`${race.id}-${runner.saddleNumber}`} className="border-b border-border/50">
                        <td className="p-2 font-mono">{runner.resultPosition ?? "—"}</td>
                        <td className="p-2">{runner.saddleNumber}</td>
                        <td className="p-2 font-semibold text-white">{runner.horseName}</td>
                        <td className="p-2">{runner.jockeyName ?? "—"}</td>
                        <td className="p-2">{runner.trainerName ?? "—"}</td>
                        <td className="p-2">{runner.draw ?? "—"}</td>
                        <td className="p-2">{runner.carriedWeight ? `${runner.carriedWeight} kg` : "—"}</td>
                        <td className="p-2">{runner.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Verified by{" "}
                {publicSourceUrl(race.sourceName, race.sourceUrl) ? (
                  <Link href={publicSourceUrl(race.sourceName, race.sourceUrl) ?? "#"} target="_blank" rel="noreferrer" className="text-brand-cyan underline">
                    {professionalSourceName(race.sourceName)}
                    <ExternalLink className="ml-1 inline size-3" />
                  </Link>
                ) : professionalSourceName(race.sourceName)}
                {race.sourceUpdatedAt ? ` · Updated ${new Date(race.sourceUpdatedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}` : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader><CardTitle className="flex items-center gap-2"><Flag className="size-5 text-brand-gold" />Responsible racing information</CardTitle></CardHeader>
        <CardContent className="text-sm leading-7 text-muted-foreground">
          This page presents factual race and result information, not guaranteed outcomes. MRC Racing Tips does not accept bets. If you choose to gamble, be 18+, set limits, and never chase losses.
        </CardContent>
      </Card>
    </>
  );
}
