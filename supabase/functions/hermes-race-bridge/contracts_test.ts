import {
  constantTimeEqual,
  evidenceHash,
  proposalSnapshotForResult,
  sourceMatchesPermittedDomain,
  stableStringify,
  validateJobRequest,
  validateResult,
} from "./contracts.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("stable JSON and evidence hashing ignore object key order", async () => {
  const left = [{
    domain: "example.org",
    url: "https://example.org/race",
    retrieved_at: "2026-08-14T00:00:00Z",
  }];
  const right = [{
    retrieved_at: "2026-08-14T00:00:00Z",
    url: "https://example.org/race",
    domain: "example.org",
  }];
  assert(
    stableStringify(left) === stableStringify(right),
    "Stable JSON differs.",
  );
  assert(
    await evidenceHash(left) === await evidenceHash(right),
    "Evidence hashes differ.",
  );
});

Deno.test("job validation normalizes a valid task", () => {
  const job = validateJobRequest({
    correlation_id: "mrc:2026-08-14:greyville",
    task_type: "meeting_schedule",
    venue: "Greyville",
    meeting_date: "2026-08-14",
    required_fields: ["races", "runners"],
    permitted_sources: ["https://www.tabgold.co.za"],
  });
  assert(job.schema_version === 1, "Schema version missing.");
  assert(
    job.task_payload && Object.keys(job.task_payload).length === 0,
    "Default task payload missing.",
  );
});

Deno.test("job validation rejects unsupported task types", () => {
  let failed = false;
  try {
    validateJobRequest({
      correlation_id: "bad",
      task_type: "delete_everything",
      permitted_sources: ["example.org"],
    });
  } catch {
    failed = true;
  }
  assert(failed, "Unsupported task type was accepted.");
});

Deno.test("job validation requires an explicit source allowlist", () => {
  let failed = false;
  try {
    validateJobRequest({
      correlation_id: "no-sources",
      task_type: "weekly_calendar",
      permitted_sources: [],
    });
  } catch {
    failed = true;
  }
  assert(failed, "An empty source allowlist was accepted.");
});

Deno.test("result validation verifies the evidence hash", async () => {
  const sources = [{
    domain: "example.org",
    url: "https://example.org/race",
    retrieved_at: "2026-08-14T00:00:00Z",
  }];
  const result = await validateResult({
    job_id: "123e4567-e89b-42d3-a456-426614174000",
    correlation_id: "mrc:2026-08-14:greyville",
    schema_version: 1,
    status: "succeeded",
    normalized_data: { meetings: [{ venue: "Greyville", races: [] }] },
    sources,
    confidence: 0.9,
    warnings: [],
    conflicts: [],
    evidence_hash: await evidenceHash(sources),
    started_at: "2026-08-14T00:00:00Z",
    completed_at: "2026-08-14T00:01:00Z",
  });
  assert(result.confidence === 0.9, "Confidence was changed.");
});

Deno.test("result validation binds the declared domain to the URL hostname", async () => {
  const sources = [{
    domain: "4racing.com",
    url: "https://attacker.example/mislabeled",
    retrieved_at: "2026-08-14T00:00:00Z",
  }];
  let failed = false;
  try {
    await validateResult({
      job_id: "123e4567-e89b-42d3-a456-426614174000",
      correlation_id: "domain-binding",
      schema_version: 1,
      status: "succeeded",
      normalized_data: {},
      sources,
      confidence: 0.9,
      warnings: [],
      conflicts: [],
      evidence_hash: await evidenceHash(sources),
      started_at: "2026-08-14T00:00:00Z",
      completed_at: "2026-08-14T00:01:00Z",
    });
  } catch {
    failed = true;
  }
  assert(failed, "A mislabeled source URL was accepted.");
  assert(
    sourceMatchesPermittedDomain("www.4racing.com", ["4racing.com"]),
    "A permitted www subdomain was rejected.",
  );
  assert(
    !sourceMatchesPermittedDomain("attacker.example", ["4racing.com"]),
    "An off-domain hostname was accepted.",
  );
});

Deno.test("constant-time comparison handles equal and different values", () => {
  assert(
    constantTimeEqual("same-value", "same-value"),
    "Equal values were rejected.",
  );
  assert(
    !constantTimeEqual("same-value", "other-value"),
    "Different values were accepted.",
  );
  assert(
    !constantTimeEqual("short", "longer"),
    "Different lengths were accepted.",
  );
});

Deno.test("a local result refresh becomes an existing-workflow meeting snapshot", () => {
  const completedAt = "2026-08-17T04:00:00Z";
  const snapshot = proposalSnapshotForResult({
    task_type: "result_refresh",
    race_number: 1,
    task_payload: {
      currentMeeting: {
        externalId: "za-vaal-2026-08-13",
        venue: "Vaal",
        countryCode: "ZA",
        meetingDate: "2026-08-13",
        status: "scheduled",
        races: [{
          externalId: "za-vaal-2026-08-13-r1",
          raceNumber: 1,
          title: "Maiden Plate",
          startsAt: "2026-08-13T09:15:00Z",
          distanceMetres: 1000,
          raceClass: null,
          status: "scheduled",
          resultSummary: null,
          sourceUpdatedAt: "2026-08-13T08:00:00Z",
          runners: [{
            externalId: "za-vaal-2026-08-13-r1-s5",
            saddleNumber: 5,
            horseName: "Caladrius",
            jockeyName: "P Mongqawa",
            trainerName: "T Peter",
            draw: 6,
            carriedWeight: 57,
            status: "active",
            resultPosition: null,
          }],
        }, {
          externalId: "za-vaal-2026-08-13-r2",
          raceNumber: 2,
          status: "scheduled",
          runners: [],
        }],
      },
    },
  }, {
    job_id: "123e4567-e89b-42d3-a456-426614174000",
    correlation_id: "result-conversion",
    schema_version: 1,
    status: "succeeded",
    normalized_data: { races: [{
      race: 1,
      raceName: "Workriders Maiden Plate",
      distanceMeters: 1000,
      winTime: 59.64,
      runners: [{
        horseName: "Caladrius",
        horseNumber: 5,
        jockeyName: "P Mongqawa",
        trainerName: "T Peter",
        draw: 6,
        carriedWeight: 57,
        status: "Finished",
        resultPosition: 1,
      }],
      nonRunners: [{
        horseName: "Pennys Choice",
        horseNumber: 3,
        jockeyName: "C Mabaya",
        trainerName: "James Crawford",
        draw: 5,
        carriedWeight: 60,
        status: "Non-runner",
        resultPosition: null,
      }],
    }] },
    sources: [],
    confidence: 1,
    warnings: [],
    conflicts: [],
    evidence_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    started_at: "2026-08-17T03:58:00Z",
    completed_at: completedAt,
  });
  assert(snapshot !== null, "Result snapshot was not created.");
  const meetings = snapshot?.meetings as Record<string, unknown>[];
  const races = meetings[0].races as Record<string, unknown>[];
  const runners = races[0].runners as Record<string, unknown>[];
  assert(races[0].status === "completed", "Race was not completed.");
  assert(meetings[0].status === "in_progress", "Meeting status was not updated.");
  assert(runners[0].externalId === "za-vaal-2026-08-13-r1-s5", "Existing runner identity was lost.");
  assert(runners[1].status === "withdrawn", "Non-runner was not normalized.");
  assert(races[0].resultSummary === "Caladrius won in 59.64s.", "Result summary is incorrect.");
});
