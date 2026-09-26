import "edge-runtime";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildTelegramApprovalRequests,
  type TelegramApprovalPayload,
  validProposalId,
} from "./telegram.ts";
import { buildBlogAnnouncementContent } from "./blog-email.ts";
import { buildMeetingCardAffiliateFooter } from "./meeting-card-affiliate.ts";
import { jwtHasAal2 } from "../_shared/mfa.ts";
import {
  type CurrentFixture,
  type CurrentRaceEntry,
  type CurrentRaceMeeting,
  summarizeProposalChanges,
} from "./proposal-changes.ts";

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
  notificationAudience?:
    | "all_clients"
    | "marketing_consented_clients"
    | "marketing_consented_registered_users";
  blogPostId?: string;
  blogTitle?: string;
  blogExcerpt?: string;
  blogUrl?: string;
  authorName?: string;
  publishedAt?: string;
  preferenceUrl?: string;
  proposalId?: string;
  confidenceScore?: number;
  distinctSourceCount?: number;
  approvedSourceCount?: number;
  changeType?: string;
  adminUrl?: string;
  confidenceBreakdown?: Record<string, unknown>;
  raceSnapshot?: TelegramApprovalPayload["raceSnapshot"];
  reviewKind?: TelegramApprovalPayload["reviewKind"];
  differenceSummary?: string;
  sourceDomains?: string[];
  sourceUrls?: string[];
  changes?: TelegramApprovalPayload["changes"];
  changeCount?: number;
  omittedChangeCount?: number;
  conflictSummary?: string;
  feedbackEnabled?: boolean;
};

type NotificationJob = {
  id: string;
  user_id: string;
  event_type: string;
  channel: "email" | "telegram";
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

type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  senderName: string;
};

type TelegramConfig = {
  botToken: string;
  chatId: string;
};

const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);
const mrcLogoUrl =
  "https://www.mrcracing.co.za/images/mrc-racing-tips-logo.jpeg";

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

function stripControlCharacters(value: string) {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
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

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return btoa(binary);
}

function wrapBase64(value: string) {
  return encodeBase64(value).match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function encodeMimeHeader(value: string) {
  return `=?UTF-8?B?${encodeBase64(value.replace(/[\r\n]+/g, " "))}?=`;
}

function validateEmailAddress(value: string) {
  const normalized = value.trim();

  if (
    normalized.length > 254 ||
    /[\r\n]/.test(normalized) ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)
  ) {
    throw new Error("Email delivery address is invalid.");
  }

  return normalized;
}

async function writeSmtp(conn: Deno.TlsConn, value: string) {
  const encoded = new TextEncoder().encode(value);
  let written = 0;

  while (written < encoded.length) {
    written += await conn.write(encoded.subarray(written));
  }
}

async function readSmtpResponse(conn: Deno.TlsConn) {
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(4096);
  let response = "";

  while (response.length < 65536) {
    const read = await conn.read(buffer);

    if (read === null) {
      throw new Error("SMTP server closed the connection unexpectedly.");
    }

    response += decoder.decode(buffer.subarray(0, read));
    const lines = response.split(/\r?\n/).filter(Boolean);
    const lastLine = lines.at(-1) ?? "";

    if (/^\d{3} /.test(lastLine)) {
      return {
        code: Number(lastLine.slice(0, 3)),
        response,
      };
    }
  }

  throw new Error("SMTP response exceeded the permitted size.");
}

async function smtpCommand(
  conn: Deno.TlsConn,
  command: string,
  expectedCodes: number[],
) {
  await writeSmtp(conn, `${command}\r\n`);
  const result = await readSmtpResponse(conn);

  if (!expectedCodes.includes(result.code)) {
    const safeMessage = result.response
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1)
      ?.replace(/[\r\n]+/g, " ") ?? "Unexpected SMTP response.";
    throw new Error(`SMTP delivery failed: ${safeMessage}`);
  }

  return result;
}

