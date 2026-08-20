export type TipCardStatus = "draft" | "coming_soon" | "published" | "settled" | "void";

export type RaceMeeting = {
  id: string;
  venue: string;
  country_code: string;
  meeting_date: string;
  first_race_at: string;
  last_race_at: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  is_test: boolean;
  source_name: string;
  source_url: string | null;
};

export type RaceFixture = {
  id: string;
  meeting_id: string;
  race_number: number;
  title: string;
  venue: string | null;
  starts_at: string;
  selection_lock_at: string;
  distance_m: number | null;
  race_class: string | null;
  status: string;
  result_summary: string | null;
};

export type RaceEntry = {
  id: string;
  fixture_id: string;
  saddle_number: number;
  horse_name: string;
  jockey_name: string | null;
  trainer_name: string | null;
  draw: number | null;
  status: "active" | "scratched" | "withdrawn";
  result_position: number | null;
};

export type TipCardChangeAlert = {
  id: string;
  status: "pending" | "acknowledged" | "resolved" | "locked";
  isAfterLock: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolvedRevision: number | null;
  fixtureId: string | null;
  entryId: string | null;
  summary: string;
  changedFields: string[];
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  raceNumber: number | null;
  horseName: string | null;
  changeCreatedAt: string;
};

export type MeetingBetOption = {
  id: string;
  meeting_id: string;
  bet_type: "pa" | "pick6" | "bipot" | "jackpot" | "other";
  display_name: string;
  cutoff_at: string;
  leg_count: number;
  sort_order: number;
};

export type MeetingBetLeg = {
  bet_option_id: string;
  leg_number: number;
  fixture_id: string;
};

export type TipCard = {
  id: string;
  tipster_id: string;
  meeting_id: string;
  title: string;
  summary: string | null;
  coin_price: number;
  status: TipCardStatus;
  revision: number;
  listed_at: string | null;
  published_at: string | null;
  voided_at: string | null;
  updated_at: string;
};

export type RaceTipSelection = {
  id: string;
  tip_card_id: string;
  fixture_id: string;
  winner_entry_id: string | null;
  place_entry_id: string | null;
  comments: string | null;
  selection_status: "tipped" | "skipped";
};

export type TipCardMultiple = {
  id: string;
  tip_card_id: string;
  bet_option_id: string;
  custom_name: string | null;
  tip_text: string | null;
  comments: string | null;
};

export type TipCardMultipleSelection = {
  multiple_id: string;
  leg_number: number;
  fixture_id: string;
  entry_id: string;
};

export type TipsterProfile = {
  id: string;
  slug: string;
  user_id: string;
  display_name: string;
  biography: string | null;
  photo_path?: string | null;
  is_verified: boolean;
  ranking?: number | null;
  commission_rate_override: number | null;
};

export type TipsterPerformanceStats = {
  tipster_id: string;
  published_winner_tips: number;
  settled_winner_tips: number;
  winner_hits: number;
  winner_strike_rate: number | null;
  roi_percent: number | null;
  updated_at: string;
};

export type ClientTipsterFavourite = {
  user_id: string;
  tipster_id: string;
  created_at: string;
};

export type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  reward_credits: number;
  price_cents: number;
  promotion_label: string | null;
  is_active: boolean;
  sort_order: number;
};

export type TipsterPackage = {
  id: string;
  tipster_id: string;
  name: string;
  duration_months: 1 | 3 | 6 | 12;
  coin_price: number;
  is_active: boolean;
  created_at: string;
};

export type RaceSelectionDraft = {
  fixtureId: string;
  selectionStatus: "tipped" | "skipped";
  winnerEntryId: string;
  placeEntryId: string;
  comments: string;
};

export type MultipleLegDraft = {
  legNumber: number;
  fixtureId: string;
  entryIds: string[];
};

export type MultipleDraft = {
  betOptionId: string;
  customName: string;
  tipText: string;
  comments: string;
  legs: MultipleLegDraft[];
};
