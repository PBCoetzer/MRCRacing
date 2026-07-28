export type ProviderRunner = {
  externalId: string;
  saddleNumber: number;
  horseName: string;
  jockeyName?: string;
  trainerName?: string;
  draw?: number;
  carriedWeight?: number;
  odds?: string;
  scratched: boolean;
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

export type ProviderBetLeg = {
  legNumber: number;
  raceExternalId: string;
};

export type ProviderBetOption = {
  externalId: string;
  type: "pa" | "pick6" | "bipot" | "jackpot" | "other";
  displayName: string;
  cutoffAt: string;
  legs: ProviderBetLeg[];
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
  betOptions: ProviderBetOption[];
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

  for (const option of meeting.betOptions) {
    if (!option.cutoffAt || option.legs.some((leg) => !leg.raceExternalId)) {
      throw new Error(`The ${option.displayName} betting cutoff or leg mapping is invalid.`);
    }
  }
}
