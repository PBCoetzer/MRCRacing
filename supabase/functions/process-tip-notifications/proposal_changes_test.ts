import { summarizeProposalChanges } from "./proposal-changes.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const snapshot = {
  meetings: [{
    venue: "Scottsville",
    meetingDate: "2026-09-21",
    races: [{
      raceNumber: 1,
      title: "Maiden Plate",
      startsAt: "2026-09-21T13:00:00+02:00",
      distanceMetres: 1200,
      raceClass: "Maiden",
      status: "scheduled",
      resultSummary: null,
      runners: [{
        saddleNumber: 10,
        horseName: "CLEVER KID",
        jockeyName: "New Jockey",
        trainerName: "Trainer",
        draw: 10,
        carriedWeight: 60,
        status: "scratched",
        resultPosition: null,
      }],
    }],
  }],
};

const meeting = {
  id: "meeting-1",
  venue: "Scottsville",
  meeting_date: "2026-09-21",
  status: "scheduled",
};
const fixtures = [{
  id: "fixture-1",
  race_number: 1,
  title: "Maiden Plate",
  starts_at: "2026-09-21T13:00:00+02:00",
  distance_m: 1200,
  race_class: "Maiden",
  status: "scheduled",
  result_summary: null,
}];
const entries = [{
  fixture_id: "fixture-1",
  saddle_number: 10,
  horse_name: "CLEVER KID",
  jockey_name: "Old Jockey",
  trainer_name: "Trainer",
  draw: 10,
  carried_weight: 60,
  status: "active",
  result_position: null,
}];

Deno.test("summarizes only factual runner changes", () => {
  const result = summarizeProposalChanges(snapshot, meeting, fixtures, entries);
  assert(result.changeCount === 2, "Expected status and jockey changes only.");
  assert(
    result.changes[0].summary ===
      "Race 1 · #10 CLEVER KID · status: active → scratched",
    "Scratching summary is not concise or deterministic.",
  );
  assert(
    result.changes[1].summary ===
      "Race 1 · #10 CLEVER KID · jockey: Old Jockey → New Jockey",
    "Jockey summary is not concise or deterministic.",
  );
});

Deno.test("suppresses unchanged race snapshots", () => {
  const unchanged = structuredClone(snapshot);
  unchanged.meetings[0].races[0].runners[0].status = "active";
  unchanged.meetings[0].races[0].runners[0].jockeyName = "Old Jockey";
  const result = summarizeProposalChanges(
    unchanged,
    meeting,
    fixtures,
    entries,
  );
  assert(
    result.changeCount === 0,
    "Unchanged facts should not produce Telegram noise.",
  );
});

Deno.test("summarizes a new meeting as one change", () => {
  const result = summarizeProposalChanges(snapshot, null, [], []);
  assert(result.changeCount === 1, "A new meeting should produce one summary.");
  assert(
    result.changes[0].summary.includes("1 race(s) and 1 runner(s)"),
    "New meeting counts were not summarized.",
  );
});
