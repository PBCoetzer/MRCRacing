import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type NotificationPayload = {
  template?: string;
  tipCardId?: string;
  revision?: number;
  tipsterName?: string;
  meetingVenue?: string;
  meetingDate?: string;
  cardTitle?: string;
  purchaseId?: string;
  coins?: number;
  reason?: string;
  clientUrl?: string;
  status?: "active" | "flagged" | "suspended" | "banned";
  suspensionUntil?: string;
  publicMessage?: string;
  raceNumber?: number;
  changeSummary?: string;
  changedFields?: string[];
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  isAfterLock?: boolean;
  tipsterUrl?: string;
};

type NotificationJob = {
  id: string;
  user_id: string;
  event_type: string;
  dedupe_key: string;
  payload: NotificationPayload;
  attempt_count: number;
  queue_message_id: number;
};

type EmailContent = {
  subject: string;
  text: string;
  html: string;
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
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeJwtPayload(token: string) {
  try {
    const [, encodedPayload] = token.split(".");

    if (!encodedPayload) {
      return null;
    }

    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

    return JSON.parse(atob(padded)) as { role?: string };
  } catch {
    return null;
  }
}

function renderLayout(title: string, body: string, actionUrl: string, actionLabel: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#160b2c;color:#ffffff;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#160b2c;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border:1px solid #7c3aed;background:#281044;border-radius:18px;overflow:hidden">
            <tr>
              <td style="padding:24px 28px;background:#311253;border-bottom:3px solid #ffb000">
                <div style="font-size:24px;font-weight:800;letter-spacing:1px">MRC RACING TIPS</div>
                <div style="margin-top:6px;color:#22d3ee;font-size:13px;text-transform:uppercase;letter-spacing:2px">Horse racing intelligence</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px">
                <h1 style="margin:0 0 18px;font-size:26px;line-height:1.2">${escapeHtml(title)}</h1>
                <div style="color:#e9d5ff;font-size:16px;line-height:1.7">${body}</div>
                <div style="margin-top:28px">
                  <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#ffb000;color:#1a0b2e;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:10px">${escapeHtml(actionLabel)}</a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#1d0c34;color:#c4b5fd;font-size:12px;line-height:1.6">
                MRC Racing provides horse-racing analysis and information. It is not a bookmaker and does not accept bets. Please gamble responsibly.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderEmail(job: NotificationJob): EmailContent {
  const payload = job.payload ?? {};
  const clientUrl = payload.clientUrl ?? "https://www.mrcracing.co.za/client/";

  if (
    ["account_suspended", "account_banned", "account_restored"].includes(
      job.event_type,
    )
  ) {
    const publicMessage = String(
      payload.publicMessage ??
        "Please contact MRC Racing support if you need assistance.",
    );

    if (job.event_type === "account_suspended") {
      const suspensionUntil = payload.suspensionUntil
        ? new Date(payload.suspensionUntil).toLocaleString("en-ZA", {
          timeZone: "Africa/Johannesburg",
          dateStyle: "long",
          timeStyle: "short",
        })
        : "the stated review date";
      const subject = "Your MRC Racing account is temporarily suspended";
      const text =
        `Your MRC Racing account is suspended until ${suspensionUntil}. ${publicMessage}`;
      const html = renderLayout(
        "Your account is temporarily suspended",
        `<p style="margin:0 0 14px">Access to your MRC Racing account is suspended until <strong>${escapeHtml(suspensionUntil)}</strong>.</p><p style="margin:0">${escapeHtml(publicMessage)}</p>`,
        "https://www.mrcracing.co.za/login/",
        "Open MRC Racing",
      );

      return { subject, text, html };
    }

    if (job.event_type === "account_banned") {
      const subject = "Your MRC Racing account has been restricted";
      const text =
        `Your MRC Racing account has been permanently restricted. ${publicMessage}`;
      const html = renderLayout(
        "Your account has been restricted",
        `<p style="margin:0 0 14px">Access to your MRC Racing account has been permanently restricted.</p><p style="margin:0">${escapeHtml(publicMessage)}</p>`,
        "https://www.mrcracing.co.za/",
        "Visit MRC Racing",
      );

      return { subject, text, html };
    }

    const subject = "Your MRC Racing account access has been restored";
    const text = `Your MRC Racing account access has been restored. ${publicMessage}`;
    const html = renderLayout(
      "Your account access is restored",
      `<p style="margin:0 0 14px">Your MRC Racing account is active again and you can sign in normally.</p><p style="margin:0">${escapeHtml(publicMessage)}</p>`,
      "https://www.mrcracing.co.za/login/",
      "Log in to MRC Racing",
    );

    return { subject, text, html };
  }

  if (job.event_type === "purchase_refunded") {
    const credits = Number(payload.coins ?? 0);
    const reason = String(payload.reason ?? "The purchase was refunded.");
    const subject = `${credits} MRC Credits returned to your wallet`;
    const text = `${credits} MRC Credits were returned to your wallet. ${reason}`;
    const html = renderLayout(
      "Your Credits were refunded",
      `<p style="margin:0 0 14px"><strong>${escapeHtml(credits)} MRC Credits</strong> were returned to your wallet.</p><p style="margin:0">${escapeHtml(reason)}</p>`,
      clientUrl,
      "Open your dashboard",
    );

    return { subject, text, html };
  }

  if (job.event_type === "tip_card_race_data_changed") {
    const venue = String(payload.meetingVenue ?? "the selected meeting");
    const raceLabel = payload.raceNumber ? `Race ${payload.raceNumber}` : "meeting";
    const summary = String(payload.changeSummary ?? "Official race information changed.");
    const changedFields = Array.isArray(payload.changedFields)
      ? payload.changedFields.join(", ")
      : "race information";
    const isAfterLock = payload.isAfterLock === true;
    const subject = `Race data changed: ${venue} ${raceLabel}`;
    const text = isAfterLock
      ? `${summary} The affected tip was already locked and remains immutable.`
      : `${summary} Review the affected meeting card before its cutoff.`;
    const html = renderLayout(
      isAfterLock ? "Race data changed after cutoff" : "Race data changed — review required",
      `<p style="margin:0 0 14px">${escapeHtml(summary)}</p><p style="margin:0 0 14px">Changed fields: <strong>${escapeHtml(changedFields)}</strong>.</p><p style="margin:0">${isAfterLock ? "The affected tip remains locked. Clients are not notified." : "Review the affected selection. Clients are notified only if you publish a correction."}</p>`,
      payload.tipsterUrl ?? "https://www.mrcracing.co.za/tipster/",
      "Review meeting card",
    );

    return { subject, text, html };
  }

  const tipsterName = String(payload.tipsterName ?? "Your tipster");
  const venue = String(payload.meetingVenue ?? "the selected meeting");
  const meetingDate = String(payload.meetingDate ?? "");
  const isCorrection = job.event_type === "tip_card_corrected";
  const subject = isCorrection
    ? `Correction published: ${venue} meeting tips`
    : `${tipsterName}'s ${venue} meeting tips are ready`;
  const text = isCorrection
    ? `${tipsterName} published an audited correction for the ${venue} meeting card. Revision ${payload.revision ?? ""}.`
    : `${tipsterName} published the ${venue} meeting card for ${meetingDate}.`;
  const body = isCorrection
    ? `<p style="margin:0 0 14px"><strong>${escapeHtml(tipsterName)}</strong> published an audited correction for the <strong>${escapeHtml(venue)}</strong> meeting card.</p><p style="margin:0">Revision ${escapeHtml(payload.revision)} is now available in your dashboard. Selections whose cutoffs have passed remain locked.</p>`
    : `<p style="margin:0 0 14px"><strong>${escapeHtml(tipsterName)}</strong> published tips for <strong>${escapeHtml(venue)}</strong>${meetingDate ? ` on ${escapeHtml(meetingDate)}` : ""}.</p><p style="margin:0">Your purchase or active subscription already grants access to the full meeting card.</p>`;
  const html = renderLayout(
    isCorrection ? "A meeting-card correction is available" : "Your meeting tips are ready",
    body,
    clientUrl,
    "View meeting tips",
  );

  return { subject, text, html };
}

async function deliverEmail(
  resendApiKey: string,
  recipientEmail: string,
  job: NotificationJob,
) {
  const content = renderEmail(job);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": job.dedupe_key,
    },
    body: JSON.stringify({
      from: "MRC Racing Tips <no-reply@mrcracing.co.za>",
      to: [recipientEmail],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  });
  const responseBody = await response.json().catch(() => ({})) as {
    id?: string;
    message?: string;
    name?: string;
  };

  if (!response.ok) {
    throw new Error(
      responseBody.message ??
        responseBody.name ??
        `Resend returned HTTP ${response.status}.`,
    );
  }

  return responseBody.id ?? "";
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, { error: "Supabase worker configuration is incomplete." }, 500);
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
  const jwtPayload = decodeJwtPayload(accessToken);

  if (jwtPayload?.role !== "service_role") {
    const { data: userData, error: userError } = await serviceClient.auth.getUser(accessToken);

    if (userError || !userData.user) {
      return jsonResponse(request, { error: "Invalid authenticated session." }, 401);
    }

    const { data: workerRoles, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .in("role", ["tipster", "administrator"]);

    if (roleError || !workerRoles?.length) {
      return jsonResponse(request, { error: "Tipster or administrator access required." }, 403);
    }
  }

  const { error: refundError } = await serviceClient.rpc("process_due_meeting_refunds");

  if (refundError) {
    console.error("Due refund processing failed", refundError.message);
  }

  if (!resendApiKey) {
    return jsonResponse(
      request,
      {
        error: "RESEND_API_KEY is not configured.",
        refundsProcessed: !refundError,
      },
      503,
    );
  }

  const { data: claimedData, error: claimError } = await serviceClient.rpc(
    "claim_tip_notification_jobs",
    { p_limit: 20 },
  );

  if (claimError) {
    return jsonResponse(request, { error: claimError.message }, 500);
  }

  const jobs = Array.isArray(claimedData) ? claimedData as NotificationJob[] : [];
  const completed: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const job of jobs) {
    try {
      const { data: recipient, error: recipientError } =
        await serviceClient.auth.admin.getUserById(job.user_id);

      if (recipientError || !recipient.user?.email) {
        throw new Error(recipientError?.message ?? "Recipient email address is unavailable.");
      }

      const providerMessageId = await deliverEmail(
        resendApiKey,
        recipient.user.email,
        job,
      );
      const { error: completeError } = await serviceClient.rpc(
        "complete_tip_notification_job",
        {
          p_outbox_id: job.id,
          p_queue_message_id: job.queue_message_id,
          p_provider_message_id: providerMessageId,
        },
      );

      if (completeError) {
        throw new Error(completeError.message);
      }

      completed.push(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown delivery error.";
      const retrySeconds = Math.min(
        3600,
        60 * 2 ** Math.max(0, Number(job.attempt_count ?? 1) - 1),
      );

      await serviceClient.rpc("fail_tip_notification_job", {
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
    delivered: completed.length,
    failed: failed.length,
    completed,
    failures: failed,
    refundsProcessed: !refundError,
  });
});
