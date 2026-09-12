import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "standardwebhooks";
import {
  buildAuthEmailJobs,
  type AuthEmailHookPayload,
  type AuthEmailJob,
} from "../_shared/auth-email.ts";

type MessageRecord = {
  id: string;
  provider_message_id: string | null;
  status: string;
};

type ServiceClient = ReturnType<typeof createClient<any>>;

class ProviderSendError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProviderSendError";
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function normalizedHookSecret(secret: string) {
  return secret
    .trim()
    .replace(/^v1,whsec_/, "")
    .replace(/^whsec_/, "");
}

function verifyHookPayload(rawBody: string, headers: Headers) {
  const configuredSecrets = requiredEnvironment("SEND_EMAIL_HOOK_SECRET")
    .split("|")
    .map(normalizedHookSecret)
    .filter(Boolean);
  const webhookHeaders = Object.fromEntries(headers.entries());

  for (const secret of configuredSecrets) {
    try {
      return new Webhook(secret).verify(
        rawBody,
        webhookHeaders,
      ) as AuthEmailHookPayload;
    } catch {
      // Try the next configured secret during key rotation.
    }
  }

  throw new Error("Authentication email hook signature is invalid.");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeProviderError(value: unknown) {
  if (!value || typeof value !== "object") return "Email provider rejected the request.";
  const candidate = value as { message?: unknown; name?: unknown };
  return String(candidate.message ?? candidate.name ?? "Email provider rejected the request.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

async function stageMessage(
  serviceClient: ServiceClient,
  userId: string,
  job: AuthEmailJob,
  requestFingerprint: string,
) {
  const { data, error } = await serviceClient
    .from("auth_email_messages")
    .insert({
      request_fingerprint: requestFingerprint,
      provider: "resend",
      user_id: userId,
      recipient_email: job.recipient,
      email_action_type: job.actionType,
      action_variant: job.actionVariant,
      subject: job.subject,
      status: "pending",
      attempt_count: 1,
    })
    .select("id,provider_message_id,status")
    .single<MessageRecord>();

  if (!error && data) return data;

  if (error?.code !== "23505") {
    throw new Error("Authentication email audit record could not be created.");
  }

  const { data: existing, error: existingError } = await serviceClient
    .from("auth_email_messages")
    .select("id,provider_message_id,status")
    .eq("request_fingerprint", requestFingerprint)
    .single<MessageRecord>();

  if (existingError || !existing) {
    throw new Error("Authentication email audit record could not be recovered.");
  }

  if (existing.status === "failed") {
    const { data: retried, error: retryError } = await serviceClient
      .from("auth_email_messages")
      .update({
        status: "pending",
        last_error_code: null,
        last_error_message: null,
        attempt_count: await incrementAttemptCount(serviceClient, existing.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id,provider_message_id,status")
      .single<MessageRecord>();

    if (retryError || !retried) {
      throw new Error("Authentication email retry could not be staged.");
    }
    return retried;
  }

  return existing;
}

async function incrementAttemptCount(
  serviceClient: ServiceClient,
  messageId: string,
) {
  const { data } = await serviceClient
    .from("auth_email_messages")
    .select("attempt_count")
    .eq("id", messageId)
    .single<{ attempt_count: number }>();
  return Math.max(1, Number(data?.attempt_count ?? 1) + 1);
}

async function sendWithResend(
  job: AuthEmailJob,
  userId: string,
  idempotencyKey: string,
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnvironment("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: Deno.env.get("AUTH_EMAIL_FROM")?.trim() ||
        "MRC Racing Tips <no-reply@mrcracing.co.za>",
      to: [job.recipient],
      subject: job.subject,
      html: job.html,
      reply_to: Deno.env.get("AUTH_EMAIL_REPLY_TO")?.trim() ||
        "support@mrcracing.co.za",
      tags: [
        { name: "mrc_user_id", value: userId },
        { name: "mrc_auth_action", value: job.actionType },
        { name: "mrc_auth_variant", value: job.actionVariant },
      ],
    }),
  });

  const responseBody = await response.json().catch(() => ({})) as {
    id?: string;
    name?: string;
    message?: string;
  };

  if (!response.ok || !responseBody.id) {
    throw new ProviderSendError(
      response.status,
      String(responseBody.name ?? `http_${response.status}`),
      safeProviderError(responseBody),
    );
  }

  return responseBody.id;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed." } }, 405);
  }

  try {
    const rawBody = await request.text();
    const payload = verifyHookPayload(rawBody, request.headers);
    const supabaseUrl = requiredEnvironment("SUPABASE_URL");
    const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    const serviceClient = createClient<any>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const jobs = buildAuthEmailJobs(payload, supabaseUrl);

    for (const job of jobs) {
      const requestFingerprint = await sha256([
        payload.user.id,
        job.recipient,
        job.actionType,
        job.actionVariant,
        job.tokenHash,
        payload.email_data.redirect_to ?? "",
      ].join("|"));
      const message = await stageMessage(
        serviceClient,
        payload.user.id,
        job,
        requestFingerprint,
      );

      if (message.provider_message_id && message.status !== "failed") {
        continue;
      }

      try {
        const providerMessageId = await sendWithResend(
          job,
          payload.user.id,
          `mrc-auth-${requestFingerprint}`,
        );
        const acceptedAt = new Date().toISOString();
        const { error: updateError } = await serviceClient
          .from("auth_email_messages")
          .update({
            provider_message_id: providerMessageId,
            status: "accepted",
            accepted_at: acceptedAt,
            latest_event_at: acceptedAt,
            updated_at: acceptedAt,
          })
          .eq("id", message.id);

        if (updateError) {
          throw new Error("Email was accepted but its provider reference could not be recorded.");
        }

        await serviceClient.from("auth_user_diagnostic_events").insert({
          user_id: payload.user.id,
          email: job.recipient,
          event_type: "email_provider_accepted",
          source: "auth_email_hook",
          event_at: acceptedAt,
          details: {
            provider: "resend",
            providerMessageId,
            emailActionType: job.actionType,
            actionVariant: job.actionVariant,
          },
        });
      } catch (error) {
        const failedAt = new Date().toISOString();
        const providerError = error instanceof ProviderSendError ? error : null;
        await serviceClient
          .from("auth_email_messages")
          .update({
            status: "failed",
            failed_at: failedAt,
            latest_event_at: failedAt,
            last_error_code: providerError?.code ?? "send_failed",
            last_error_message: safeProviderError(error),
            updated_at: failedAt,
          })
          .eq("id", message.id);
        throw error;
      }
    }

    return jsonResponse({});
  } catch (error) {
    console.error("Authentication email hook failed", error);
    return jsonResponse(
      {
        error: {
          http_code: error instanceof ProviderSendError ? error.status : 500,
          message: safeProviderError(error),
        },
      },
      error instanceof ProviderSendError && error.status >= 400 && error.status < 500
        ? 400
        : 500,
    );
  }
});
