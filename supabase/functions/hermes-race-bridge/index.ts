import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  constantTimeEqual,
  type HermesRaceResult,
  type JsonRecord,
  sourceMatchesPermittedDomain,
  validateJobRequest,
  validateResult,
} from "./contracts.ts";

type ServiceClient = SupabaseClient;

function allowedOrigin(request: Request) {
  const configured = Deno.env.get("MRC_ALLOWED_ORIGIN") ?? "";
  const origin = request.headers.get("origin") ?? "";
  return configured && origin === configured ? origin : "";
}

function responseHeaders(request: Request) {
  const origin = allowedOrigin(request);
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-mrc-hermes-token, x-mrc-internal-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(request: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(request),
  });
}

function safeMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(/[\r\n]+/g, " ").slice(0, 500);
  }
  return "Unexpected Hermes race bridge failure.";
}

function routeName(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("hermes-race-bridge");
  return marker >= 0
    ? parts.slice(marker + 1).join("/") || "health"
    : parts.at(-1) ?? "health";
}

function bearerToken(request: Request) {
  return (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
}

function requireConfiguredSecret(name: string) {
  const value = Deno.env.get(name) ?? "";
  if (value.length < 32) throw new Error(`${name} is missing or too short.`);
  return value;
}

function authorizeWorker(request: Request) {
  const expected = requireConfiguredSecret("MRC_HERMES_WORKER_TOKEN");
  const supplied = request.headers.get("x-mrc-hermes-token") ?? "";
  return constantTimeEqual(supplied, expected);
}

async function authorizeInternal(
  request: Request,
  serviceClient: ServiceClient,
) {
  const expected = requireConfiguredSecret("MRC_HERMES_INTERNAL_TOKEN");
  const supplied = request.headers.get("x-mrc-internal-token") ?? "";
  if (supplied && constantTimeEqual(supplied, expected)) {
    return "internal" as const;
  }

  const accessToken = bearerToken(request);
  if (!accessToken) return null;
  const { data, error } = await serviceClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const { data: roles } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "administrator")
    .limit(1);
  return roles?.length ? "administrator" as const : null;
}

async function withinRateLimit(
  serviceClient: ServiceClient,
  actor: string,
  route: string,
  limit: number,
) {
  const { data, error } = await serviceClient.rpc(
    "check_hermes_race_rate_limit",
    { p_actor: actor, p_route: route, p_limit: limit },
  );
  if (error) throw error;
  return data === true;
}

function workerId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 160) {
    throw new Error("worker_id is required.");
  }
  return normalized;
}

function uuid(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(normalized)
  ) {
    throw new Error(`${label} must be a UUID.`);
  }
  return normalized;
}

function hasCriticalConflict(conflicts: unknown[]) {
  return conflicts.some((conflict) => {
    if (!conflict || typeof conflict !== "object" || Array.isArray(conflict)) {
      return false;
    }
    return (conflict as JsonRecord).material === true ||
      (conflict as JsonRecord).critical === true;
  });
}

function changeType(job: JsonRecord) {
  const payload = job.task_payload && typeof job.task_payload === "object" &&
      !Array.isArray(job.task_payload)
    ? job.task_payload as JsonRecord
    : {};
  const requested = typeof payload.change_type === "string"
    ? payload.change_type
    : "";
  if (["new_meeting", "routine_change", "result"].includes(requested)) {
    return requested;
  }
  return job.task_type === "result_refresh" ? "result" : "routine_change";
}

async function recordHandoff(
  serviceClient: ServiceClient,
  jobId: string,
  status: "shadow" | "proposal_created" | "failed" | "not_applicable",
  proposalId?: string,
  errorDetail?: string,
) {
  return await serviceClient.rpc("record_hermes_race_handoff", {
    p_job_id: jobId,
    p_status: status,
    p_proposal_id: proposalId ?? null,
    p_error: errorDetail ?? null,
  });
}

