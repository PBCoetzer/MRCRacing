"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { PublicRaceMeetingLive } from "@/components/racing/public-race-meeting-live";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PublicRaceMeeting } from "@/lib/public-content";
import { createClient } from "@/lib/supabase/client";

function resolveMeetingIdentity() {
  const query = new URLSearchParams(window.location.search);
  const path = window.location.pathname.split("/").filter(Boolean);
  const cleanRoute = path[0] === "horse-racing" && path.length >= 3 && path[1] !== "meeting";
  return {
    venueSlug: query.get("venue")?.trim() || (cleanRoute ? path[1] : ""),
    meetingDate: query.get("date")?.trim() || (cleanRoute ? path[2] : ""),
  };
}

export function PublicRaceMeetingQueryClient() {
  const [meeting, setMeeting] = useState<PublicRaceMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMeeting = useCallback(async () => {
    const { venueSlug, meetingDate } = resolveMeetingIdentity();
    const supabase = createClient();
    if (!supabase || !venueSlug || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
      setError("Choose a valid public race meeting.");
      setLoading(false);
      return;
    }

    const { data, error: loadError } = await supabase.rpc("get_public_race_meeting", {
      p_venue_slug: venueSlug,
      p_meeting_date: meetingDate,
    });
    setMeeting((data as PublicRaceMeeting | null) ?? null);
    setError(loadError?.message ?? (data ? "" : "This race meeting is not publicly available."));
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadMeeting(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadMeeting]);

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading live racecard…</div>;
  }

  if (!meeting) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Meeting unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return <PublicRaceMeetingLive initialMeeting={meeting} />;
}
