"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  ExternalLink,
  FileSearch,
  Play,
  RefreshCw,
  SearchCheck,
  Settings2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createRequiredClient } from "@/lib/supabase/client";

type FeedSettings = {
  confidence_threshold: number;
  minimum_approved_sources: number;
  auto_approve_new_meetings: boolean;
  auto_approve_routine_changes: boolean;
  auto_approve_results: boolean;
  future_lookahead_days: number;
  daily_search_limit: number;
  last_weekly_discovery_at: string | null;
};

type FeedProposal = {
  id: string;
  parent_proposal_id: string | null;
  meeting_key: string;
  meeting_external_id: string;
  venue: string;
  meeting_date: string;
  proposal_version: number;
  change_type: string;
  status: string;
  snapshot: {
    meetings?: Array<{
      races?: Array<{ runners?: unknown[] }>;
    }>;
  };
  current_diff: Record<string, unknown>;
  validation_outcome: Record<string, unknown>;
  confidence_score: number;
  confidence_breakdown: Record<string, number | boolean>;
  distinct_source_count: number;
  approved_source_count: number;
  has_critical_conflict: boolean;
  conflict_summary: string | null;
  auto_approval_eligible: boolean;
  research_guidance: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
};

type FeedEvidence = {
  id: string;
  proposal_id: string;
  source_url: string;
  source_title: string | null;
  retrieved_at: string;
  evidence_excerpt: string | null;
  fact_scope: string;
  domain_id: string;
};

type SourceDomain = {
  id: string;
  domain: string;
  display_name: string;
  status: "approved" | "evidence_only" | "blocked";
  reliability_score: number;
  reuse_basis: string | null;
  direct_fetch_allowed: boolean;
  can_auto_approve: boolean;
  last_reviewed_at: string | null;
};

type FeedTask = {
  id: string;
  task_type: string;
  state: string;
  venue: string | null;
  meeting_date: string | null;
  race_number: number | null;
  due_at: string;
  attempts: number;
  last_error: string | null;
  last_completed_at: string | null;
};

type FeedFragment = {
  id: string;
  fragment_type: string;
  meeting_key: string | null;
  venue: string | null;
  meeting_date: string | null;
  race_number: number | null;
  created_at: string;
};

type FeedRun = {
  id: string;
  trigger_type: string;
  status: string;
  search_model_name: string | null;
  extraction_model_name: string | null;
  search_query_count: number;
  evidence_count: number;
  changes_applied: number;
  alerts_created: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
};

type ChangeEvent = {
  id: string;
  entity_type: string;
  change_type: string;
  changed_fields: string[];
  summary: string;
  created_at: string;
};

type DomainDraft = {
  displayName: string;
  status: SourceDomain["status"];
  reliabilityScore: string;
  reuseBasis: string;
  directFetchAllowed: boolean;
  canAutoApprove: boolean;
};

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["succeeded", "approved", "auto_approved", "completed"].includes(status)) return "default";
  if (["failed", "rejected", "blocked"].includes(status)) return "destructive";
  if (["pending", "pending_approval", "quarantined", "running"].includes(status)) return "outline";
  return "secondary";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function proposalCounts(proposal: FeedProposal) {
  const races = proposal.snapshot.meetings?.[0]?.races ?? [];
  return {
    races: races.length,
    runners: races.reduce((total, race) => total + (race.runners?.length ?? 0), 0),
  };
}

