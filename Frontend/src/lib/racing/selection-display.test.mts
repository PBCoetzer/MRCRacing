import assert from "node:assert/strict";
import test from "node:test";
import type { RaceEntry } from "./types.ts";
import { raceSelectionLabel } from "./selection-display.ts";

const entry: RaceEntry = {
  id: "entry-9",
  fixture_id: "fixture-3",
  saddle_number: 9,
  horse_name: "VENTURA BOULEVARD",
  jockey_name: "Kabelo Matsunya",
  trainer_name: null,
  draw: null,
  status: "active",
  result_position: null,
};

test("uses the current race entry when it is available", () => {
  assert.equal(
    raceSelectionLabel(entry.id, new Map([[entry.id, entry]]), {
      saddleNumber: 8,
      horseName: "OLD NAME",
    }),
    "9. VENTURA BOULEVARD",
  );
});

test("falls back to the captured selection when the entry lookup is missing", () => {
  assert.equal(
    raceSelectionLabel(entry.id, new Map(), {
      entryId: entry.id,
      saddleNumber: 9,
      horseName: "VENTURA BOULEVARD",
    }),
    "9. VENTURA BOULEVARD",
  );
});

test("distinguishes a missing lookup from a genuine no-selection value", () => {
  assert.equal(raceSelectionLabel(null, new Map(), null), "No selection");
  assert.equal(
    raceSelectionLabel("missing-entry", new Map(), null),
    "Selection temporarily unavailable",
  );
});
