"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const LIVE_REFRESH_MS = 60_000;
const RECENT_PAST_DAYS = 6;
const OLDER_PAGE_SIZE = 200;
const FIXTURE_BATCH_SIZE = 100;

type MeetingRecord = {
  id: string;
  venue: string;
  venue_slug: string;
  meeting_date: string;
  first_race_at: string;
  status: string;
};

type FixtureRecord = {
  id: string;
  meeting_id: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function johannesburgDateOffset(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + days));
  return date.toISOString().slice(0, 10);
}

type BrowserSupabaseClient = NonNullable<ReturnType<typeof createClient>>;

async function loadFixtures(supabase: BrowserSupabaseClient, meetings: MeetingRecord[]) {
  const records: FixtureRecord[] = [];
  for (let index = 0; index < meetings.length; index += FIXTURE_BATCH_SIZE) {
    const meetingIds = meetings.slice(index, index + FIXTURE_BATCH_SIZE).map((meeting) => meeting.id);
    const result = await supabase.from("fixtures").select("id,meeting_id").in("meeting_id", meetingIds);
    if (result.error) throw new Error(result.error.message);
    records.push(...((result.data ?? []) as FixtureRecord[]));
  }
  return records;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The live race database request failed.";
}

export function HorseRacingIndexClient() {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRecord[]>([]);
  const [olderMeetings, setOlderMeetings] = useState<MeetingRecord[]>([]);
  const [olderFixtures, setOlderFixtures] = useState<FixtureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderLoaded, setOlderLoaded] = useState(false);
  const [error, setError] = useState("");
  const [olderError, setOlderError] = useState("");

  const loadMeetings = useCallback(async (background = false) => {
    const supabase = createClient();
    if (!supabase) {
      setError("The live race database is not configured for this website.");
      setLoading(false);
      return;
    }

    if (background) setRefreshing(true);
    else setLoading(true);

    try {
      const meetingResult = await supabase
        .from("race_meetings")
        .select("id,venue,venue_slug,meeting_date,first_race_at,status")
        .eq("is_test", false)
        .gte("meeting_date", johannesburgDateOffset(-RECENT_PAST_DAYS))
        .lte("meeting_date", johannesburgDateOffset(90))
        .order("meeting_date", { ascending: false })
        .order("first_race_at", { ascending: true })
        .limit(250);
      if (meetingResult.error) throw new Error(meetingResult.error.message);

      const loadedMeetings = (meetingResult.data ?? []) as MeetingRecord[];
      const loadedFixtures = await loadFixtures(supabase, loadedMeetings);
      setMeetings(loadedMeetings);
      setFixtures(loadedFixtures);
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadOlderMeetings = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setOlderError("The live race database is not configured for this website.");
      return;
    }

    setLoadingOlder(true);
    setOlderError("");
    try {
      const loadedMeetings: MeetingRecord[] = [];
      let page = 0;
      while (true) {
        const from = page * OLDER_PAGE_SIZE;
        const meetingResult = await supabase
          .from("race_meetings")
          .select("id,venue,venue_slug,meeting_date,first_race_at,status")
          .eq("is_test", false)
          .lt("meeting_date", johannesburgDateOffset(-RECENT_PAST_DAYS))
          .order("meeting_date", { ascending: false })
          .order("first_race_at", { ascending: true })
          .range(from, from + OLDER_PAGE_SIZE - 1);
        if (meetingResult.error) throw new Error(meetingResult.error.message);

        const pageMeetings = (meetingResult.data ?? []) as MeetingRecord[];
        loadedMeetings.push(...pageMeetings);
        if (pageMeetings.length < OLDER_PAGE_SIZE) break;
        page += 1;
      }

      setOlderMeetings(loadedMeetings);
      setOlderFixtures(await loadFixtures(supabase, loadedMeetings));
      setOlderLoaded(true);
    } catch (loadError) {
      setOlderError(errorMessage(loadError));
    } finally {
      setLoadingOlder(false);
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void loadMeetings(), 0);
    const refresh = window.setInterval(() => void loadMeetings(true), LIVE_REFRESH_MS);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(refresh);
    };
  }, [loadMeetings]);

  const raceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    [...fixtures, ...olderFixtures].forEach((fixture) => counts.set(fixture.meeting_id, (counts.get(fixture.meeting_id) ?? 0) + 1));
    return counts;
  }, [fixtures, olderFixtures]);

  const visibleMeetings = useMemo(() => [...meetings, ...olderMeetings], [meetings, olderMeetings]);

  if (loading) {
    return (
      <div className="flex min-h-52 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />Loading live race meetings…
      </div>
    );
  }

  if (error && !meetings.length) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Race feed unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Meeting cards refresh directly from the MRC race database every minute.
        </p>
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => void loadMeetings(true)}>
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />Refresh
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="size-4" />
          <AlertTitle>Latest refresh failed</AlertTitle>
          <AlertDescription>The last successfully loaded meetings remain visible.</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visibleMeetings.map((meeting) => (
          <a
            key={meeting.id}
            href={`/horse-racing/meeting/?venue=${encodeURIComponent(meeting.venue_slug)}&date=${encodeURIComponent(meeting.meeting_date)}`}
            className="group"
          >
            <Card className="h-full transition group-hover:border-brand-gold/60">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <Badge>{meeting.status.replaceAll("_", " ")}</Badge>
                  <span className="text-xs text-muted-foreground">{raceCounts.get(meeting.id) ?? 0} races</span>
                </div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="size-5 text-brand-gold" />{meeting.venue}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="size-4 text-brand-cyan" />{formatDate(meeting.meeting_date)}
                </p>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
      {olderError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle className="size-4" />
          <AlertTitle>Older results unavailable</AlertTitle>
          <AlertDescription>{olderError}</AlertDescription>
        </Alert>
      ) : null}
      {!olderLoaded ? (
        <div className="mt-8 flex flex-col items-center gap-2 border-t border-border/70 pt-8">
          <Button type="button" variant="outline" disabled={loadingOlder} onClick={() => void loadOlderMeetings()}>
            {loadingOlder ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
            {loadingOlder ? "Loading older results…" : "Load older results"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Older meetings are fetched only when requested.
          </p>
        </div>
      ) : null}
      {!visibleMeetings.length ? (
        <p className="mt-8 rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          No public race meetings are currently available.
        </p>
      ) : null}
    </>
  );
}
