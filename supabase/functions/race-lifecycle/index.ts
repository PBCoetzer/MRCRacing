import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Authorization = { kind: "cron"; userId: null } | {
  kind: "administrator";
  userId: string;
};

const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);

function headers(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(allowedOrigins.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-mrc-worker-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Race lifecycle failed.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

async function authorize(
  request: Request,
  serviceClient: SupabaseClient,
): Promise<Authorization | null> {
  const workerToken = request.headers.get("x-mrc-worker-token") ?? "";
  if (workerToken) {
    const { data, error } = await serviceClient.rpc(
      "verify_race_worker_request",
      {
        p_token: workerToken,
      },
    );
    if (!error && data === true) return { kind: "cron", userId: null };
  }

  const accessToken = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!accessToken) return null;
  const { data, error } = await serviceClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const { data: roles } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "administrator")
    .limit(1);
  return roles?.length ? { kind: "administrator", userId: data.user.id } : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: headers(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json(request, {
      error: "Supabase worker configuration is incomplete.",
    }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authorization = await authorize(request, serviceClient);
  if (!authorization) {
    return json(
      request,
      { error: "Race lifecycle authentication failed." },
      401,
    );
  }

  try {
    const body = await request.json().catch(() => ({})) as { dryRun?: boolean };
    const dryRun = body.dryRun === true;
    const { data, error } = await serviceClient.rpc("run_race_lifecycle", {
      p_dry_run: dryRun,
      p_actor_id: authorization.userId,
    });
    if (error) throw error;
    return json(request, {
      status: "succeeded",
      authorization: authorization.kind,
      ...data,
    });
  } catch (error) {
    return json(request, { status: "failed", error: safeError(error) }, 500);
  }
});