async function handoffResult(
  serviceClient: ServiceClient,
  job: JsonRecord,
  result: HermesRaceResult,
) {
  const mode = (Deno.env.get("MRC_HERMES_BRIDGE_MODE") ?? "shadow")
    .toLowerCase();
  if (mode !== "proposal") {
    const recorded = await recordHandoff(
      serviceClient,
      result.job_id,
      "shadow",
    );
    if (recorded.error) throw recorded.error;
    return { mode: "shadow", proposalId: null };
  }

  const taskId = typeof job.source_task_id === "string"
    ? job.source_task_id
    : "";
  const runId = typeof job.source_run_id === "string" ? job.source_run_id : "";
  const meetings = result.normalized_data.meetings;
  if (!taskId || !runId || !Array.isArray(meetings) || meetings.length !== 1) {
    const recorded = await recordHandoff(
      serviceClient,
      result.job_id,
      "not_applicable",
    );
    if (recorded.error) throw recorded.error;
    return { mode: "not_applicable", proposalId: null };
  }

  const { data, error } = await serviceClient.rpc("submit_race_feed_proposal", {
    p_task_id: taskId,
    p_run_id: runId,
    p_snapshot: result.normalized_data,
    p_change_type: changeType(job),
    p_current_diff: {},
    p_validation_outcome: {
      source: "hermes-race-bridge",
      status: result.status,
      warnings: result.warnings,
      conflicts: result.conflicts,
      evidenceHash: result.evidence_hash,
    },
    p_evidence: result.sources,
    p_completeness_score: result.confidence,
    p_agreement_score: result.confidence,
    p_has_critical_conflict: hasCriticalConflict(result.conflicts),
    p_conflict_summary: hasCriticalConflict(result.conflicts)
      ? "Hermes reported one or more material source conflicts."
      : null,
    p_parent_proposal_id: null,
    p_research_guidance:
      "Prepared by the native Hermes worker and returned through the authenticated bridge.",
  });

  if (error) {
    await recordHandoff(
      serviceClient,
      result.job_id,
      "failed",
      undefined,
      safeMessage(error),
    );
    throw error;
  }

  const proposal = data && typeof data === "object"
    ? (data as JsonRecord).proposal
    : null;
  const proposalId =
    proposal && typeof proposal === "object" && !Array.isArray(proposal)
      ? String((proposal as JsonRecord).id ?? "")
      : "";
  const recorded = await recordHandoff(
    serviceClient,
    result.job_id,
    "proposal_created",
    proposalId || undefined,
  );
  if (recorded.error) throw recorded.error;
  return { mode: "proposal", proposalId: proposalId || null };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(request),
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(request, {
        error: "Bridge database configuration is incomplete.",
      }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const route = routeName(request);

    if (route === "health" && request.method === "GET") {
      return json(request, {
        status: "ok",
        mode: Deno.env.get("MRC_HERMES_BRIDGE_MODE") ?? "shadow",
      });
    }

    if (route === "jobs" && request.method === "POST") {
      const principal = await authorizeInternal(request, serviceClient);
      if (!principal) {
        return json(request, { error: "Internal authorization failed." }, 401);
      }
      if (!await withinRateLimit(serviceClient, principal, route, 60)) {
        return json(request, { error: "Rate limit exceeded." }, 429);
      }
      const job = validateJobRequest(await request.json());
      const { data, error } = await serviceClient.rpc(
        "enqueue_hermes_race_job",
        { p_job: job },
      );
      if (error) throw error;
      return json(
        request,
        data,
        (data as JsonRecord)?.created === true ? 201 : 200,
      );
    }

    if (
      route === "status" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      const principal = await authorizeInternal(request, serviceClient);
      if (!principal) {
        return json(request, { error: "Internal authorization failed." }, 401);
      }
      if (!await withinRateLimit(serviceClient, principal, route, 120)) {
        return json(request, { error: "Rate limit exceeded." }, 429);
      }
      const queryId = new URL(request.url).searchParams.get("job_id");
      const body = request.method === "POST"
        ? await request.json() as JsonRecord
        : {};
      const jobId = uuid(queryId ?? body.job_id, "job_id");
      const { data, error } = await serviceClient.rpc("get_hermes_race_job", {
        p_job_id: jobId,
      });
      if (error) throw error;
      return data
        ? json(request, { job: data })
        : json(request, { error: "Job not found." }, 404);
    }

    if (
      !["claim", "heartbeat", "result", "failure"].includes(route) ||
      request.method !== "POST"
    ) {
      return json(request, { error: "Route not found." }, 404);
    }
    if (!authorizeWorker(request)) {
      return json(
        request,
        { error: "Hermes worker authorization failed." },
        401,
      );
    }
    const body = await request.json() as JsonRecord;
    const activeWorker = workerId(body.worker_id);
    if (!await withinRateLimit(serviceClient, activeWorker, route, 120)) {
      return json(request, { error: "Rate limit exceeded." }, 429);
    }

    if (route === "claim") {
      const { data, error } = await serviceClient.rpc("claim_hermes_race_job", {
        p_worker_id: activeWorker,
      });
      if (error) throw error;
      return data
        ? json(request, { status: "claimed", job: data })
        : json(request, { status: "idle", job: null });
    }

    if (route === "heartbeat") {
      const jobId = uuid(body.job_id, "job_id");
      const { data, error } = await serviceClient.rpc(
        "heartbeat_hermes_race_job",
        {
          p_job_id: jobId,
          p_worker_id: activeWorker,
        },
      );
      if (error) throw error;
      return json(request, data);
    }

    if (route === "failure") {
      const jobId = uuid(body.job_id, "job_id");
      const errorCode = typeof body.error_code === "string"
        ? body.error_code.slice(0, 120)
        : "worker_failure";
      const errorDetail = typeof body.error_detail === "string"
        ? body.error_detail.slice(0, 2000)
        : "Hermes worker failed.";
      const { data, error } = await serviceClient.rpc("fail_hermes_race_job", {
        p_job_id: jobId,
        p_worker_id: activeWorker,
        p_error_code: errorCode,
        p_error_detail: errorDetail,
      });
      if (error) throw error;
      return json(request, data);
    }

    const result = await validateResult(body.result);
    const { data: claimedJob, error: claimedJobError } = await serviceClient
      .rpc(
        "get_hermes_race_job",
        { p_job_id: result.job_id },
      );
    if (claimedJobError) throw claimedJobError;
    if (!claimedJob || typeof claimedJob !== "object") {
      throw new Error("Claimed job was not found.");
    }
    const claimed = claimedJob as JsonRecord;
    if (claimed.correlation_id !== result.correlation_id) {
      throw new Error("Result correlation_id does not match the claimed job.");
    }
    const permittedSources = Array.isArray(claimed.permitted_sources)
      ? claimed.permitted_sources.filter((item): item is string =>
        typeof item === "string"
      )
      : [];
    if (
      !permittedSources.length ||
      result.sources.some((source) =>
        !sourceMatchesPermittedDomain(source.domain, permittedSources)
      )
    ) {
      throw new Error("Result contains a source outside the job allowlist.");
    }
    const { data: completed, error: completionError } = await serviceClient.rpc(
      "complete_hermes_race_job",
      {
        p_result: result,
        p_worker_id: activeWorker,
      },
    );
    if (completionError) throw completionError;
    const handoff = await handoffResult(
      serviceClient,
      completed as JsonRecord,
      result,
    );
    return json(request, { status: "accepted", jobId: result.job_id, handoff });
  } catch (error) {
    console.error("hermes-race-bridge", safeMessage(error));
    return json(request, { error: safeMessage(error) }, 400);
  }
});
