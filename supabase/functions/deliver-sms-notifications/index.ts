import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type SmsJob = {
  id: string;
  user_id: string;
  event_type: string;
  dedupe_key: string;
  payload: { message?: string };
  attempt_count: number;
  queue_message_id: number;
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
      "authorization, apikey, content-type, x-mrc-notification-token",
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
      "Cache-Control": "no-store",
    },
  });
}

function decodeJwtPayload(token: string) {
  try {
    const [, encodedPayload] = token.split(".");
    if (!encodedPayload) return null;
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as { role?: string };
  } catch {
    return null;
  }
}

function encodeBasic(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function normalizeSouthAfricanMobile(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  if (!/^27[6-8]\d{8}$/.test(digits)) {
    throw new Error("Recipient mobile number must be a valid South African number.");
  }
  return digits;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, unknown>;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function safeProviderError(body: Record<string, unknown>, fallback: string) {
  const candidate = body.error ?? body.message ?? body.title;
  return String(candidate ?? fallback).replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function authenticate(baseUrl: string, clientId: string, clientSecret: string) {
  const response = await fetch(`${baseUrl}/api/integration/authentication`, {
    method: "GET",
    headers: { Authorization: `Basic ${encodeBasic(`${clientId}:${clientSecret}`)}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(response);
  if (!response.ok || typeof body.token !== "string") {
    throw new Error(safeProviderError(body, `SMSFlow authentication failed (${response.status}).`));
  }
  return body.token;
}

async function sendSms(
  baseUrl: string,
  token: string,
  destination: string,
  content: string,
) {
  const response = await fetch(`${baseUrl}/api/integration/BulkMessages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      SendOptions: {
        startDeliveryUtc: null,
        campaignName: "MRC Racing transactional alerts",
        checkOptOuts: true,
      },
      messages: [{ destination, content: content.slice(0, 320) }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(safeProviderError(body, `SMSFlow send failed (${response.status}).`));
  }
  const sendResponse = body.sendResponse as Record<string, unknown> | undefined;
  return String(sendResponse?.eventId ?? body.eventId ?? crypto.randomUUID());
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, { error: "Supabase worker configuration is incomplete." }, 500);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const workerToken = request.headers.get("x-mrc-notification-token") ?? "";
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (workerToken) {
    const { data, error } = await serviceClient.rpc(
      "verify_tip_notification_worker_request",
      { p_token: workerToken },
    );
    if (error || data !== true) {
      return jsonResponse(request, { error: "Invalid notification worker token." }, 403);
    }
  } else if (decodeJwtPayload(accessToken)?.role !== "service_role") {
    return jsonResponse(request, { error: "Service-role authentication required." }, 403);
  }

  const clientId = Deno.env.get("SMSFLOW_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SMSFLOW_CLIENT_SECRET") ?? "";
  const baseUrl = (Deno.env.get("SMSFLOW_BASE_URL") ?? "https://portal.smsflow.co.za")
    .replace(/\/+$/, "");
  if (!clientId || !clientSecret) {
    return jsonResponse(request, { error: "SMS delivery is not configured." }, 503);
  }

  const { data: claimedData, error: claimError } = await serviceClient.rpc(
    "claim_sms_notification_jobs",
    { p_limit: 20 },
  );
  if (claimError) return jsonResponse(request, { error: claimError.message }, 500);

  const jobs = Array.isArray(claimedData) ? claimedData as SmsJob[] : [];
  const delivered: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let token = "";

  for (const job of jobs) {
    try {
      const { data: profile, error: profileError } = await serviceClient
        .from("profiles")
        .select("phone,sms_notifications_enabled")
        .eq("id", job.user_id)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message);

      if (!profile?.sms_notifications_enabled) {
        const { error } = await serviceClient.rpc("complete_sms_notification_job", {
          p_outbox_id: job.id,
          p_queue_message_id: job.queue_message_id,
          p_provider_message_id: "skipped:preference-disabled",
        });
        if (error) throw new Error(error.message);
        delivered.push(job.id);
        continue;
      }

      const destination = normalizeSouthAfricanMobile(String(profile.phone ?? ""));
      const content = String(job.payload?.message ?? "").trim();
      if (!content) throw new Error("SMS notification content is empty.");
      if (!token) token = await authenticate(baseUrl, clientId, clientSecret);
      const providerMessageId = await sendSms(baseUrl, token, destination, content);
      const { error: completeError } = await serviceClient.rpc(
        "complete_sms_notification_job",
        {
          p_outbox_id: job.id,
          p_queue_message_id: job.queue_message_id,
          p_provider_message_id: providerMessageId,
        },
      );
      if (completeError) throw new Error(completeError.message);
      delivered.push(job.id);
    } catch (caughtError) {
      const message = caughtError instanceof Error
        ? caughtError.message
        : "Unknown SMS delivery error.";
      const retrySeconds = Math.min(
        3600,
        60 * 2 ** Math.max(0, Number(job.attempt_count ?? 1) - 1),
      );
      await serviceClient.rpc("fail_sms_notification_job", {
        p_outbox_id: job.id,
        p_queue_message_id: job.queue_message_id,
        p_error: message,
        p_retry_seconds: retrySeconds,
      });
      failed.push({ id: job.id, error: message });
    }
  }

  return jsonResponse(request, {
    claimed: jobs.length,
    delivered: delivered.length,
    failed: failed.length,
    completed: delivered,
    failures: failed,
  });
});
