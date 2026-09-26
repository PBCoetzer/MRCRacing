export type TelegramRaceChange = {
  kind: string;
  summary: string;
  raceNumber?: number;
  saddleNumber?: number;
  horseName?: string;
  field?: string;
  before?: string | number | null;
  after?: string | number | null;
};

export type CurrentRaceMeeting = {
  id: string;
  venue: string;
  meeting_date: string;
  status: string;
};

export type CurrentFixture = {
  id: string;
  race_number: number;
  title: string | null;
  starts_at: string | null;
  distance_m: number | null;
  race_class: string | null;
  status: string;
  result_summary: string | null;
};

export type CurrentRaceEntry = {
  fixture_id: string;
  saddle_number: number;
  horse_name: string;
  jockey_name: string | null;
  trainer_name: string | null;
  draw: number | null;
  carried_weight: number | string | null;
  status: string;
  result_position: number | null;
};

type JsonRecord = Record<string, unknown>;

const maximumRenderedChanges = 15;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function canonicalText(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function display(value: unknown) {
  if (value == null || value === "") return "not listed";
  return String(value);
}

function sameTimestamp(left: unknown, right: unknown) {
  const leftTime = Date.parse(text(left));
  const rightTime = Date.parse(text(right));
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? leftTime === rightTime
    : text(left) === text(right);
}

function hasOwn(value: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function changeLine(
  raceNumber: number,
  saddleNumber: number | null,
  horseName: string | null,
  field: string,
  before: string | number | null,
  after: string | number | null,
) {
  const runner = saddleNumber
    ? ` · #${saddleNumber}${horseName ? ` ${horseName}` : ""}`
    : "";
  return `Race ${raceNumber}${runner} · ${field}: ${display(before)} → ${
    display(after)
  }`;
}

export function summarizeProposalChanges(
  snapshot: unknown,
  currentMeeting: CurrentRaceMeeting | null,
  currentFixtures: CurrentFixture[],
  currentEntries: CurrentRaceEntry[],
) {
  const snapshotRecord = record(snapshot);
  const meetings = Array.isArray(snapshotRecord?.meetings)
    ? snapshotRecord.meetings
    : [];
  const proposedMeeting = record(meetings[0]);
  if (!proposedMeeting) {
    return { changes: [] as TelegramRaceChange[], changeCount: 0, omitted: 0 };
  }

  const proposedRaces = Array.isArray(proposedMeeting.races)
    ? proposedMeeting.races.map(record).filter((race): race is JsonRecord =>
      Boolean(race)
    )
    : [];
  const changes: TelegramRaceChange[] = [];

  if (!currentMeeting) {
    const runnerCount = proposedRaces.reduce(
      (total, race) =>
        total + (Array.isArray(race.runners) ? race.runners.length : 0),
      0,
    );
    changes.push({
      kind: "meeting_added",
      summary: `New ${
        text(proposedMeeting.venue) || "race"
      } meeting with ${proposedRaces.length} race(s) and ${runnerCount} runner(s).`,
    });
    return { changes, changeCount: 1, omitted: 0 };
  }

  const fixturesByRace = new Map(
    currentFixtures.map((fixture) => [fixture.race_number, fixture]),
  );
  const entriesByFixtureAndSaddle = new Map(
    currentEntries.map((entry) => [
      `${entry.fixture_id}:${entry.saddle_number}`,
      entry,
    ]),
  );

  for (const race of proposedRaces) {
    const raceNumber = numberValue(race.raceNumber);
    if (!raceNumber || !Number.isInteger(raceNumber)) continue;
    const currentRace = fixturesByRace.get(raceNumber);
    const proposedRunners = Array.isArray(race.runners)
      ? race.runners.map(record).filter((runner): runner is JsonRecord =>
        Boolean(runner)
      )
      : [];

    if (!currentRace) {
      changes.push({
        kind: "race_added",
        raceNumber,
        summary:
          `Race ${raceNumber} added with ${proposedRunners.length} runner(s).`,
      });
      continue;
    }

    const raceComparisons: Array<{
      field: string;
      before: unknown;
      after: unknown;
      equal: boolean;
      present: boolean;
    }> = [
      {
        field: "start time",
        before: currentRace.starts_at,
        after: race.startsAt,
        equal: sameTimestamp(currentRace.starts_at, race.startsAt),
        present: hasOwn(race, "startsAt"),
      },
      {
        field: "status",
        before: currentRace.status,
        after: text(race.status).toLowerCase(),
        equal: canonicalText(currentRace.status) === canonicalText(race.status),
        present: hasOwn(race, "status"),
      },
      {
        field: "title",
        before: currentRace.title,
        after: text(race.title),
        equal: canonicalText(currentRace.title) === canonicalText(race.title),
        present: hasOwn(race, "title"),
      },
      {
        field: "distance",
        before: currentRace.distance_m,
        after: numberValue(race.distanceMetres),
        equal: currentRace.distance_m === numberValue(race.distanceMetres),
        present: hasOwn(race, "distanceMetres"),
      },
      {
        field: "class",
        before: currentRace.race_class,
        after: text(race.raceClass),
        equal: canonicalText(currentRace.race_class) ===
          canonicalText(race.raceClass),
        present: hasOwn(race, "raceClass"),
      },
      {
        field: "result",
        before: currentRace.result_summary,
        after: text(race.resultSummary),
        equal: canonicalText(currentRace.result_summary) ===
          canonicalText(race.resultSummary),
        present: hasOwn(race, "resultSummary"),
      },
    ];
    for (const comparison of raceComparisons) {
      if (!comparison.present || comparison.equal) continue;
      changes.push({
        kind: "race_changed",
        raceNumber,
        field: comparison.field,
        before: comparison.before == null ? null : String(comparison.before),
        after: comparison.after == null ? null : String(comparison.after),
        summary: changeLine(
          raceNumber,
          null,
          null,
          comparison.field,
          comparison.before == null ? null : String(comparison.before),
          comparison.after == null ? null : String(comparison.after),
        ),
      });
    }

    for (const runner of proposedRunners) {
      const saddleNumber = numberValue(runner.saddleNumber);
      if (!saddleNumber || !Number.isInteger(saddleNumber)) continue;
      const horseName = text(runner.horseName) || `Runner ${saddleNumber}`;
      const currentRunner = entriesByFixtureAndSaddle.get(
        `${currentRace.id}:${saddleNumber}`,
      );
      if (!currentRunner) {
        changes.push({
          kind: "runner_added",
          raceNumber,
          saddleNumber,
          horseName,
          summary: `Race ${raceNumber} · #${saddleNumber} ${horseName} added.`,
        });
        continue;
      }

      const runnerComparisons: Array<{
        field: string;
        before: string | number | null;
        after: string | number | null;
        equal: boolean;
        present: boolean;
      }> = [
        {
          field: "status",
          before: currentRunner.status,
          after: text(runner.status).toLowerCase(),
          equal: canonicalText(currentRunner.status) ===
            canonicalText(runner.status),
          present: hasOwn(runner, "status"),
        },
        {
          field: "jockey",
          before: currentRunner.jockey_name,
          after: text(runner.jockeyName) || null,
          equal: canonicalText(currentRunner.jockey_name) ===
            canonicalText(runner.jockeyName),
          present: hasOwn(runner, "jockeyName"),
        },
        {
          field: "horse",
          before: currentRunner.horse_name,
          after: horseName,
          equal: canonicalText(currentRunner.horse_name) ===
            canonicalText(horseName),
          present: hasOwn(runner, "horseName"),
        },
        {
          field: "trainer",
          before: currentRunner.trainer_name,
          after: text(runner.trainerName) || null,
          equal: canonicalText(currentRunner.trainer_name) ===
            canonicalText(runner.trainerName),
          present: hasOwn(runner, "trainerName"),
        },
        {
          field: "draw",
          before: currentRunner.draw,
          after: numberValue(runner.draw),
          equal: currentRunner.draw === numberValue(runner.draw),
          present: hasOwn(runner, "draw"),
        },
        {
          field: "weight",
          before: numberValue(currentRunner.carried_weight),
          after: numberValue(runner.carriedWeight),
          equal: numberValue(currentRunner.carried_weight) ===
            numberValue(runner.carriedWeight),
          present: hasOwn(runner, "carriedWeight"),
        },
        {
          field: "result position",
          before: currentRunner.result_position,
          after: numberValue(runner.resultPosition),
          equal: currentRunner.result_position ===
            numberValue(runner.resultPosition),
          present: hasOwn(runner, "resultPosition"),
        },
      ];

      for (const comparison of runnerComparisons) {
        if (!comparison.present || comparison.equal) continue;
        changes.push({
          kind: "runner_changed",
          raceNumber,
          saddleNumber,
          horseName,
          field: comparison.field,
          before: comparison.before,
          after: comparison.after,
          summary: changeLine(
            raceNumber,
            saddleNumber,
            horseName,
            comparison.field,
            comparison.before,
            comparison.after,
          ),
        });
      }
    }
  }

  return {
    changes: changes.slice(0, maximumRenderedChanges),
    changeCount: changes.length,
    omitted: Math.max(0, changes.length - maximumRenderedChanges),
  };
}