export function AdminRaceFeedClient() {
  const [settings, setSettings] = useState<FeedSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<FeedSettings | null>(null);
  const [proposals, setProposals] = useState<FeedProposal[]>([]);
  const [evidence, setEvidence] = useState<FeedEvidence[]>([]);
  const [domains, setDomains] = useState<SourceDomain[]>([]);
  const [domainDrafts, setDomainDrafts] = useState<Record<string, DomainDraft>>({});
  const [tasks, setTasks] = useState<FeedTask[]>([]);
  const [fragments, setFragments] = useState<FeedFragment[]>([]);
  const [runs, setRuns] = useState<FeedRun[]>([]);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [researchNotes, setResearchNotes] = useState<Record<string, string>>({});
  const [manualResearch, setManualResearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadDashboard = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);

    try {
      const supabase = createRequiredClient();
      const [
        settingsResult,
        proposalResult,
        domainResult,
        taskResult,
        fragmentResult,
        runResult,
        changeResult,
      ] = await Promise.all([
        supabase.from("race_feed_settings").select("confidence_threshold,minimum_approved_sources,auto_approve_new_meetings,auto_approve_routine_changes,auto_approve_results,future_lookahead_days,daily_search_limit,last_weekly_discovery_at").single(),
        supabase.from("race_feed_proposals").select("id,parent_proposal_id,meeting_key,meeting_external_id,venue,meeting_date,proposal_version,change_type,status,snapshot,current_diff,validation_outcome,confidence_score,confidence_breakdown,distinct_source_count,approved_source_count,has_critical_conflict,conflict_summary,auto_approval_eligible,research_guidance,review_note,created_at,reviewed_at,applied_at").order("created_at", { ascending: false }).limit(40),
        supabase.from("race_source_domains").select("id,domain,display_name,status,reliability_score,reuse_basis,direct_fetch_allowed,can_auto_approve,last_reviewed_at").order("domain", { ascending: true }),
        supabase.from("race_feed_tasks").select("id,task_type,state,venue,meeting_date,race_number,due_at,attempts,last_error,last_completed_at").order("created_at", { ascending: false }).limit(60),
        supabase.from("race_feed_fragments").select("id,fragment_type,meeting_key,venue,meeting_date,race_number,created_at").eq("is_current", true).order("created_at", { ascending: false }).limit(100),
        supabase.from("race_feed_runs").select("id,trigger_type,status,search_model_name,extraction_model_name,search_query_count,evidence_count,changes_applied,alerts_created,error_message,started_at,completed_at,duration_ms").order("started_at", { ascending: false }).limit(40),
        supabase.from("race_change_events").select("id,entity_type,change_type,changed_fields,summary,created_at").order("created_at", { ascending: false }).limit(40),
      ]);
      const firstError = settingsResult.error
        ?? proposalResult.error
        ?? domainResult.error
        ?? taskResult.error
        ?? fragmentResult.error
        ?? runResult.error
        ?? changeResult.error;
      if (firstError) throw firstError;

      const loadedProposals = (proposalResult.data ?? []) as FeedProposal[];
      const proposalIds = loadedProposals.map((proposal) => proposal.id);
      const evidenceResult = proposalIds.length
        ? await supabase.from("race_feed_evidence").select("id,proposal_id,source_url,source_title,retrieved_at,evidence_excerpt,fact_scope,domain_id").in("proposal_id", proposalIds).order("retrieved_at", { ascending: false })
        : { data: [], error: null };
      if (evidenceResult.error) throw evidenceResult.error;

      const loadedSettings = settingsResult.data as FeedSettings;
      const loadedDomains = (domainResult.data ?? []) as SourceDomain[];
      setSettings(loadedSettings);
      setSettingsDraft(loadedSettings);
      setProposals(loadedProposals);
      setEvidence((evidenceResult.data ?? []) as FeedEvidence[]);
      setDomains(loadedDomains);
      setDomainDrafts(Object.fromEntries(loadedDomains.map((domain) => [domain.id, {
        displayName: domain.display_name,
        status: domain.status,
        reliabilityScore: String(domain.reliability_score),
        reuseBasis: domain.reuse_basis ?? "",
        directFetchAllowed: domain.direct_fetch_allowed,
        canAutoApprove: domain.can_auto_approve,
      }])));
      setTasks((taskResult.data ?? []) as FeedTask[]);
      setFragments((fragmentResult.data ?? []) as FeedFragment[]);
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

  const domainNames = useMemo(
    () => new Map(domains.map((domain) => [domain.id, domain.domain])),
    [domains],
  );
  const pendingProposals = proposals.filter((proposal) => ["pending", "quarantined"].includes(proposal.status));
  const failedTasks = tasks.filter((task) => task.state === "failed");
  const searchesToday = runs
    .filter((run) => new Date(run.started_at).toDateString() === new Date().toDateString())
    .reduce((total, run) => total + run.search_query_count, 0);
  const latestRun = runs[0] ?? null;
  const quotaBlocked = runs.some((run) => run.error_message?.toLowerCase().includes("quota"));

  async function invokeWorker(trigger: "manual" | "retry" = "manual") {
    const supabase = createRequiredClient();
    const { data, error: invokeError } = await supabase.functions.invoke("sync-race-data", {
      body: { trigger },
    });
    if (invokeError) throw invokeError;
    return data as { status?: string; error?: string } | null;
  }

  async function requestResearch(proposalId?: string) {
    const note = proposalId ? researchNotes[proposalId]?.trim() ?? "" : manualResearch.trim();
    if (note.length < 5) {
      setError("Provide at least five characters of research guidance.");
      return;
    }

    setBusyKey(`research-${proposalId ?? "manual"}`);
    setError("");
    setSuccess("");
    try {
      const supabase = createRequiredClient();
      const { error: requestError } = await supabase.rpc("admin_request_race_feed_research", {
        p_additional_information: note,
        p_proposal_id: proposalId ?? null,
      });
      if (requestError) throw requestError;
      const outcome = await invokeWorker(proposalId ? "retry" : "manual");
      if (outcome?.status === "failed") throw new Error(outcome.error || "Research worker failed.");
      setSuccess(proposalId ? "A new immutable research version was queued." : "Grounded research was queued.");
      if (proposalId) {
        setResearchNotes((current) => ({ ...current, [proposalId]: "" }));
      } else {
        setManualResearch("");
      }
      await loadDashboard();
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not request race research."));
    } finally {
      setBusyKey("");
    }
  }

  async function reviewProposal(proposalId: string, decision: "approve" | "reject") {
    const note = reviewNotes[proposalId]?.trim() ?? "";
    if (note.length < 5) {
      setError("A review note of at least five characters is required.");
      return;
    }

    setBusyKey(`${decision}-${proposalId}`);
    setError("");
    setSuccess("");
    try {
      const supabase = createRequiredClient();
      const { error: reviewError } = await supabase.rpc("admin_review_race_feed_proposal", {
        p_proposal_id: proposalId,
        p_decision: decision,
        p_note: note,
      });
      if (reviewError) throw reviewError;
      setSuccess(decision === "approve" ? "Proposal approved and applied atomically." : "Proposal rejected.");
      setReviewNotes((current) => ({ ...current, [proposalId]: "" }));
      await loadDashboard();
    } catch (reviewError) {
      setError(errorMessage(reviewError, "Could not review the proposal."));
    } finally {
      setBusyKey("");
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setBusyKey("settings");
    setError("");
    setSuccess("");
    try {
      const supabase = createRequiredClient();
      const { error: settingsError } = await supabase.rpc("admin_update_race_feed_settings", {
        p_confidence_threshold: settingsDraft.confidence_threshold,
        p_minimum_approved_sources: settingsDraft.minimum_approved_sources,
        p_auto_approve_new_meetings: settingsDraft.auto_approve_new_meetings,
        p_auto_approve_routine_changes: settingsDraft.auto_approve_routine_changes,
        p_auto_approve_results: settingsDraft.auto_approve_results,
        p_future_lookahead_days: settingsDraft.future_lookahead_days,
        p_daily_search_limit: settingsDraft.daily_search_limit,
      });
      if (settingsError) throw settingsError;
      setSuccess("Race-feed approval settings updated.");
      await loadDashboard();
    } catch (settingsError) {
      setError(errorMessage(settingsError, "Could not update race-feed settings."));
    } finally {
      setBusyKey("");
    }
  }

  async function saveDomain(domain: SourceDomain) {
    const draft = domainDrafts[domain.id];
    if (!draft) return;
    setBusyKey(`domain-${domain.id}`);
    setError("");
    setSuccess("");
    try {
      const supabase = createRequiredClient();
      const { error: domainError } = await supabase.rpc("admin_upsert_race_source_domain", {
        p_domain: domain.domain,
        p_display_name: draft.displayName.trim(),
        p_status: draft.status,
        p_reliability_score: Number(draft.reliabilityScore),
        p_reuse_basis: draft.reuseBasis.trim() || null,
        p_direct_fetch_allowed: draft.directFetchAllowed,
        p_can_auto_approve: draft.canAutoApprove,
      });
      if (domainError) throw domainError;
      setSuccess(`${domain.domain} trust settings updated.`);
      await loadDashboard();
    } catch (domainError) {
      setError(errorMessage(domainError, "Could not update source trust."));
    } finally {
      setBusyKey("");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" /> Loading the race-feed control plane…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Race-feed issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Complete</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}
      {quotaBlocked ? (
        <Alert variant="destructive">
          <Bot className="size-4" />
          <AlertTitle>Gemini API quota is not active</AlertTitle>
          <AlertDescription>
            The stored key can list models, but Google currently returns quota errors for grounded generation. No proposal can be created until API quota is enabled or the provider is changed. Existing race data is unaffected.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Pending proposals</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{pendingProposals.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Current fragments</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{fragments.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Searches today</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{searchesToday}<span className="ml-1 text-sm font-normal text-muted-foreground">/ {settings?.daily_search_limit ?? 0}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Failed tasks</CardDescription></CardHeader>
          <CardContent className="text-3xl font-semibold">{failedTasks.length}</CardContent>
        </Card>
      </div>

      <Card className="border-brand-cyan/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><SearchCheck className="size-5 text-brand-cyan" />Request grounded research</CardTitle>
          <CardDescription>
            Weekly discovery returns meetings only. The worker then creates one schedule task per meeting and one runner-detail task per race.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Label htmlFor="manual-race-research">Additional research information</Label>
          <Textarea
            id="manual-race-research"
            value={manualResearch}
            onChange={(event) => setManualResearch(event.target.value)}
            placeholder="Example: Search the next seven days of South African racing, noting venue aliases and official result sources."
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void requestResearch()} disabled={Boolean(busyKey) || manualResearch.trim().length < 5}>
              {busyKey === "research-manual" ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
              Start one bounded task
            </Button>
            <Button variant="outline" onClick={() => void loadDashboard(true)} disabled={Boolean(busyKey)}>
              <RefreshCw className="size-4" /> Refresh monitor
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="proposals" className="gap-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="proposals">Proposals</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="sources">Source trust</TabsTrigger>
          <TabsTrigger value="settings">Approval settings</TabsTrigger>
          <TabsTrigger value="history">Applied history</TabsTrigger>
        </TabsList>

        <TabsContent value="proposals" className="grid gap-4">
          {pendingProposals.length ? pendingProposals.map((proposal) => {
            const counts = proposalCounts(proposal);
            const proposalEvidence = evidence.filter((item) => item.proposal_id === proposal.id);
            return (
              <Card key={proposal.id} className={proposal.has_critical_conflict ? "border-destructive/50" : "border-brand-gold/40"}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{proposal.venue} · {formatDate(proposal.meeting_date)}</CardTitle>
                      <CardDescription>Version {proposal.proposal_version} · {counts.races} races · {counts.runners} runners · {proposal.change_type.replaceAll("_", " ")}</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(proposal.status)}>{proposal.status.replaceAll("_", " ")}</Badge>
                      <Badge variant={proposal.confidence_score >= 95 ? "default" : "outline"}>{proposal.confidence_score}% confidence</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {proposal.has_critical_conflict ? (
                    <Alert variant="destructive">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>Critical conflict</AlertTitle>
                      <AlertDescription>{proposal.conflict_summary || "Material source contradiction requires review."}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-border/70 p-3"><p className="text-xs uppercase text-muted-foreground">Schema</p><p className="text-xl font-semibold">{String(proposal.confidence_breakdown.schemaCompleteness ?? 0)}%</p></div>
                    <div className="rounded-xl border border-border/70 p-3"><p className="text-xs uppercase text-muted-foreground">Source quality</p><p className="text-xl font-semibold">{String(proposal.confidence_breakdown.sourceQualityFreshness ?? 0)}%</p></div>
                    <div className="rounded-xl border border-border/70 p-3"><p className="text-xs uppercase text-muted-foreground">Agreement</p><p className="text-xl font-semibold">{String(proposal.confidence_breakdown.crossSourceAgreement ?? 0)}%</p></div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Evidence · {proposal.distinct_source_count} domains · {proposal.approved_source_count} auto-approval eligible</p>
                    <div className="grid gap-2">
                      {proposalEvidence.length ? proposalEvidence.map((item) => (
                        <a key={item.id} href={item.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-border/70 p-3 transition-colors hover:border-brand-cyan/60">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{item.source_title || domainNames.get(item.domain_id) || "Grounded source"}</span>
                            <ExternalLink className="size-4 shrink-0" />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{domainNames.get(item.domain_id) || "Unclassified"} · {item.fact_scope} · {formatDateTime(item.retrieved_at)}</p>
                          {item.evidence_excerpt ? <p className="mt-2 text-sm text-muted-foreground">{item.evidence_excerpt}</p> : null}
                        </a>
                      )) : <p className="text-sm text-muted-foreground">No cited evidence was stored.</p>}
                    </div>
                  </div>
                  <details className="rounded-xl border border-border/70 p-3">
                    <summary className="cursor-pointer font-medium">Current database differences</summary>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(proposal.current_diff, null, 2)}</pre>
                  </details>
                  <div className="grid gap-2">
                    <Label htmlFor={`review-${proposal.id}`}>Required review note</Label>
                    <Textarea id={`review-${proposal.id}`} value={reviewNotes[proposal.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} placeholder="Explain why the normalized meeting is accepted or rejected." />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void reviewProposal(proposal.id, "approve")} disabled={Boolean(busyKey) || (reviewNotes[proposal.id]?.trim().length ?? 0) < 5}><CheckCircle2 className="size-4" />Approve and apply</Button>
                      <Button variant="destructive" onClick={() => void reviewProposal(proposal.id, "reject")} disabled={Boolean(busyKey) || (reviewNotes[proposal.id]?.trim().length ?? 0) < 5}><XCircle className="size-4" />Reject</Button>
                    </div>
                  </div>
                  <div className="grid gap-2 rounded-xl border border-border/70 p-3">
                    <Label htmlFor={`research-${proposal.id}`}>Additional research information</Label>
                    <Textarea id={`research-${proposal.id}`} value={researchNotes[proposal.id] ?? ""} onChange={(event) => setResearchNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} placeholder="Add venue aliases, date corrections, or a source to cross-check. A new immutable proposal version will be created." />
                    <Button variant="outline" className="w-fit" onClick={() => void requestResearch(proposal.id)} disabled={Boolean(busyKey) || (researchNotes[proposal.id]?.trim().length ?? 0) < 5}><FileSearch className="size-4" />Research again</Button>
                  </div>
                </CardContent>
              </Card>
            );
          }) : (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No proposal is waiting for review.</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="pipeline" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><DatabaseZap className="size-5 text-brand-cyan" />Staged tasks</CardTitle><CardDescription>One bounded Google Search request is allowed per task execution.</CardDescription></CardHeader>
            <CardContent className="grid gap-2">
              {tasks.length ? tasks.map((task) => (
                <div key={task.id} className="rounded-xl border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{task.task_type.replaceAll("_", " ")}</span><Badge variant={statusVariant(task.state)}>{task.state}</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">{task.venue || "South Africa weekly calendar"}{task.meeting_date ? ` · ${task.meeting_date}` : ""}{task.race_number ? ` · Race ${task.race_number}` : ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Due {formatDateTime(task.due_at)} · attempt {task.attempts}</p>
                  {task.last_error ? <p className="mt-2 text-sm text-destructive">{task.last_error}</p> : null}
                </div>
              )) : <p className="text-sm text-muted-foreground">No staged tasks yet.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5 text-brand-gold" />Recent worker runs</CardTitle><CardDescription>Search and extraction usage stays visible without exposing prompts, keys, or raw provider responses.</CardDescription></CardHeader>
            <CardContent className="grid gap-2">
              {runs.length ? runs.map((run) => (
                <div key={run.id} className="rounded-xl border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{formatDateTime(run.started_at)}</span><Badge variant={statusVariant(run.status)}>{run.status.replaceAll("_", " ")}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{run.search_model_name || "Legacy worker"} → {run.extraction_model_name || "Legacy extraction"} · {run.search_query_count} search · {run.evidence_count} evidence domains · {run.duration_ms ?? 0} ms</p>
                  {run.error_message ? <p className="mt-2 text-sm text-destructive">{run.error_message}</p> : null}
                </div>
              )) : <p className="text-sm text-muted-foreground">No worker runs yet.</p>}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5 text-brand-cyan" />Current staged fragments</CardTitle><CardDescription>A complete proposal is assembled only after the schedule and every expected race detail are present.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {fragments.length ? fragments.map((fragment) => <Badge key={fragment.id} variant="secondary">{fragment.fragment_type.replaceAll("_", " ")}{fragment.venue ? ` · ${fragment.venue}` : ""}{fragment.race_number ? ` R${fragment.race_number}` : ""}</Badge>) : <p className="text-sm text-muted-foreground">No current fragments.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="grid gap-4">
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Unknown domains never auto-approve</AlertTitle>
            <AlertDescription>New citation domains start as evidence-only. Mark a domain approved only after authority and reuse permission have been reviewed.</AlertDescription>
          </Alert>
          {domains.map((domain) => {
            const draft = domainDrafts[domain.id];
            if (!draft) return null;
            return (
              <Card key={domain.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><CardTitle>{domain.domain}</CardTitle><CardDescription>Last reviewed {formatDateTime(domain.last_reviewed_at)}</CardDescription></div>
                    <Badge variant={statusVariant(draft.status)}>{draft.status.replaceAll("_", " ")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2"><Label>Display name</Label><Input value={draft.displayName} onChange={(event) => setDomainDrafts((current) => ({ ...current, [domain.id]: { ...draft, displayName: event.target.value } }))} /></div>
                    <div className="grid gap-2"><Label>Trust status</Label><Select value={draft.status} onValueChange={(value: SourceDomain["status"]) => setDomainDrafts((current) => ({ ...current, [domain.id]: { ...draft, status: value, canAutoApprove: value === "approved" ? draft.canAutoApprove : false } }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approved">Approved</SelectItem><SelectItem value="evidence_only">Evidence only</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent></Select></div>
                    <div className="grid gap-2"><Label>Reliability score</Label><Input type="number" min="0" max="100" value={draft.reliabilityScore} onChange={(event) => setDomainDrafts((current) => ({ ...current, [domain.id]: { ...draft, reliabilityScore: event.target.value } }))} /></div>
                  </div>
                  <div className="grid gap-2"><Label>Reuse / permission basis</Label><Textarea value={draft.reuseBasis} onChange={(event) => setDomainDrafts((current) => ({ ...current, [domain.id]: { ...draft, reuseBasis: event.target.value } }))} /></div>
                  <div className="flex flex-wrap gap-6 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.directFetchAllowed} onChange={(event) => setDomainDrafts((current) => ({ ...current, [domain.id]: { ...draft, directFetchAllowed: event.target.checked } }))} />Direct fetch permitted</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.canAutoApprove} disabled={draft.status !== "approved"} onChange={(event) => setDomainDrafts((current) => ({ ...current, [domain.id]: { ...draft, canAutoApprove: event.target.checked } }))} />May count toward auto-approval</label>
                  </div>
                  <Button className="w-fit" onClick={() => void saveDomain(domain)} disabled={Boolean(busyKey)}>{busyKey === `domain-${domain.id}` ? <RefreshCw className="size-4 animate-spin" /> : null}Save source trust</Button>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="size-5 text-brand-gold" />Approval settings</CardTitle><CardDescription>All auto-approval switches remain off during the pilot. Threshold safeguards still apply if enabled later.</CardDescription></CardHeader>
            <CardContent className="grid gap-5">
              {settingsDraft ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="grid gap-2"><Label>Confidence threshold</Label><Input type="number" min="50" max="100" value={settingsDraft.confidence_threshold} onChange={(event) => setSettingsDraft({ ...settingsDraft, confidence_threshold: Number(event.target.value) })} /></div>
                    <div className="grid gap-2"><Label>Minimum approved sources</Label><Input type="number" min="1" max="10" value={settingsDraft.minimum_approved_sources} onChange={(event) => setSettingsDraft({ ...settingsDraft, minimum_approved_sources: Number(event.target.value) })} /></div>
                    <div className="grid gap-2"><Label>Future lookahead days</Label><Input type="number" min="1" max="14" value={settingsDraft.future_lookahead_days} onChange={(event) => setSettingsDraft({ ...settingsDraft, future_lookahead_days: Number(event.target.value) })} /></div>
                    <div className="grid gap-2"><Label>Daily Google Search cap</Label><Input type="number" min="1" max="500" value={settingsDraft.daily_search_limit} onChange={(event) => setSettingsDraft({ ...settingsDraft, daily_search_limit: Number(event.target.value) })} /></div>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-border/70 p-4 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={settingsDraft.auto_approve_new_meetings} onChange={(event) => setSettingsDraft({ ...settingsDraft, auto_approve_new_meetings: event.target.checked })} />Auto-approve new meetings after all safeguards pass</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={settingsDraft.auto_approve_routine_changes} onChange={(event) => setSettingsDraft({ ...settingsDraft, auto_approve_routine_changes: event.target.checked })} />Auto-approve routine factual changes</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={settingsDraft.auto_approve_results} onChange={(event) => setSettingsDraft({ ...settingsDraft, auto_approve_results: event.target.checked })} />Auto-approve official results</label>
                  </div>
                  <p className="text-sm text-muted-foreground">Last weekly discovery: {formatDateTime(settings?.last_weekly_discovery_at ?? null)}</p>
                  <Button className="w-fit" onClick={() => void saveSettings()} disabled={Boolean(busyKey)}>{busyKey === "settings" ? <RefreshCw className="size-4 animate-spin" /> : null}Save approval settings</Button>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand-cyan" />Proposal history</CardTitle><CardDescription>Every approval, rejection, retry, and proposal version remains immutable.</CardDescription></CardHeader>
            <CardContent className="grid gap-2">
              {proposals.length ? proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-xl border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{proposal.venue} · {proposal.meeting_date} · v{proposal.proposal_version}</span><Badge variant={statusVariant(proposal.status)}>{proposal.status.replaceAll("_", " ")}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{proposal.change_type.replaceAll("_", " ")} · {proposal.confidence_score}% · created {formatDateTime(proposal.created_at)}{proposal.reviewed_at ? ` · reviewed ${formatDateTime(proposal.reviewed_at)}` : ""}</p>
                  {proposal.review_note ? <p className="mt-2 text-sm text-muted-foreground">{proposal.review_note}</p> : null}
                </div>
              )) : <p className="text-sm text-muted-foreground">No proposal history yet.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5 text-brand-gold" />Applied factual changes</CardTitle><CardDescription>Tipster impact alerts are created only after approved changes are applied.</CardDescription></CardHeader>
            <CardContent className="grid gap-2">
              {changes.length ? changes.map((change) => (
                <div key={change.id} className="rounded-xl border border-border/70 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{change.summary}</span><Badge variant="secondary">{change.change_type}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{change.entity_type} · {change.changed_fields.join(", ") || "created"} · {formatDateTime(change.created_at)}</p></div>
              )) : <p className="text-sm text-muted-foreground">No approved race changes yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {latestRun ? <p className="text-right text-xs text-muted-foreground">Monitor refreshed automatically · latest worker {formatDateTime(latestRun.started_at)}</p> : null}
    </div>
  );
}