function renderLayout(
  title: string,
  body: string,
  actionUrl: string,
  actionLabel: string,
  promotionalFooterHtml = "",
) {
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
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding-right:18px;vertical-align:middle">
                      <div style="font-size:24px;font-weight:800;letter-spacing:1px">MRC RACING TIPS</div>
                      <div style="margin-top:6px;color:#22d3ee;font-size:13px;text-transform:uppercase;letter-spacing:2px">Horse racing intelligence</div>
                    </td>
                    <td width="112" align="right" style="vertical-align:middle">
                      <img src="${mrcLogoUrl}" width="104" alt="MRC Racing Tips" style="display:block;width:104px;max-width:104px;height:auto;border:1px solid #ffb000;border-radius:12px">
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px">
                <h1 style="margin:0 0 18px;font-size:26px;line-height:1.2">${
    escapeHtml(title)
  }</h1>
                <div style="color:#e9d5ff;font-size:16px;line-height:1.7">${body}</div>
                <div style="margin-top:28px">
                  <a href="${
    escapeHtml(actionUrl)
  }" style="display:inline-block;background:#ffb000;color:#1a0b2e;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:10px">${
    escapeHtml(actionLabel)
  }</a>
                </div>
              </td>
            </tr>
            ${
    promotionalFooterHtml
      ? `<tr>
              <td style="padding:0 28px 24px;background:#281044">
                ${promotionalFooterHtml}
              </td>
            </tr>`
      : ""
  }
            <tr>
              <td style="padding:18px 28px;background:#1d0c34;color:#c4b5fd;font-size:12px;line-height:1.6">
                MRC Racing Tips provides South African horse-racing analysis, factual race information, and independent digital tipster content.
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
        `<p style="margin:0 0 14px">Access to your MRC Racing account is suspended until <strong>${
          escapeHtml(suspensionUntil)
        }</strong>.</p><p style="margin:0">${escapeHtml(publicMessage)}</p>`,
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
        `<p style="margin:0 0 14px">Access to your MRC Racing account has been permanently restricted.</p><p style="margin:0">${
          escapeHtml(publicMessage)
        }</p>`,
        "https://www.mrcracing.co.za/",
        "Visit MRC Racing",
      );

      return { subject, text, html };
    }

    const subject = "Your MRC Racing account access has been restored";
    const text =
      `Your MRC Racing account access has been restored. ${publicMessage}`;
    const html = renderLayout(
      "Your account access is restored",
      `<p style="margin:0 0 14px">Your MRC Racing account is active again and you can sign in normally.</p><p style="margin:0">${
        escapeHtml(publicMessage)
      }</p>`,
      "https://www.mrcracing.co.za/login/",
      "Log in to MRC Racing",
    );

    return { subject, text, html };
  }

  if (job.event_type === "purchase_refunded") {
    const credits = Number(payload.coins ?? 0);
    const reason = String(payload.reason ?? "The purchase was refunded.");
    const subject = `${credits} MRC Credits returned to your wallet`;
    const text =
      `${credits} MRC Credits were returned to your wallet. ${reason}`;
    const html = renderLayout(
      "Your Credits were refunded",
      `<p style="margin:0 0 14px"><strong>${
        escapeHtml(credits)
      } MRC Credits</strong> were returned to your wallet.</p><p style="margin:0">${
        escapeHtml(reason)
      }</p>`,
      clientUrl,
      "Open your dashboard",
    );

    return { subject, text, html };
  }

  if (job.event_type === "tip_card_race_data_changed") {
    const venue = String(payload.meetingVenue ?? "the selected meeting");
    const raceLabel = payload.raceNumber
      ? `Race ${payload.raceNumber}`
      : "meeting";
    const summary = String(
      payload.changeSummary ?? "Official race information changed.",
    );
    const changedFields = Array.isArray(payload.changedFields)
      ? payload.changedFields.join(", ")
      : "race information";
    const isAfterLock = payload.isAfterLock === true;
    const subject = `Race data changed: ${venue} ${raceLabel}`;
    const text = isAfterLock
      ? `${summary} The affected tip was already locked and remains immutable.`
      : `${summary} Review the affected meeting card before its cutoff.`;
    const html = renderLayout(
      isAfterLock
        ? "Race data changed after cutoff"
        : "Race data changed — review required",
      `<p style="margin:0 0 14px">${
        escapeHtml(summary)
      }</p><p style="margin:0 0 14px">Changed fields: <strong>${
        escapeHtml(changedFields)
      }</strong>.</p><p style="margin:0">${
        isAfterLock
          ? "The affected tip remains locked. Clients are not notified."
          : "Review the affected selection. Clients are notified only if you publish a correction."
      }</p>`,
      payload.tipsterUrl ?? "https://www.mrcracing.co.za/tipster/",
      "Review meeting card",
    );

    return { subject, text, html };
  }

  if (job.event_type === "favourite_tipster_card_published") {
    const affiliateFooter = buildMeetingCardAffiliateFooter();
    const tipsterName = String(payload.tipsterName ?? "A favourite tipster");
    const venue = String(payload.meetingVenue ?? "a new race meeting");
    const meetingDate = String(payload.meetingDate ?? "");
    const tipsterUrl = String(
      payload.tipsterUrl ?? "https://www.mrcracing.co.za/tipsters/",
    );
    const subject = `${tipsterName} published a new ${venue} meeting card`;
    const dateText = meetingDate ? ` for ${meetingDate}` : "";
    const text =
      `${tipsterName}, one of your favourite tipsters, published a ${venue} meeting card${dateText}. ` +
      "Visit the tipster profile to view its preview and available access options.\n\n" +
      affiliateFooter.text;
    const html = renderLayout(
      "A favourite tipster published a new card",
      `<p style="margin:0 0 14px"><strong>${
        escapeHtml(tipsterName)
      }</strong>, one of your favourite tipsters, published a meeting card for <strong>${
        escapeHtml(venue)
      }</strong>${meetingDate ? ` on ${escapeHtml(meetingDate)}` : ""}.</p>` +
        '<p style="margin:0">Favouriting a tipster does not grant access by itself. Visit the tipster profile to view the preview and available purchase or subscription options.</p>',
      tipsterUrl,
      "View tipster profile",
      affiliateFooter.html,
    );

    return { subject, text, html };
  }

  if (job.event_type === "tip_card_published_all_clients") {
    const affiliateFooter = buildMeetingCardAffiliateFooter();
    const tipsterName = String(payload.tipsterName ?? "An MRC tipster");
    const venue = String(payload.meetingVenue ?? "a new race meeting");
    const meetingDate = String(payload.meetingDate ?? "");
    const tipsterUrl = String(
      payload.tipsterUrl ?? "https://www.mrcracing.co.za/tipsters/",
    );
    const subject = `${tipsterName} published a new ${venue} meeting card`;
    const dateText = meetingDate ? ` for ${meetingDate}` : "";
    const text =
      `${tipsterName} published a new ${venue} meeting card${dateText}. ` +
      "Visit the tipster profile to review the preview and available access options.\n\n" +
      affiliateFooter.text;
    const html = renderLayout(
      "A new meeting card is available",
      `<p style="margin:0 0 14px"><strong>${
        escapeHtml(tipsterName)
      }</strong> published a new meeting card for <strong>${
        escapeHtml(venue)
      }</strong>${meetingDate ? ` on ${escapeHtml(meetingDate)}` : ""}.</p>` +
        '<p style="margin:0">Visit the tipster profile to review the preview and available purchase or subscription options. This announcement does not grant access by itself.</p>',
      tipsterUrl,
      "View meeting card options",
      affiliateFooter.html,
    );

    return { subject, text, html };
  }

  if (job.event_type === "blog_post_published_announcement") {
    const content = buildBlogAnnouncementContent(payload);
    const html = renderLayout(
      content.title,
      content.body,
      content.actionUrl,
      content.actionLabel,
    );

    return { subject: content.subject, text: content.text, html };
  }

  const tipsterName = String(payload.tipsterName ?? "Your tipster");
  const venue = String(payload.meetingVenue ?? "the selected meeting");
  const meetingDate = String(payload.meetingDate ?? "");
  const isCorrection = job.event_type === "tip_card_corrected";
  const subject = isCorrection
    ? `Correction published: ${venue} meeting tips`
    : `${tipsterName}'s ${venue} meeting tips are ready`;
  const text = isCorrection
    ? `${tipsterName} published an audited correction for the ${venue} meeting card. Revision ${
      payload.revision ?? ""
    }.`
    : `${tipsterName} published the ${venue} meeting card for ${meetingDate}.`;
  const body = isCorrection
    ? `<p style="margin:0 0 14px"><strong>${
      escapeHtml(tipsterName)
    }</strong> published an audited correction for the <strong>${
      escapeHtml(venue)
    }</strong> meeting card.</p><p style="margin:0">Revision ${
      escapeHtml(payload.revision)
    } is now available in your dashboard. Selections whose cutoffs have passed remain locked.</p>`
    : `<p style="margin:0 0 14px"><strong>${
      escapeHtml(tipsterName)
    }</strong> published tips for <strong>${escapeHtml(venue)}</strong>${
      meetingDate ? ` on ${escapeHtml(meetingDate)}` : ""
    }.</p><p style="margin:0">Your purchase or active subscription already grants access to the full meeting card.</p>`;
  const html = renderLayout(
    isCorrection
      ? "A meeting-card correction is available"
      : "Your meeting tips are ready",
    body,
    clientUrl,
    "View meeting tips",
  );

  return { subject, text, html };
}

