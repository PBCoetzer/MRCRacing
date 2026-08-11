export type ProviderRunner = {
  externalId: string;
  saddleNumber: number;
  horseName: string;
  jockeyName?: string;
  trainerName?: string;
  draw?: number;
  carriedWeight?: number;
  status: "active" | "scratched" | "withdrawn";
  resultPosition?: number;
  providerPayload: Record<string, unknown>;
};

export type ProviderRace = {
  externalId: string;
  raceNumber: number;
  title: string;
  venue: string;
  startsAt: string;
  distanceMetres?: number;
  raceClass?: string;
  resultSummary?: string;
  runners: ProviderRunner[];
  providerPayload: Record<string, unknown>;
};

export type ProviderMeeting = {
  externalId: string;
  venue: string;
  countryCode: string;
  meetingDate: string;
  firstRaceAt: string;
  lastRaceAt?: string;
  races: ProviderRace[];
  providerPayload: Record<string, unknown>;
};

export interface RacingFeedAdapter {
  readonly providerName: string;
  fetchMeetings(fromDate: string, toDate: string): Promise<ProviderMeeting[]>;
  fetchMeeting(externalId: string): Promise<ProviderMeeting>;
}

export function assertValidProviderMeeting(meeting: ProviderMeeting) {
  if (!meeting.externalId || !meeting.venue || meeting.races.length === 0) {
    throw new Error("The racing provider returned an incomplete meeting.");
  }

  const raceNumbers = new Set(meeting.races.map((race) => race.raceNumber));

  if (raceNumbers.size !== meeting.races.length) {
    throw new Error("The racing provider returned duplicate race numbers.");
  }
}
