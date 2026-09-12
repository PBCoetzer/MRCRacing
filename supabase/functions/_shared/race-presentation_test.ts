import { mrcRaceDisplayTitle } from "./race-presentation.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
}

Deno.test("removes promotional wording and website references", () => {
  assertEquals(
    mrcRaceDisplayTitle(
      "JOIN THE PASSION. www.racecoast.co.za CLASS 5 (F and M) (For Fillies and Mares. Benchmark at 60.0kg = 70)",
      3,
      "Class 5",
    ),
    "Class 5 (F and M) (For Fillies and Mares. Benchmark at 60.0kg = 70)",
  );
});

Deno.test("expands abbreviated factual classes", () => {
  assertEquals(
    mrcRaceDisplayTitle(
      "WWW.TAB.CO.ZA FM 80 HANDICAP (F and M) (For Fillies and Mares)",
      3,
      "FM 80 HCP",
    ),
    "FM 80 Handicap (F and M) (For Fillies and Mares)",
  );
});

Deno.test("retains factual race qualifiers", () => {
  assertEquals(
    mrcRaceDisplayTitle(
      "EQUUS CHAMPION PRINT MEDIA: CHARL PRETORIUS WORK RIDERS MAIDEN PLATE (F and M) (For Maiden Fillies and Mares)",
      1,
      "Mdn Plate",
    ),
    "Work Riders Maiden Plate (F and M) (For Maiden Fillies and Mares)",
  );
});

Deno.test("falls back to the race number when no factual class is available", () => {
  assertEquals(
    mrcRaceDisplayTitle("VISIT EXAMPLE.COM TODAY", 8, null),
    "Race 8",
  );
});
