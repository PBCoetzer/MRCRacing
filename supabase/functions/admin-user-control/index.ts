import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type ModerationAction = "flag" | "suspend" | "ban" | "restore";

type ModerationRequest = {
  userId?: string;
  action?: ModerationAction;
  category?: string;
  internalReason?: string;
  publicMessage?: string;
  suspensionUntil?: string;
  confirmation?: string;
  requestId?: string;
};

type StagedControl = {
  userId: string;
  action: ModerationAction;
  requestId: string;
  authSyncRequired: boolean;
  idempotentRetry?: boolean;
  alreadyActive?: boolean;
};

const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";

  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://www.mrcracing.co.za",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

function safeText(value: unknown, maximumLength: number) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function safeRpcMessage(message: string | undefined) {
  const normalized = safeText(message, 240);

  if (
    normalized.includes("required") ||
    normalized.includes("cannot") ||
    normalized.includes("Only the platform owner") ||
    normalized.includes("already has") ||
    normalized.includes("not found") ||
    normalized.includes("unsupported")
  ) {
    return normalized;
  }

  return "The requested user-control change could not be completed.";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      request,
      { error: "User-control service configuration is incomplete." },
      500,
    );
  }

  if (!accessToken) {
    return jsonResponse(request, { error: "Authentication required." }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authenticatedUser, error: userError } =
    await serviceClient.auth.getUser(accessToken);

  if (userError || !authenticatedUser.user) {
    return jsonResponse(request, { error: "Invalid authenticated session." }, 401);
  }

  const actorId = authenticatedUser.user.id;
  const [{ data: roleRow, error: roleError }, { data: actorControl }] =
    await Promise.all([
      serviceClient
        .from("user_roles")
        .select("role")
        .eq("user_id", actorId)
        .eq("role", "administrator")
        .maybeSingle(),
      serviceClient
        .from("user_account_controls")
        .select("status,suspension_until")
        .eq("user_id", actorId)
        .maybeSingle(),
    ]);

  const suspensionHasExpired = actorControl?.status === "suspended" &&
    actorControl.suspension_until &&
    new Date(actorControl.suspension_until).getTime() <= Date.now();
  const actorIsActive = !actorControl ||
    ["active", "flagged"].includes(actorControl.status) ||
    suspensionHasExpired;

  if (roleError || !roleRow || !actorIsActive) {
    return jsonResponse(
      request,
      { error: "Active administrator access required." },
      403,
    );
  }

  let payload: ModerationRequest;

  try {
    payload = await request.json() as ModerationRequest;
  } catch {
    return jsonResponse(request, { error: "Invalid JSON request." }, 400);
  }

  const userId = safeText(payload.userId, 80);
  const action = safeText(payload.action, 20) as ModerationAction;
  const category = safeText(payload.category, 100);
  const internalReason = safeText(payload.internalReason, 2000);
  const publicMessage = safeText(payload.publicMessage, 500);
  const requestId = safeText(
    payload.requestId ?? request.headers.get("x-idempotency-key"),
    200,
  );
  const suspensionUntil = safeText(payload.suspensionUntil, 80);

  if (!userId || !["flag", "suspend", "ban", "restore"].includes(action)) {
    return jsonResponse(request, { error: "Choose a valid user and action." }, 400);
  }

  if (!requestId || requestId.length < 8) {
    return jsonResponse(
      request,
      { error: "A valid moderation request id is required." },
      400,
    );
  }

  if (internalReason.length < 10) {
    return jsonResponse(
      request,
      { error: "An internal reason of at least ten characters is required." },
      400,
    );
  }

  if (action !== "restore" && !category) {
    return jsonResponse(
      request,
      { error: "A moderation category is required." },
      400,
    );
  }

  let suspensionDate: Date | null = null;

  if (action === "suspend") {
    suspensionDate = new Date(suspensionUntil);

    if (
      !suspensionUntil ||
      Number.isNaN(suspensionDate.getTime()) ||
      suspensionDate.getTime() <= Date.now()
    ) {
      return jsonResponse(
        request,
        { error: "Choose a valid future suspension expiry." },
        400,
      );
    }
  }

  if (action === "ban" && payload.confirmation !== "BAN") {
    return jsonResponse(
      request,
      { error: 'Type "BAN" to confirm a permanent ban.' },
      400,
    );
  }

  const { data: stagedData, error: stageError } = await serviceClient.rpc(
    "admin_stage_user_control",
    {
      p_actor_id: actorId,
      p_user_id: userId,
      p_action: action,
      p_category: category || null,
      p_internal_reason: internalReason,
      p_public_message: publicMessage || null,
      p_suspension_until: suspensionDate?.toISOString() ?? null,
      p_request_id: requestId,
    },
  );

  if (stageError || !stagedData) {
    return jsonResponse(
      request,
      { error: safeRpcMessage(stageError?.message) },
      400,
    );
  }

  const stagedControl = stagedData as StagedControl;

  if (!stagedControl.authSyncRequired) {
    return jsonResponse(request, {
      ok: true,
      status: action === "flag" ? "flagged" : "active",
      authSynchronized: true,
      requestId,
    });
  }

  let banDuration = "none";

  if (action === "suspend" && suspensionDate) {
    const durationSeconds = Math.max(
      1,
      Math.ceil((suspensionDate.getTime() - Date.now()) / 1000),
    );
    banDuration = `${durationSeconds}s`;
  } else if (action === "ban") {
    banDuration = "876000h";
  }

  const { data: authUpdate, error: authUpdateError } =
    await serviceClient.auth.admin.updateUserById(userId, {
      ban_duration: banDuration,
    });

  if (authUpdateError || !authUpdate.user) {
    await serviceClient.rpc("admin_complete_user_control_sync", {
      p_request_id: requestId,
      p_success: false,
      p_auth_banned_until: null,
      p_sanitized_error:
        "Supabase Auth synchronization failed. Retry this moderation action.",
    });

    return jsonResponse(
      request,
      {
        error:
          "The account is restricted in MRC Racing, but Supabase Auth synchronization failed. Retry this action.",
        retryable: true,
        requestId,
      },
      502,
    );
  }

  const { data: completedData, error: completeError } = await serviceClient.rpc(
    "admin_complete_user_control_sync",
    {
      p_request_id: requestId,
      p_success: true,
      p_auth_banned_until: authUpdate.user.banned_until ?? null,
      p_sanitized_error: null,
    },
  );

  if (completeError || !completedData) {
    return jsonResponse(
      request,
      {
        error:
          "Supabase Auth was updated, but the MRC audit record could not be finalized. Retry this action.",
        retryable: true,
        requestId,
      },
      502,
    );
  }

  return jsonResponse(request, {
    ok: true,
    result: completedData,
    authSynchronized: true,
    requestId,
  });
});
