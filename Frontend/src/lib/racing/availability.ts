export const MEETING_CARD_CUTOFF_MINUTES = 30;

const MEETING_CARD_CUTOFF_MS = MEETING_CARD_CUTOFF_MINUTES * 60 * 1000;

type MeetingAvailability = {
  first_race_at: string;
  status: string;
};

export function meetingCardCutoffAt(firstRaceAt: string) {
  return new Date(new Date(firstRaceAt).getTime() - MEETING_CARD_CUTOFF_MS);
}

export function meetingCardSalesOpen(
  meeting: MeetingAvailability | null | undefined,
  now = Date.now(),
) {
  return Boolean(
    meeting &&
      meeting.status === "scheduled" &&
      meetingCardCutoffAt(meeting.first_race_at).getTime() > now,
  );
}

export function minimumUpcomingFirstRace(now = Date.now()) {
  return new Date(now + MEETING_CARD_CUTOFF_MS).toISOString();
}
