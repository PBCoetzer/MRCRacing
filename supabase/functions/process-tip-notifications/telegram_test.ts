import {
  buildTelegramApprovalRequest,
  buildTelegramApprovalRequests,
  proposalReviewUrl,
  renderTelegramApproval,
  validProposalId,
} from "./telegram.ts";

function assert(condition: unknown, message: string) {
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

Deno.test("summarizes the PDF attachment instead of sending long race messages", () => {
  const requests = buildTelegramApprovalRequests({
    proposalId,
    meetingVenue: "Fairview",
    meetingDate: "2026-09-11",
    changeType: "new_meeting",
    confidenceScore: 70,
    approvedSourceCount: 1,
    distinctSourceCount: 1,
    confidenceBreakdown: { oneSourceCapApplied: true },
    raceSnapshot: {
      meetings: [{
        venue: "Fairview",
        meetingDate: "2026-09-11",
        races: Array.from({ length: 8 }, (_, raceIndex) => ({
          raceNumber: raceIndex + 1,
          startsAt: `2026-09-11T${
            String(10 + raceIndex).padStart(2, "0")
          }:15:00Z`,
          title: "Open Maiden",
          distanceMetres: 1200 + raceIndex * 100,
          runners: Array.from({ length: 12 }, (_, runnerIndex) => ({
            saddleNumber: runnerIndex + 1,
            horseName: `MRC RUNNER ${raceIndex + 1}-${runnerIndex + 1}`,
            jockeyName: `Jockey ${runnerIndex + 1}`,
            trainerName: `Trainer ${runnerIndex + 1}`,
            draw: runnerIndex + 1,
            carriedWeight: 55.5,
            status: "active",
          })),
        })),
      }],
    },
  });

  assert(
    requests.length === 1,
    "the PDF workflow should send one concise message",
  );
  assert(
    requests[0].text.includes("Attached PDF: 8 races · 96 runners"),
    "PDF summary is missing",
  );
  assert(
    !requests[0].text.includes("🏁 RACE 1"),
    "runner layout should only appear in the PDF",
  );
  assert(
    requests[0].text.includes("confidence is capped for safety"),
    "single-source reason is missing",
  );
  assert(Boolean(requests[0].reply_markup), "review buttons are missing");
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
