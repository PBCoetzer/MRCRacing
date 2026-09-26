import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { jwtHasAal2 } from "../_shared/mfa.ts";

type ModerationAction = "flag" | "suspend" | "ban" | "restore";
type EmailConfirmationAction = "resend_confirmation" | "verify_email";
type AdminUserAction = ModerationAction | EmailConfirmationAction;

type AdminUserRequest = {
  userId?: string;
  action?: AdminUserAction;
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
      "authorization, x-client-info, apikey, content-type, x-idempotency-key",
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

function isModerationAction(action: string): action is ModerationAction {
  return ["flag", "suspend", "ban", "restore"].includes(action);
}

function isEmailConfirmationAction(
  action: string,
): action is EmailConfirmationAction {
  return ["resend_confirmation", "verify_email"].includes(action);
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
  const { data: authenticatedUser, error: userError } = await serviceClient.auth
    .getUser(accessToken);

  if (userError || !authenticatedUser.user) {
    return jsonResponse(
      request,
      { error: "Invalid authenticated session." },
      401,
    );
  }

  if (!jwtHasAal2(accessToken)) {
    return jsonResponse(
      request,
      { error: "Administrator two-factor authentication required.", code: "mfa_required" },
      403,
    );
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

  let payload: AdminUserRequest;

  try {
    payload = await request.json() as AdminUserRequest;
  } catch {
    return jsonResponse(request, { error: "Invalid JSON request." }, 400);
  }

  const userId = safeText(payload.userId, 80);
  const action = safeText(payload.action, 40);
  const category = safeText(payload.category, 100);
  const internalReason = safeText(payload.internalReason, 2000);
  const publicMessage = safeText(payload.publicMessage, 500);
  const requestId = safeText(
    payload.requestId ?? request.headers.get("x-idempotency-key"),
    200,
  );
  const suspensionUntil = safeText(payload.suspensionUntil, 80);

  if (
    !userId ||
    (!isModerationAction(action) && !isEmailConfirmationAction(action))
  ) {
    return jsonResponse(
      request,
      { error: "Choose a valid user and action." },
      400,
    );
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

  if (isEmailConfirmationAction(action)) {
    if (action === "verify_email" && payload.confirmation !== "VERIFY") {
      return jsonResponse(
        request,
        { error: 'Type "VERIFY" to confirm manual email verification.' },
        400,
      );
    }

    const { data: existingAction, error: existingActionError } =
      await serviceClient
        .from("admin_email_confirmation_actions")
        .select("actor_id,user_id,action,status")
        .eq("request_id", requestId)
        .maybeSingle();

    if (existingActionError) {
      return jsonResponse(
        request,
        { error: "The email action audit record could not be checked." },
        502,
      );
    }

    if (existingAction) {
      const sameRequest = existingAction.actor_id === actorId &&
        existingAction.user_id === userId &&
        existingAction.action === action;

      if (!sameRequest) {
        return jsonResponse(
          request,
          { error: "This email action request id is already in use." },
          409,
        );
      }

      if (existingAction.status === "succeeded") {
        return jsonResponse(request, {
          ok: true,
          action,
          idempotent: true,
          requestId,
        });
      }

      return jsonResponse(
        request,
        {
          error: existingAction.status === "processing"
            ? "This email action is already processing."
            : "This email action failed. Start a new request to retry.",
        },
        409,
      );
    }

    const { data: targetUserData, error: targetUserError } = await serviceClient
      .auth.admin.getUserById(userId);
    const targetUser = targetUserData?.user;

    if (targetUserError || !targetUser) {
      return jsonResponse(request, { error: "User record not found." }, 404);
    }

    if (!targetUser.email) {
      return jsonResponse(
        request,
        { error: "This account does not have an email address." },
        400,
      );
    }

    if (targetUser.email_confirmed_at) {
      return jsonResponse(
        request,
        { error: "This email address is already confirmed." },
        409,
      );
    }

    if (action === "resend_confirmation") {
      const resendCooldownStart = new Date(Date.now() - 60_000).toISOString();
      const { data: recentResend, error: recentResendError } =
        await serviceClient
          .from("admin_email_confirmation_actions")
          .select("id")
          .eq("user_id", userId)
          .eq("action", "resend_confirmation")
          .eq("status", "succeeded")
          .gte("created_at", resendCooldownStart)
          .limit(1)
          .maybeSingle();

      if (recentResendError) {
        return jsonResponse(
          request,
          { error: "The confirmation resend limit could not be checked." },
          502,
        );
      }

      if (recentResend) {
        return jsonResponse(
          request,
          { error: "Wait at least 60 seconds before resending confirmation." },
          429,
        );
      }
    }

    const { data: actionRecord, error: actionRecordError } = await serviceClient
      .from("admin_email_confirmation_actions")
      .insert({
        request_id: requestId,
        actor_id: actorId,
        user_id: userId,
        action,
        reason: internalReason,
      })
      .select("id")
      .single();

    if (actionRecordError || !actionRecord) {
      return jsonResponse(
        request,
        { error: "The email action could not be staged safely." },
        502,
      );
    }

    let actionError: { status?: number } | null = null;
    let confirmedAt: string | null = null;
    let confirmationSentAt = targetUser.confirmation_sent_at ?? null;

    if (action === "resend_confirmation") {
      const publicSiteUrl = (Deno.env.get("MRC_PUBLIC_SITE_URL") ??
        "https://www.mrcracing.co.za").replace(/\/+$/, "");
      const { error: resendError } = await serviceClient.auth.resend({
        type: "signup",
        email: targetUser.email,
        options: {
          emailRedirectTo: `${publicSiteUrl}/auth/callback/`,
        },
      });
      actionError = resendError;

      if (!resendError) {
        const { data: refreshedUserData } = await serviceClient.auth.admin
          .getUserById(userId);
        confirmationSentAt = refreshedUserData?.user?.confirmation_sent_at ??
          confirmationSentAt;
      }
    } else {
      const { data: verifiedUserData, error: verifyError } = await serviceClient
        .auth.admin.updateUserById(userId, {
          email_confirm: true,
        });
      actionError = verifyError;
      confirmedAt = verifiedUserData?.user?.email_confirmed_at ?? null;
    }

    if (actionError) {
      const isRateLimit = actionError.status === 429;
      const sanitizedFailure = isRateLimit
        ? "Supabase Auth rate-limited the confirmation resend."
        : action === "resend_confirmation"
        ? "Supabase Auth did not accept the confirmation resend."
        : "Supabase Auth did not accept manual email verification.";

      await serviceClient
        .from("admin_email_confirmation_actions")
        .update({
          status: "failed",
          sanitized_error: sanitizedFailure,
          completed_at: new Date().toISOString(),
        })
        .eq("id", actionRecord.id);

      return jsonResponse(
        request,
        {
          error: isRateLimit
            ? "Supabase temporarily rate-limited confirmation emails. Try again later."
            : action === "resend_confirmation"
            ? "The confirmation email could not be resent."
            : "The email address could not be verified manually.",
          retryable: true,
          requestId,
        },
        isRateLimit ? 429 : 502,
      );
    }

    const { error: completionError } = await serviceClient
      .from("admin_email_confirmation_actions")
      .update({
        status: "succeeded",
        sanitized_error: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", actionRecord.id);

    if (completionError) {
      return jsonResponse(
        request,
        {
          error:
            "Supabase Auth completed the action, but its audit status could not be finalized. Do not repeat it immediately.",
          retryable: false,
          requestId,
        },
        502,
      );
    }

    const auditAction = action === "resend_confirmation"
      ? "user_confirmation_resent"
      : "user_email_manually_verified";
    const { error: auditError } = await serviceClient.from("audit_logs").insert(
      {
        actor_id: actorId,
        action: auditAction,
        entity_type: "user",
        entity_id: userId,
        metadata: {
          requestId,
          reason: internalReason,
          email: targetUser.email,
          previousConfirmationSentAt: targetUser.confirmation_sent_at ?? null,
          confirmationSentAt,
          confirmedAt,
          manualVerification: action === "verify_email",
        },
      },
    );

    if (auditError) {
      return jsonResponse(
        request,
        {
          error:
            "The email action completed, but its immutable audit entry could not be written.",
          retryable: false,
          requestId,
        },
        502,
      );
    }

    return jsonResponse(request, {
      ok: true,
      action,
      emailConfirmed: action === "verify_email",
      confirmationSentAt,
      confirmedAt,
      requestId,
    });
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

  const { data: authUpdate, error: authUpdateError } = await serviceClient.auth
    .admin.updateUserById(userId, {
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
