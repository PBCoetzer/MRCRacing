"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRequiredClient } from "@/lib/supabase/client";

type FeedSource = {
  id: string;
  name: string;
  source_name: string;
  source_url: string;
  venue_hint: string | null;
  extraction_hint: string | null;
  content_start_marker: string | null;
  content_end_marker: string | null;
  is_enabled: boolean;
  last_http_status: number | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
};

type FeedRun = {
  id: string;
  source_id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  http_status: number | null;
  llm_called: boolean;
  model_name: string | null;
  meetings_seen: number;
  races_seen: number;
  entries_seen: number;
  changes_applied: number;
  alerts_created: number;
  error_message: string | null;
  review_note: string | null;
};

type ChangeEvent = {
  id: string;
  source_id: string;
  meeting_id: string;
  fixture_id: string | null;
  entry_id: string | null;
  entity_type: string;
  change_type: string;
  changed_fields: string[];
  summary: string;
  created_at: string;
};

type SourceForm = {
  id: string;
  name: string;
  sourceName: string;
  sourceUrl: string;
  venueHint: string;
  extractionHint: string;
  startMarker: string;
  endMarker: string;
  enabled: boolean;
};

const emptySourceForm: SourceForm = {
  id: "",
  name: "",
  sourceName: "",
  sourceUrl: "",
  venueHint: "",
  extractionHint: "",
  startMarker: "",
  endMarker: "",
  enabled: true,
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["succeeded", "unchanged"].includes(status)) {
    return "default";
  }
  if (["failed", "rejected"].includes(status)) {
    return "destructive";
  }
  if (status === "quarantined") {
    return "outline";
  }
  return "secondary";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AdminRaceFeedClient() {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [runs, setRuns] = useState<FeedRun[]>([]);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadDashboard = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const supabase = createRequiredClient();
      const [sourceResult, runResult, changeResult] = await Promise.all([
        supabase
          .from("race_feed_sources")
          .select("id,name,source_name,source_url,venue_hint,extraction_hint,content_start_marker,content_end_marker,is_enabled,last_http_status,last_checked_at,last_changed_at,last_success_at,last_error,consecutive_failures")
          .order("name", { ascending: true }),
        supabase
          .from("race_feed_runs")
          .select("id,source_id,trigger_type,status,started_at,completed_at,duration_ms,http_status,llm_called,model_name,meetings_seen,races_seen,entries_seen,changes_applied,alerts_created,error_message,review_note")
          .order("started_at", { ascending: false })
          .limit(30),
        supabase
          .from("race_change_events")
          .select("id,source_id,meeting_id,fixture_id,entry_id,entity_type,change_type,changed_fields,summary,created_at")
          .order("created_at", { ascending: false })
          .limit(40),
      ]);

      const firstError = sourceResult.error ?? runResult.error ?? changeResult.error;

      if (firstError) {
        throw firstError;
      }

      setSources((sourceResult.data ?? []) as FeedSource[]);
      setRuns((runResult.data ?? []) as FeedRun[]);
      setChanges((changeResult.data ?? []) as ChangeEvent[]);
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError, "Could not load the race-feed monitor."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadDashboard(true), 0);
    const intervalId = window.setInterval(() => void loadDashboard(false), 30_000);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [loadDashboard]);

  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  );
  const latestRun = runs[0] ?? null;
  const quarantinedRuns = runs.filter((run) => run.status === "quarantined");
  const failedRuns = runs.filter((run) => run.status === "failed");

  function editSource(source: FeedSource) {
    setSourceForm({
      id: source.id,
      name: source.name,
      sourceName: source.source_name,
      sourceUrl: source.source_url,
      venueHint: source.venue_hint ?? "",
      extractionHint: source.extraction_hint ?? "",
      startMarker: source.content_start_marker ?? "",
      endMarker: source.content_end_marker ?? "",
      enabled: source.is_enabled,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSource() {
    setBusyKey("save-source");
    setError("");
    setSuccess("");

    try {
      const supabase = createRequiredClient();
      const { error: saveError } = await supabase.rpc("admin_upsert_race_feed_source", {
        p_source_id: sourceForm.id || null,
        p_name: sourceForm.name.trim(),
        p_source_name: sourceForm.sourceName.trim(),
        p_source_url: sourceForm.sourceUrl.trim(),
        p_venue_hint: sourceForm.venueHint.trim() || null,
        p_extraction_hint: sourceForm.extractionHint.trim() || null,
        p_content_start_marker: sourceForm.startMarker || null,
        p_content_end_marker: sourceForm.endMarker || null,
        p_is_enabled: sourceForm.enabled,
      });

      if (saveError) {
        throw saveError;
      }

      setSuccess(sourceForm.id ? "Race-feed source updated." : "Race-feed source created.");
      setSourceForm(emptySourceForm);
      await loadDashboard();
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save the race-feed source."));
    } finally {
      setBusyKey("");
    }
  }

  async function toggleSource(source: FeedSource) {
    setBusyKey(`toggle-${source.id}`);
    setError("");

    try {
      const supabase = createRequiredClient();
      const { error: toggleError } = await supabase.rpc("admin_upsert_race_feed_source", {
        p_source_id: source.id,
        p_name: source.name,
        p_source_name: source.source_name,
        p_source_url: source.source_url,
        p_venue_hint: source.venue_hint,
        p_extraction_hint: source.extraction_hint,
        p_content_start_marker: source.content_start_marker,
        p_content_end_marker: source.content_end_marker,
        p_is_enabled: !source.is_enabled,
      });

      if (toggleError) {
        throw toggleError;
      }

      await loadDashboard();
    } catch (toggleError) {
      setError(errorMessage(toggleError, "Could not update the source status."));
    } finally {
      setBusyKey("");
    }
  }

  async function runSource(sourceId?: string, retry = false) {
    setBusyKey(sourceId ? `run-${sourceId}` : "run-all");
    setError("");
    setSuccess("");

    try {
      const supabase = createRequiredClient();
      const { data, error: invokeError } = await supabase.functions.invoke("sync-race-data", {
        body: { sourceId, trigger: retry ? "retry" : "manual" },
      });

      if (invokeError) {
        throw invokeError;
      }

      const failureCount = Number((data as { failures?: number } | null)?.failures ?? 0);
      setSuccess(failureCount ? `Sync completed with ${failureCount} failure(s).` : "Race-feed sync completed.");
      await loadDashboard();
    } catch (invokeError) {
      setError(errorMessage(invokeError, "Could not invoke the race-feed worker."));
    } finally {
      setBusyKey("");
    }
  }

  async function reviewRun(runId: string, decision: "approve" | "reject") {
    const note = reviewNotes[runId]?.trim() ?? "";

    if (note.length < 5) {
      setError("Enter a review note of at least five characters.");
      return;
    }

    setBusyKey(`${decision}-${runId}`);
    setError("");
    setSuccess("");

    try {
      const supabase = createRequiredClient();
      const { error: reviewError } = await supabase.rpc("admin_review_race_feed_run", {
        p_run_id: runId,
        p_decision: decision,
        p_note: note,
      });

      if (reviewError) {
        throw reviewError;
      }

      setSuccess(`Quarantined run ${decision === "approve" ? "approved" : "rejected"}.`);
      setReviewNotes((current) => ({ ...current, [runId]: "" }));
      await loadDashboard();
    } catch (reviewError) {
      setError(errorMessage(reviewError, "Could not review the quarantined run."));
    } finally {
      setBusyKey("");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <RefreshCw className="size-4 animate-spin text-brand-cyan" />
          Loading race-feed operations…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Race-feed action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Completed</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Enabled sources</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{sources.filter((source) => source.is_enabled).length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Latest run</CardDescription></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold capitalize">{latestRun?.status ?? "No runs"}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(latestRun?.started_at ?? null)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Awaiting review</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{quarantinedRuns.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Recent failures</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{failedRuns.length}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="size-5 text-brand-cyan" />{sourceForm.id ? "Edit approved source" : "Add approved source"}</CardTitle>
          <CardDescription>The worker fetches only configured HTTPS pages. Screenshots and race data are not uploaded here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="feed-name">Internal name</Label><Input id="feed-name" value={sourceForm.name} onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Vaal racecard source" /></div>
            <div className="grid gap-2"><Label htmlFor="feed-source-name">Public source label</Label><Input id="feed-source-name" value={sourceForm.sourceName} onChange={(event) => setSourceForm((current) => ({ ...current, sourceName: event.target.value }))} placeholder="Approved race source" /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="feed-url">Source URL</Label><Input id="feed-url" type="url" value={sourceForm.sourceUrl} onChange={(event) => setSourceForm((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://…" /></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="feed-venue">Venue hint</Label><Input id="feed-venue" value={sourceForm.venueHint} onChange={(event) => setSourceForm((current) => ({ ...current, venueHint: event.target.value }))} placeholder="Optional venue or country hint" /></div>
            <div className="grid gap-2"><Label htmlFor="feed-extraction">Extraction hint</Label><Input id="feed-extraction" value={sourceForm.extractionHint} onChange={(event) => setSourceForm((current) => ({ ...current, extractionHint: event.target.value }))} placeholder="Where racecard content appears" /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="feed-start-marker">Content start marker</Label><Input id="feed-start-marker" value={sourceForm.startMarker} onChange={(event) => setSourceForm((current) => ({ ...current, startMarker: event.target.value }))} placeholder="Optional exact page text" /></div>
            <div className="grid gap-2"><Label htmlFor="feed-end-marker">Content end marker</Label><Input id="feed-end-marker" value={sourceForm.endMarker} onChange={(event) => setSourceForm((current) => ({ ...current, endMarker: event.target.value }))} placeholder="Optional exact page text" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sourceForm.enabled} onChange={(event) => setSourceForm((current) => ({ ...current, enabled: event.target.checked }))} />Enable five-minute monitoring</label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveSource()} disabled={busyKey === "save-source" || !sourceForm.name.trim() || !sourceForm.sourceName.trim() || !sourceForm.sourceUrl.trim()}>{busyKey === "save-source" ? <RefreshCw className="size-4 animate-spin" /> : null}{sourceForm.id ? "Update source" : "Create source"}</Button>
            {sourceForm.id ? <Button variant="outline" onClick={() => setSourceForm(emptySourceForm)}>Cancel edit</Button> : null}
            <Button variant="outline" onClick={() => void runSource()} disabled={Boolean(busyKey) || !sources.some((source) => source.is_enabled)}><Play className="size-4" />Sync all enabled sources</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><DatabaseZap className="size-5 text-brand-gold" />Approved sources</CardTitle><CardDescription>Conditional requests and content hashes prevent unnecessary LLM calls.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {sources.length ? sources.map((source) => (
            <div key={source.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{source.name}</p><Badge variant={source.is_enabled ? "default" : "secondary"}>{source.is_enabled ? "Enabled" : "Disabled"}</Badge>{source.consecutive_failures ? <Badge variant="destructive">{source.consecutive_failures} failure(s)</Badge> : null}</div>
                  <a href={source.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 block max-w-3xl break-all text-sm text-brand-cyan hover:underline">{source.source_url}</a>
                  <p className="mt-2 text-xs text-muted-foreground">Last checked: {formatDateTime(source.last_checked_at)} · Last success: {formatDateTime(source.last_success_at)} · HTTP {source.last_http_status ?? "—"}</p>
                  {source.last_error ? <p className="mt-2 text-sm text-destructive">{source.last_error}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => editSource(source)}><Pencil className="size-4" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => void toggleSource(source)} disabled={busyKey === `toggle-${source.id}`}>{source.is_enabled ? "Disable" : "Enable"}</Button>
                  <Button size="sm" onClick={() => void runSource(source.id, source.consecutive_failures > 0)} disabled={Boolean(busyKey) || !source.is_enabled}>{busyKey === `run-${source.id}` ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}Sync now</Button>
                </div>
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">No approved source pages are configured yet.</p>}
        </CardContent>
      </Card>

      {quarantinedRuns.length ? (
        <Card className="border-brand-gold/40">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-brand-gold" />Quarantined changes</CardTitle><CardDescription>Identity, meeting-date, venue, and existing-result replacements require an administrator decision.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            {quarantinedRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-brand-gold/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{sourceNames.get(run.source_id) ?? "Unknown source"}</p><Badge variant="outline">Quarantined</Badge></div>
                <p className="mt-2 text-sm text-muted-foreground">{run.error_message ?? "An anomalous change needs review."}</p>
                <Textarea className="mt-3" value={reviewNotes[run.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [run.id]: event.target.value }))} placeholder="Required review note" />
                <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void reviewRun(run.id, "approve")} disabled={Boolean(busyKey)}>Approve and apply</Button><Button size="sm" variant="destructive" onClick={() => void reviewRun(run.id, "reject")} disabled={Boolean(busyKey)}>Reject</Button></div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5 text-brand-cyan" />Recent worker runs</CardTitle><CardDescription>Latest 30 scheduled and administrator-triggered checks.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {runs.length ? runs.map((run) => (
            <div key={run.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1.2fr_.8fr_1fr_1fr] md:items-center">
              <div><p className="font-medium">{sourceNames.get(run.source_id) ?? "Unknown source"}</p><p className="text-xs text-muted-foreground">{formatDateTime(run.started_at)} · {run.trigger_type}</p></div>
              <div><Badge variant={statusVariant(run.status)} className="capitalize">{run.status}</Badge><p className="mt-1 text-xs text-muted-foreground">{run.duration_ms === null ? "Running" : `${run.duration_ms} ms`}</p></div>
              <p className="text-sm">{run.meetings_seen} meetings · {run.races_seen} races · {run.entries_seen} runners</p>
              <p className="text-sm">LLM {run.llm_called ? run.model_name ?? "called" : "skipped"} · {run.changes_applied} changes · {run.alerts_created} alerts</p>
              {run.error_message ? <p className="text-sm text-destructive md:col-span-4">{run.error_message}</p> : null}
            </div>
          )) : <p className="text-sm text-muted-foreground">No worker runs have been recorded.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5 text-brand-gold" />Recent factual changes</CardTitle><CardDescription>Immutable race-data changes and the fields that triggered them.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {changes.length ? changes.map((change) => (
            <div key={change.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{change.summary}</p><div className="flex gap-2"><Badge variant="secondary" className="capitalize">{change.entity_type}</Badge><Badge variant="outline" className="capitalize">{change.change_type}</Badge></div></div>
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(change.created_at)} · {sourceNames.get(change.source_id) ?? "Unknown source"} · {change.changed_fields.join(", ")}</p>
            </div>
          )) : <p className="text-sm text-muted-foreground">No factual race changes have been recorded.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
