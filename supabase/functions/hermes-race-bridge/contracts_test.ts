import {
  constantTimeEqual,
  evidenceHash,
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
