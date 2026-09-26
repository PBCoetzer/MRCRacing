import {
  buildTelegramApprovalRequest,
  buildTelegramApprovalRequests,
  proposalReviewUrl,
  renderTelegramApproval,
  validProposalId,
} from "./telegram.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const proposalId = "1888215d-4d90-4457-a7a0-94c91b9187d1";

Deno.test("renders a compact approval message without a preview URL", () => {
  const text = renderTelegramApproval({
    meetingVenue: "Durbanville",
    meetingDate: "2026-09-06",
    changeType: "routine_change",
    confidenceScore: 85.25,
    approvedSourceCount: 2,
    distinctSourceCount: 2,
  });

  assert(text.includes("🏇 MRC RACE DATA REVIEW"), "missing compact title");
  assert(text.includes("85% confidence"), "missing confidence");
  assert(
    !text.includes("https://"),
    "message text must not trigger a website preview",
  );
  assert(text.length < 400, "approval message should remain compact");
});

Deno.test("renders only factual proposal changes without a race-card dump", () => {
  const requests = buildTelegramApprovalRequests({
    reviewKind: "proposal_changes",
    proposalId,
    meetingVenue: "Fairview",
    meetingDate: "2026-09-11",
    changeType: "routine_change",
    confidenceScore: 70,
    approvedSourceCount: 1,
    distinctSourceCount: 1,
    feedbackEnabled: true,
    changeCount: 2,
    changes: [
      {
        kind: "runner_changed",
        summary: "Race 1 · #10 CLEVER KID · status: active → scratched",
      },
      {
        kind: "runner_changed",
        summary: "Race 2 · #4 BLUE LAGOON · jockey: Old Jockey → Craig Zackey",
      },
    ],
  });

  assert(
    requests.length === 1,
    "one concise change message is required",
  );
  assert(
    requests[0].text.includes(
      "Race 1 · #10 CLEVER KID · status: active → scratched",
    ),
    "scratching change is missing",
  );
  assert(
    requests[0].text.includes(
      "Race 2 · #4 BLUE LAGOON · jockey: Old Jockey → Craig Zackey",
    ),
    "jockey change is missing",
  );
  assert(
    !requests[0].text.includes("96 runners") &&
      !requests[0].text.includes("Attached PDF"),
    "full-card output should not appear in Telegram",
  );
  assert(
    requests[0].reply_markup && "force_reply" in requests[0].reply_markup &&
      requests[0].reply_markup.force_reply === true,
    "change messages must open a Telegram reply prompt",
  );
});

Deno.test("builds safe approve and reject proposal deep links", () => {
  assert(
    proposalReviewUrl(proposalId, "approve") ===
      `https://www.mrcracing.co.za/admin/racing/?proposal=${proposalId}&decision=approve#proposal-${proposalId}`,
    "approve URL is incorrect",
  );
  assert(
    proposalReviewUrl(proposalId, "reject") ===
      `https://www.mrcracing.co.za/admin/racing/?proposal=${proposalId}&decision=reject#proposal-${proposalId}`,
    "reject URL is incorrect",
  );
});

Deno.test("rejects malformed proposal IDs and falls back to the admin page", () => {
  assert(
    validProposalId(proposalId) === proposalId,
    "valid UUID should be accepted",
  );
  assert(
    validProposalId("javascript:alert(1)") === null,
    "unsafe ID should be rejected",
  );
  assert(
    proposalReviewUrl("not-a-uuid", "approve") ===
      "https://www.mrcracing.co.za/admin/racing/",
    "invalid IDs should use the safe admin fallback",
  );
});

Deno.test("uses an inline keyboard and disables link previews", () => {
  const request = buildTelegramApprovalRequest({ proposalId });
  assert(
    request.reply_markup && "inline_keyboard" in request.reply_markup,
    "normal proposal review must keep its inline keyboard",
  );
  const keyboard = request.reply_markup.inline_keyboard;

  assert(
    request.link_preview_options.is_disabled,
    "link previews must be disabled",
  );
  assert(
    keyboard.length === 1 && keyboard[0].length === 2,
    "two review buttons are required",
  );
  assert(
    keyboard[0][0].text === "👍 Review & approve",
    "approve label is incorrect",
  );
  assert(
    keyboard[0][1].text === "👎 Review & reject",
    "reject label is incorrect",
  );
  assert(
    keyboard[0][0].url.includes("decision=approve"),
    "approve intent is missing",
  );
  assert(
    keyboard[0][1].url.includes("decision=reject"),
    "reject intent is missing",
  );
});

Deno.test("renders a secondary-source consensus alert without approval actions", () => {
  const request = buildTelegramApprovalRequest({
    reviewKind: "secondary_consensus",
    meetingVenue: "Scottsville",
    meetingDate: "2026-09-21",
    differenceSummary:
      "Race 3 · #7 KAZ FROM ALCATRAZ · status: Formgrids active → secondary scratched",
    sourceDomains: ["raceform.co.za", "tote.co.za"],
    adminUrl: "https://www.mrcracing.co.za/admin/racing/",
  });

  assert(
    request.text.includes("No race data was changed automatically"),
    "comparison alert must state that it did not update race data",
  );
  assert(
    request.text.includes("raceform.co.za, tote.co.za"),
    "comparison sources were not listed",
  );
  assert(
    request.reply_markup && "force_reply" in request.reply_markup &&
      request.reply_markup.force_reply === true,
    "comparison alerts must open a Telegram reply prompt",
  );
  assert(
    request.text.includes("Review: https://www.mrcracing.co.za/admin/racing/"),
    "comparison alert review link is missing",
  );
});

Deno.test("renders a conflict-only proposal without claiming factual changes", () => {
  const request = buildTelegramApprovalRequest({
    reviewKind: "proposal_changes",
    proposalId,
    meetingVenue: "Fairview",
    meetingDate: "2026-09-21",
    changeCount: 0,
    changes: [],
    conflictSummary: "Two sources disagree about Race 3.",
    feedbackEnabled: true,
  });

  assert(
    request.text.includes("Source conflict requires review:"),
    "zero-change conflicts need an accurate heading",
  );
  assert(
    !request.text.includes("0 factual changes detected"),
    "zero-change conflicts must not use a misleading change count",
  );
});
