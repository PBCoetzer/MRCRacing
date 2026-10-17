import type { RaceEntry } from "@/lib/racing/types";

export type RaceSelectionSnapshot = {
  entryId?: unknown;
  saddleNumber?: unknown;
  horseName?: unknown;
  jockeyName?: unknown;
  capturedAt?: unknown;
} | null;

function snapshotLabel(snapshot: RaceSelectionSnapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const saddleNumber = Number(snapshot.saddleNumber);
  const horseName = typeof snapshot.horseName === "string"
    ? snapshot.horseName.trim()
    : "";

  if (!Number.isInteger(saddleNumber) || saddleNumber <= 0 || !horseName) {
    return null;
  }

  return `${saddleNumber}. ${horseName}`;
}

export function raceSelectionLabel(
  entryId: string | null,
  entriesById: ReadonlyMap<string, RaceEntry>,
  snapshot: RaceSelectionSnapshot,
) {
  if (!entryId) {
    return "No selection";
  }

  const entry = entriesById.get(entryId);
  if (entry) {
    return `${entry.saddle_number}. ${entry.horse_name}`;
  }

  return snapshotLabel(snapshot) ?? "Selection temporarily unavailable";
}