async function deliverEmail(
  smtp: SmtpConfig,
  recipientEmail: string,
  job: NotificationJob,
) {
  const content = renderEmail(job);
  const recipient = validateEmailAddress(recipientEmail);
  const fromEmail = validateEmailAddress(smtp.fromEmail);
  const boundary = `mrc-${crypto.randomUUID()}`;
  const messageToken = job.dedupe_key
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 120) || crypto.randomUUID();
  const messageId = `${messageToken}@mrcracing.co.za`;
  const message = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    `From: ${encodeMimeHeader(smtp.senderName)} <${fromEmail}>`,
    `To: <${recipient}>`,
    `Subject: ${encodeMimeHeader(content.subject)}`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(content.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(content.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const dotStuffedMessage = message.replace(/(^|\r\n)\./g, "$1..");
  const conn = await Deno.connectTls({ hostname: smtp.host, port: smtp.port });

  try {
    const greeting = await readSmtpResponse(conn);

    if (greeting.code !== 220) {
      throw new Error("SMTP server did not provide a valid greeting.");
    }

    await smtpCommand(conn, "EHLO mrcracing.co.za", [250]);
    await smtpCommand(conn, "AUTH LOGIN", [334]);
    await smtpCommand(conn, encodeBase64(smtp.username), [334]);
    await smtpCommand(conn, encodeBase64(smtp.password), [235]);
    await smtpCommand(conn, `MAIL FROM:<${fromEmail}>`, [250]);
    await smtpCommand(conn, `RCPT TO:<${recipient}>`, [250, 251]);
    await smtpCommand(conn, "DATA", [354]);
    await writeSmtp(conn, `${dotStuffedMessage}.\r\n`);
    const delivery = await readSmtpResponse(conn);

    if (delivery.code !== 250) {
      const safeMessage = delivery.response
        .split(/\r?\n/)
        .filter(Boolean)
        .at(-1)
        ?.replace(/[\r\n]+/g, " ") ?? "Message was rejected.";
      throw new Error(`SMTP delivery failed: ${safeMessage}`);
    }

    await smtpCommand(conn, "QUIT", [221]).catch(() => undefined);
    return messageId;
  } finally {
    conn.close();
  }
}

async function deliverTelegram(
  telegram: TelegramConfig,
  payload: TelegramApprovalPayload,
) {
  if (!telegram.botToken || !telegram.chatId) {
    throw new Error("Telegram approval notifications are not configured.");
  }

  const request = buildTelegramApprovalRequests(payload)[0];
  const response = await fetch(
    `https://api.telegram.org/bot${
      encodeURIComponent(telegram.botToken)
    }/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegram.chatId, ...request }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  } | null;
  if (!response.ok || result?.ok !== true || !result.result?.message_id) {
    const description = typeof result?.description === "string"
      ? stripControlCharacters(result.description).trim().slice(0, 180)
      : "Provider rejected the request.";
    throw new Error(
      `Telegram delivery failed with HTTP ${response.status}: ${description}`,
    );
  }
  return `telegram:${result.result.message_id}`;
}

async function loadProposalChangePayload(
  serviceClient: SupabaseClient,
  proposalId: string,
  basePayload: NotificationPayload,
) {
  const { data: proposalData, error: proposalError } = await serviceClient
    .from("race_feed_proposals")
    .select(
      "snapshot,confidence_breakdown,proposal_version,conflict_summary,has_critical_conflict,venue,meeting_date",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (proposalError) {
    throw new Error(
      `Could not load the proposed race changes: ${proposalError.message}`,
    );
  }
  if (!proposalData) {
    throw new Error("The proposed race changes are no longer available.");
  }

  const proposal = proposalData as {
    snapshot?: TelegramApprovalPayload["raceSnapshot"];
    confidence_breakdown?: Record<string, unknown>;
    proposal_version?: number;
    conflict_summary?: string | null;
    has_critical_conflict?: boolean;
    venue?: string;
    meeting_date?: string;
  };
  const venue = String(proposal.venue ?? basePayload.meetingVenue ?? "").trim();
  const meetingDate = String(
    proposal.meeting_date ?? basePayload.meetingDate ?? "",
  ).trim();
  if (!venue || !meetingDate || !proposal.snapshot?.meetings?.length) {
    throw new Error(
      "The race proposal is missing its meeting identity or snapshot.",
    );
  }
  const { data: meetingData, error: meetingError } = await serviceClient
    .from("race_meetings")
    .select("id,venue,meeting_date,status")
    .eq("venue", venue)
    .eq("meeting_date", meetingDate)
    .eq("is_test", false)
    .maybeSingle();
  if (meetingError) {
    throw new Error(
      `Could not load the current race meeting: ${meetingError.message}`,
    );
  }

  const currentMeeting = meetingData as CurrentRaceMeeting | null;
  let currentFixtures: CurrentFixture[] = [];
  let currentEntries: CurrentRaceEntry[] = [];
  if (currentMeeting) {
    const { data: fixtureData, error: fixtureError } = await serviceClient
      .from("fixtures")
      .select(
        "id,race_number,title,starts_at,distance_m,race_class,status,result_summary",
      )
      .eq("meeting_id", currentMeeting.id)
      .order("race_number", { ascending: true });
    if (fixtureError) {
      throw new Error(
        `Could not load the current races: ${fixtureError.message}`,
      );
    }
    currentFixtures = (fixtureData ?? []) as CurrentFixture[];
    const fixtureIds = currentFixtures.map((fixture) => fixture.id);
    if (fixtureIds.length) {
      const { data: entryData, error: entryError } = await serviceClient
        .from("race_entries")
        .select(
          "fixture_id,saddle_number,horse_name,jockey_name,trainer_name,draw,carried_weight,status,result_position",
        )
        .in("fixture_id", fixtureIds)
        .order("saddle_number", { ascending: true });
      if (entryError) {
        throw new Error(
          `Could not load the current runners: ${entryError.message}`,
        );
      }
      currentEntries = (entryData ?? []) as CurrentRaceEntry[];
    }
  }

  const summary = summarizeProposalChanges(
    proposal.snapshot,
    currentMeeting,
    currentFixtures,
    currentEntries,
  );
  const conflictSummary = String(proposal.conflict_summary ?? "").trim();
  const shouldSend = summary.changeCount > 0 ||
    proposal.has_critical_conflict === true || Boolean(conflictSummary);

  return {
    shouldSend,
    payload: {
      ...basePayload,
      reviewKind: "proposal_changes" as const,
      meetingVenue: venue,
      meetingDate,
      confidenceBreakdown: proposal.confidence_breakdown,
      proposalVersion: proposal.proposal_version,
      raceSnapshot: undefined,
      changes: summary.changes,
      changeCount: summary.changeCount,
      omittedChangeCount: summary.omitted,
      conflictSummary,
      feedbackEnabled: true,
    },
  };
}

async function discoverTelegramChats(telegram: TelegramConfig) {
  if (!telegram.botToken) {
    throw new Error("Telegram approval notifications are not configured.");
  }

  const method = telegram.chatId ? "getChat" : "getUpdates";
  const query = telegram.chatId
    ? `?chat_id=${encodeURIComponent(telegram.chatId)}`
    : "?limit=100&timeout=0";
  const response = await fetch(
    `https://api.telegram.org/bot${
      encodeURIComponent(telegram.botToken)
    }/${method}${query}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
    result?:
      | TelegramChat
      | Array<{
        message?: { chat?: TelegramChat };
        edited_message?: { chat?: TelegramChat };
        channel_post?: { chat?: TelegramChat };
        edited_channel_post?: { chat?: TelegramChat };
        my_chat_member?: { chat?: TelegramChat };
      }>;
  } | null;

  if (!response.ok || payload?.ok !== true || !payload.result) {
    const description = typeof payload?.description === "string"
      ? stripControlCharacters(payload.description).trim().slice(0, 180)
      : "Provider rejected the request.";
    throw new Error(
      `Telegram chat discovery failed with HTTP ${response.status}: ${description}`,
    );
  }

  if (!Array.isArray(payload.result)) {
    const chat = payload.result;
    return [{
      id: String(chat.id),
      type: chat.type ?? "unknown",
      label: chat.title ??
        (chat.username ? `@${chat.username}` : "Private chat"),
    }];
  }

  const chats = new Map<string, TelegramChat>();
  for (const update of payload.result) {
    const chat = update.message?.chat ?? update.edited_message?.chat ??
      update.channel_post?.chat ?? update.edited_channel_post?.chat ??
      update.my_chat_member?.chat;
    if (chat && Number.isSafeInteger(chat.id)) {
      chats.set(String(chat.id), chat);
    }
  }

  return [...chats.values()].map((chat) => ({
    id: String(chat.id),
    type: chat.type ?? "unknown",
    label: chat.title ?? (chat.username ? `@${chat.username}` : "Private chat"),
  }));
}

