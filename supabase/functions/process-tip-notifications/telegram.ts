export type TelegramRaceRunner = {
  horseName?: string;
  jockeyName?: string;
  trainerName?: string;
  saddleNumber?: number;
  draw?: number | null;
  carriedWeight?: number | null;
  status?: string;
};

export type TelegramRace = {
  raceNumber?: number;
  startsAt?: string;
  title?: string;
  raceClass?: string;
  distanceMetres?: number | null;
  runners?: TelegramRaceRunner[];
};

export type TelegramRaceSnapshot = {
  meetings?: Array<{
    venue?: string;
    meetingDate?: string;
    races?: TelegramRace[];
  }>;
};

export type TelegramApprovalPayload = {
  meetingVenue?: string;
  meetingDate?: string;
  confidenceScore?: number;
  distinctSourceCount?: number;
  approvedSourceCount?: number;
  changeType?: string;
  proposalId?: string;
  proposalVersion?: number;
  confidenceBreakdown?: Record<string, unknown>;
  raceSnapshot?: TelegramRaceSnapshot;
};

export type TelegramDecision = "approve" | "reject";

export type TelegramMessageRequest = {
  text: string;
  link_preview_options: { is_disabled: true };
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; url: string }>>;
  };
};

const adminBaseUrl = "https://www.mrcracing.co.za/admin/racing/";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function compact(value: unknown, fallback: string, maximumLength = 120) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, maximumLength);
}

function finiteNumber(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatMeetingDate(value: unknown) {
  const normalized = compact(value, "Unknown date", 32);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return normalized;

  const date = new Date(`${normalized}T12:00:00+02:00`);
  if (Number.isNaN(date.getTime())) return normalized;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

export function validProposalId(value: unknown): string | null {
  const proposalId = String(value ?? "").trim();
  return uuidPattern.test(proposalId) ? proposalId.toLowerCase() : null;
}

export function proposalReviewUrl(
  proposalIdValue: unknown,
  decision: TelegramDecision,
) {
  const proposalId = validProposalId(proposalIdValue);
  if (!proposalId) return adminBaseUrl;

  const query = new URLSearchParams({ proposal: proposalId, decision });
  return `${adminBaseUrl}?${query.toString()}#proposal-${proposalId}`;
}

export function renderTelegramApproval(payload: TelegramApprovalPayload) {
  const meeting = payload.raceSnapshot?.meetings?.[0];
  const races = Array.isArray(meeting?.races) ? meeting.races : [];
  const runnerCount = races.reduce(
    (total, race) =>
      total + (Array.isArray(race.runners) ? race.runners.length : 0),
    0,
  );
  const venue = compact(
    payload.meetingVenue ?? meeting?.venue,
    "Unknown venue",
  );
  const meetingDate = formatMeetingDate(
    payload.meetingDate ?? meeting?.meetingDate,
  );
  const numericConfidence = Number(payload.confidenceScore ?? 0);
  const confidence = Number.isFinite(numericConfidence)
    ? numericConfidence.toFixed(0)
    : "0";
  const approvedSources = Math.max(
    0,
    Number(payload.approvedSourceCount ?? 0) || 0,
  );
  const distinctSources = Math.max(
    0,
    Number(payload.distinctSourceCount ?? 0) || 0,
  );
  const changeType = compact(payload.changeType, "race update").replaceAll(
    "_",
    " ",
  );
  const oneSourceCapApplied =
    payload.confidenceBreakdown?.oneSourceCapApplied === true;
  const lines = [
    "🏇 MRC RACE DATA REVIEW",
    `${venue.toUpperCase()} · ${meetingDate}`,
    `${changeType} · ${confidence}% confidence · ${approvedSources}/${distinctSources} approved sources`,
  ];

  if (races.length) {
    lines.push(`Attached PDF: ${races.length} races · ${runnerCount} runners`);
  }
  if (oneSourceCapApplied) {
    lines.push(
      "Manual review is required because only one approved source was available; confidence is capped for safety.",
    );
  }
  lines.push(
    races.length
      ? "Open the attached MRC review PDF to check every runner, jockey, trainer, draw and weight."
      : "Review the evidence before deciding. The buttons open the proposal without applying it automatically.",
  );

  return lines.join("\n").slice(0, 4096);
}

function approvalKeyboard(payload: TelegramApprovalPayload) {
  return {
    inline_keyboard: [[
      {
        text: "👍 Review & approve",
        url: proposalReviewUrl(payload.proposalId, "approve"),
      },
      {
        text: "👎 Review & reject",
        url: proposalReviewUrl(payload.proposalId, "reject"),
      },
    ]],
  };
}

export function buildTelegramApprovalRequests(
  payload: TelegramApprovalPayload,
): TelegramMessageRequest[] {
  return [{
    text: renderTelegramApproval(payload),
    link_preview_options: { is_disabled: true },
    reply_markup: approvalKeyboard(payload),
  }];
}

export function buildTelegramApprovalRequest(payload: TelegramApprovalPayload) {
  return {
    text: renderTelegramApproval(payload),
    link_preview_options: { is_disabled: true },
    reply_markup: approvalKeyboard(payload),
  };
}
