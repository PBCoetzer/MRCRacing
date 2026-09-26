import type { TelegramRaceChange } from "./proposal-changes.ts";

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
  reviewKind?: "proposal" | "proposal_changes" | "secondary_consensus";
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
  differenceSummary?: string;
  sourceDomains?: string[];
  sourceUrls?: string[];
  adminUrl?: string;
  changes?: TelegramRaceChange[];
  changeCount?: number;
  omittedChangeCount?: number;
  conflictSummary?: string;
  feedbackEnabled?: boolean;
};

export type TelegramDecision = "approve" | "reject";

export type TelegramMessageRequest = {
  text: string;
  link_preview_options: { is_disabled: true };
  reply_markup?:
    | { inline_keyboard: Array<Array<{ text: string; url: string }>> }
    | {
      force_reply: true;
      input_field_placeholder?: string;
      selective?: boolean;
    };
};

const adminBaseUrl = "https://www.mrcracing.co.za/admin/racing/";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function compact(value: unknown, fallback: string, maximumLength = 120) {
  const normalized = [...String(value ?? "")].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").trim();
  return (normalized || fallback).slice(0, maximumLength);
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
  if (payload.reviewKind === "secondary_consensus") {
    const sourceDomains = Array.isArray(payload.sourceDomains)
      ? [
        ...new Set(
          payload.sourceDomains.map((value) => compact(value, "", 120)).filter(
            Boolean,
          ),
        ),
      ]
      : [];
    const difference = compact(
      payload.differenceSummary,
      "Secondary race sources disagree with the current Formgrids record.",
      1200,
    );
    return [
      "⚠️ MRC RACE SOURCE DIFFERENCE",
      `${venue.toUpperCase()} · ${meetingDate}`,
      difference,
      `Primary feed: Formgrids · Matching comparison sources: ${sourceDomains.length}`,
      sourceDomains.length ? `Sources: ${sourceDomains.join(", ")}` : "",
      "No race data was changed automatically. Review the difference before correcting the Formgrids-backed record.",
      "Reply with a correction such as: Race 1 Horse 10 scratched.",
      `Review: ${compact(payload.adminUrl, adminBaseUrl, 2048)}`,
    ].filter(Boolean).join("\n").slice(0, 4096);
  }
  if (payload.reviewKind === "proposal_changes") {
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const changeCount = Math.max(
      changes.length,
      Number(payload.changeCount ?? changes.length) || 0,
    );
    const omittedCount = Math.max(
      0,
      Number(payload.omittedChangeCount ?? changeCount - changes.length) || 0,
    );
    const conflictSummary = compact(payload.conflictSummary, "", 800);
    const changeHeading = changeCount === 0
      ? "Source conflict requires review:"
      : changeCount === 1
      ? "1 factual change detected:"
      : `${changeCount} factual changes detected:`;
    const lines = [
      "⚠️ MRC RACE CHANGE REVIEW",
      `${venue.toUpperCase()} · ${meetingDate}`,
      changeHeading,
      ...changes.map((change) =>
        `• ${compact(change.summary, "Race data changed.", 280)}`
      ),
      omittedCount > 0
        ? `• Plus ${omittedCount} additional change(s) in the admin review.`
        : "",
      conflictSummary ? `Source warning: ${conflictSummary}` : "",
      "Reply with a correction such as “Race 1 Horse 10 scratched” or “Race 2 jockey changed to Craig Zackey”.",
      "Replies are saved for review and never change race data automatically.",
      `Review: ${proposalReviewUrl(payload.proposalId, "approve")}`,
    ];
    return lines.filter(Boolean).join("\n").slice(0, 4096);
  }
  const oneSourceCapApplied =
    payload.confidenceBreakdown?.oneSourceCapApplied === true;
  const lines = [
    "🏇 MRC RACE DATA REVIEW",
    `${venue.toUpperCase()} · ${meetingDate}`,
    `${changeType} · ${confidence}% confidence · ${approvedSources}/${distinctSources} approved sources`,
  ];

  if (races.length) {
    lines.push(`${races.length} races · ${runnerCount} runners`);
  }
  if (oneSourceCapApplied) {
    lines.push(
      "Manual review is required because only one approved source was available; confidence is capped for safety.",
    );
  }
  lines.push(
    "Review the evidence before deciding. The buttons open the proposal without applying it automatically.",
  );

  return lines.join("\n").slice(0, 4096);
}

function approvalKeyboard(payload: TelegramApprovalPayload) {
  if (
    payload.reviewKind === "secondary_consensus" ||
    payload.reviewKind === "proposal_changes" ||
    payload.feedbackEnabled === true
  ) {
    return {
      force_reply: true as const,
      input_field_placeholder: "Reply with the race correction to review",
    };
  }
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

export function buildTelegramApprovalRequest(
  payload: TelegramApprovalPayload,
): TelegramMessageRequest {
  return {
    text: renderTelegramApproval(payload),
    link_preview_options: { is_disabled: true },
    reply_markup: approvalKeyboard(payload),
  };
}