type TelegramChat = {
  id: number;
  type?: string;
  title?: string;
  username?: string;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const smtp: SmtpConfig = {
    host: Deno.env.get("MRC_SMTP_HOST") ?? "",
    port: Number(Deno.env.get("MRC_SMTP_PORT") ?? "465"),
    username: Deno.env.get("MRC_SMTP_USERNAME") ?? "",
    password: Deno.env.get("MRC_SMTP_PASSWORD") ?? "",
    fromEmail: Deno.env.get("MRC_SMTP_FROM_EMAIL") ?? "",
    senderName: Deno.env.get("MRC_SMTP_SENDER_NAME") ?? "MRC Racing Tips",
  };
  const telegram: TelegramConfig = {
    botToken: Deno.env.get("MRC_TELEGRAM_BOT_TOKEN") ?? "",
    chatId: Deno.env.get("MRC_TELEGRAM_ADMIN_CHAT_ID") ?? "",
  };
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const workerToken = request.headers.get("x-mrc-notification-token") ?? "";
  const requestBody = await request.json().catch(() => ({})) as Record<
    string,
    unknown
  >;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, {
      error: "Supabase worker configuration is incomplete.",
    }, 500);
  }

  if (!accessToken && !workerToken) {
    return jsonResponse(request, { error: "Authentication required." }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  if (workerToken) {
    const { data: workerAuthorized, error: workerError } = await serviceClient
      .rpc(
        "verify_tip_notification_worker_request",
        { p_token: workerToken },
      );

    if (workerError || workerAuthorized !== true) {
      return jsonResponse(request, {
        error: "Invalid notification worker token.",
      }, 403);
    }
  } else {
    const jwtPayload = decodeJwtPayload(accessToken);

    if (jwtPayload?.role === "service_role") {
      // The platform service role is permitted to drain the queue.
    } else {
      const { data: userData, error: userError } = await serviceClient.auth
        .getUser(accessToken);

      if (userError || !userData.user) {
        return jsonResponse(request, {
          error: "Invalid authenticated session.",
        }, 401);
      }

      const { data: workerRoles, error: roleError } = await serviceClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .in("role", ["tipster", "administrator"]);

      if (roleError || !workerRoles?.length) {
        return jsonResponse(request, {
          error: "Tipster or administrator access required.",
        }, 403);
      }

      const hasTipsterRole = workerRoles.some(
        (role: { role: string }) => role.role === "tipster",
      );
      const hasAdministratorRole = workerRoles.some(
        (role: { role: string }) => role.role === "administrator",
      );
      if (hasAdministratorRole && !hasTipsterRole && !jwtHasAal2(accessToken)) {
        return jsonResponse(request, {
          error: "Administrator two-factor authentication required.",
          code: "mfa_required",
        }, 403);
      }
    }
  }

  if (requestBody.trigger === "telegram-discover-chat") {
    if (!workerToken) {
      return jsonResponse(
        request,
        { error: "Worker authorization required." },
        403,
      );
    }
    try {
      const chats = await discoverTelegramChats(telegram);
      return jsonResponse(request, { chats, count: chats.length });
    } catch (error) {
      return jsonResponse(request, {
        error: error instanceof Error
          ? error.message
          : "Telegram chat discovery failed.",
      }, 502);
    }
  }

  const { data: claimedData, error: claimError } = await serviceClient.rpc(
    "claim_tip_notification_jobs",
    { p_limit: 20 },
  );

  if (claimError) {
    return jsonResponse(request, { error: claimError.message }, 500);
  }

  const jobs = Array.isArray(claimedData)
    ? claimedData as NotificationJob[]
    : [];
  const completed: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const job of jobs) {
    try {
      let providerMessageId: string;
      if (job.channel === "telegram") {
        let telegramPayload: TelegramApprovalPayload = job.payload;
        const proposalId = validProposalId(job.payload.proposalId);
        if (
          job.event_type === "race_feed_proposal_review_required" && proposalId
        ) {
          const changePayload = await loadProposalChangePayload(
            serviceClient,
            proposalId,
            job.payload,
          );
          telegramPayload = changePayload.payload;
          const { error: payloadAuditError } = await serviceClient
            .from("notification_outbox")
            .update({ payload: telegramPayload })
            .eq("id", job.id);
          if (payloadAuditError) {
            throw new Error(
              `Could not document the Telegram race changes: ${payloadAuditError.message}`,
            );
          }
          if (!changePayload.shouldSend) {
            providerMessageId = "telegram:skipped-no-factual-change";
          } else {
            providerMessageId = await deliverTelegram(
              telegram,
              telegramPayload,
            );
          }
        } else {
          providerMessageId = await deliverTelegram(telegram, telegramPayload);
        }
      } else {
        if (
          !smtp.host ||
          smtp.port !== 465 ||
          !smtp.username ||
          !smtp.password ||
          !smtp.fromEmail
        ) {
          throw new Error("The dedicated SMTPS mailbox is not configured.");
        }
        const { data: recipient, error: recipientError } = await serviceClient
          .auth.admin.getUserById(job.user_id);

        if (recipientError || !recipient.user?.email) {
          throw new Error(
            recipientError?.message ??
              "Recipient email address is unavailable.",
          );
        }

        providerMessageId = await deliverEmail(
          smtp,
          recipient.user.email,
          job,
        );
      }
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
      const message = error instanceof Error
        ? error.message
        : "Unknown delivery error.";
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
  });
});
