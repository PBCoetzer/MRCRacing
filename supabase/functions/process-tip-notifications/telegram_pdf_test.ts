import { generateRaceApprovalPdf } from "./telegram-pdf.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("generates a complete paginated MRC race approval PDF", async () => {
  const result = await generateRaceApprovalPdf({
    proposalId: "1888215d-4d90-4457-a7a0-94c91b9187d1",
    proposalVersion: 2,
    meetingVenue: "Fairview",
    meetingDate: "2026-09-11",
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
  }, { generatedAt: new Date("2026-09-08T06:00:00Z") });

  assert(
    result.fileName === "MRC-Fairview-2026-09-11-Race-Data-Approval.pdf",
    "filename is incorrect",
  );
  assert(result.bytes.length > 10_000, "PDF content is unexpectedly small");
  assert(
    new TextDecoder().decode(result.bytes.slice(0, 5)) === "%PDF-",
    "PDF signature is missing",
  );
  const pdfText = new TextDecoder().decode(result.bytes);
  const pageCount = pdfText.match(/\/Type \/Page\b/g)?.length ?? 0;
  assert(
    pageCount === 8,
    "each race should fit on one landscape page",
  );
  assert(
    result.pageCount === pageCount,
    "reported page count is incorrect",
  );
});
