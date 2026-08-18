import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function headers(requestId: string) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  };
}

function json(requestId: string, payload: unknown, status = 200) {
  return new Response(JSON.stringify({ ...payload as JsonRecord, requestId }), {
    status,
    headers: headers(requestId),
  });
}

function routeName(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("site-build-bridge");
  return marker >= 0 ? parts.slice(marker + 1).join("/") || "health" : parts.at(-1) ?? "health";
}

function bodyString(value: unknown, label: string, maximum = 200) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maximum) throw new Error(`${label} is invalid.`);
  return result;
}

function uuid(value: unknown, label: string) {
  const result = bodyString(value, label, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return result;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Unexpected site build bridge failure.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const route = routeName(request);

  if (request.method === "GET" && route === "health") {
    return json(requestId, { status: "ok", service: "site-build-bridge" });
  }
  if (request.method !== "POST" || !["claim", "heartbeat", "complete", "failure"].includes(route)) {
    return json(requestId, { status: "error", code: "NOT_FOUND", error: "Route not found." }, 404);
  }

  const expectedToken = Deno.env.get("MRC_SITE_BUILD_WORKER_TOKEN") ?? "";
  const suppliedToken = request.headers.get("x-mrc-site-build-token") ?? "";
  if (expectedToken.length < 32 || !constantTimeEqual(suppliedToken, expectedToken)) {
    return json(requestId, { status: "error", code: "UNAUTHORIZED", error: "Worker authorization failed." }, 401);
  }

  try {
    const body = await request.json() as JsonRecord;
    const workerId = bodyString(body.worker_id, "worker_id", 160);
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    if (route === "claim") {
      const { data, error } = await serviceClient.rpc("claim_site_build_job", {
        p_worker_id: workerId,
        p_lease_seconds: 900,
      });
      if (error) throw error;
      return json(requestId, { status: data ? "claimed" : "idle", job: data ?? null });
    }

    const jobId = uuid(body.job_id, "job_id");
    if (route === "heartbeat") {
      const { data, error } = await serviceClient.rpc("heartbeat_site_build_job", {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_lease_seconds: 900,
      });
      if (error) throw error;
      return data
        ? json(requestId, { status: "leased" })
        : json(requestId, { status: "error", code: "LEASE_LOST", error: "Build lease is no longer active." }, 409);
    }

    if (route === "complete") {
      const manifest = body.build_manifest && typeof body.build_manifest === "object" && !Array.isArray(body.build_manifest)
        ? body.build_manifest
        : {};
      const { data, error } = await serviceClient.rpc("complete_site_build_job", {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_deployed_commit_sha: bodyString(body.deployed_commit_sha, "deployed_commit_sha", 80),
        p_output_sha256: bodyString(body.output_sha256, "output_sha256", 128),
        p_build_manifest: manifest,
      });
      if (error) throw error;
      return data
        ? json(requestId, { status: "succeeded" })
        : json(requestId, { status: "error", code: "LEASE_LOST", error: "Build lease is no longer active." }, 409);
    }

    const { data, error } = await serviceClient.rpc("fail_site_build_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_error: bodyString(body.error, "error", 1000),
    });
    if (error) throw error;
    return data
      ? json(requestId, { status: (data as JsonRecord).status, job: data })
      : json(requestId, { status: "error", code: "LEASE_LOST", error: "Build lease is no longer active." }, 409);
  } catch (error) {
    const message = safeError(error);
    console.error(JSON.stringify({ requestId, route, error: message }));
    return json(requestId, { status: "error", code: "REQUEST_FAILED", error: message }, 400);
  }
});
