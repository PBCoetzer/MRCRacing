import { inferRaceStatus } from "./status.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
}

Deno.test("result evidence completes a race even when extraction status is stale", () => {
  assertEquals(
    inferRaceStatus("in_progress", "Horse One won.", []),
    "completed",
  );
  assertEquals(
    inferRaceStatus("in_progress", null, [{ resultPosition: 1 }]),
    "completed",
  );
});

Deno.test("terminal source statuses remain unchanged", () => {
  assertEquals(
    inferRaceStatus("cancelled", "Unexpected summary", []),
    "cancelled",
  );
  assertEquals(
    inferRaceStatus("abandoned", null, [{ resultPosition: 1 }]),
    "abandoned",
  );
});

Deno.test("races without result evidence retain their current status", () => {
  assertEquals(
    inferRaceStatus("in_progress", null, [{ resultPosition: null }]),
    "in_progress",
  );
});
