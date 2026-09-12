export type RaceStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "abandoned"
  | "delayed";

type ResultRunner = {
  resultPosition: number | null;
};

export function inferRaceStatus(
  status: RaceStatus,
  resultSummary: string | null,
  runners: ResultRunner[],
): RaceStatus {
  if (
    status === "completed" || status === "cancelled" || status === "abandoned"
  ) {
    return status;
  }

  const hasResultEvidence = Boolean(resultSummary?.trim()) ||
    runners.some((runner) => runner.resultPosition === 1);
  return hasResultEvidence ? "completed" : status;
}
