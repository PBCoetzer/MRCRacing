import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  extractStructured,
  groundedSearch,
  ollamaWebFetchOnly,
  ollamaWebSearchOnly,
  parseKnownRaceDetailEvidence,
  type GroundedSearchResult,
  type GroundingEvidence,
  type ProviderName,
  type SearchContext,
  type WorkerConfiguration,
} from "./providers.ts";

type JsonRecord = Record<string, unknown>;
type ServiceClient = SupabaseClient;

type SyncRequest = {
  trigger?: "cron" | "manual" | "retry";
  mode?: "pipeline" | "search_only" | "pilot_extract" | "hermes_weekly";
  searchType?: "upcoming_calendar" | "meeting_detail";
  pilotType?: "calendar" | "meeting_schedule" | "race_detail" | "search_evidence";
  pilotQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  raceNumber?: number;
  sourceUrls?: string[];
  queryMode?: "recommended" | "manual";
  manualQuery?: string;
  parentTrialId?: string;
  retryTrialId?: string;
  venue?: string;
  meetingDate?: string;
  additionalGuidance?: string;
};

type AuthorizationContext =
  | { kind: "cron"; userId: null }
  | { kind: "administrator"; userId: string };

type SearchTrialScope = {
  searchType: "upcoming_calendar" | "meeting_detail";
  queryMode: "recommended" | "manual";
  canonicalQuery: string | null;
  parentTrialId: string | null;
  retryTrialId: string | null;
  dateFrom: string;
  dateTo: string;
  venue: string | null;
  meetingDate: string | null;
  additionalGuidance: string;
};

const maximumSearchLabResults = 10;

type RaceFeedTask = {
  id: string;
  source_id: string;
  run_id: string;
  task_key: string;
  task_type: "weekly_calendar" | "meeting_schedule" | "race_detail" | "result_refresh" | "manual_research";
  meeting_id: string | null;
  fixture_id: string | null;
  meeting_external_id: string | null;
  venue: string | null;
  meeting_date: string | null;
  race_number: number | null;
  task_payload: JsonRecord;
  parent_proposal_id: string | null;
};

type FeedSettings = {
  future_lookahead_days: number;
  daily_search_limit: number;
};

type Conflict = {
  field: string;
  description: string;
  material: boolean;
  sources: string[];
};

type CalendarMeeting = {
  venue: string;
  countryCode: string;
  meetingDate: string;
  status: "scheduled" | "cancelled";
};

type CalendarExtraction = {
  weekStart: string;
  weekEnd: string;
  meetings: CalendarMeeting[];
  conflicts: Conflict[];
};

type ScheduleRace = {
  raceNumber: number;
  title: string;
  startsAt: string;
  distanceMetres: number | null;
  raceClass: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "abandoned" | "delayed";
};

type MeetingScheduleExtraction = {
  meeting: CalendarMeeting & { races: ScheduleRace[] };
  conflicts: Conflict[];
};

type NormalizedRunner = {
  externalId: string;
  saddleNumber: number;
  horseName: string;
  jockeyName: string | null;
  trainerName: string | null;
  draw: number | null;
  carriedWeight: number | null;
  status: "active" | "reserve" | "scratched" | "withdrawn";
  resultPosition: number | null;
};

type NormalizedRace = {
  externalId: string;
  raceNumber: number;
  title: string;
  startsAt: string;
  distanceMetres: number | null;
  raceClass: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "abandoned" | "delayed";
  resultSummary: string | null;
  sourceUpdatedAt: string;
  runners: NormalizedRunner[];
};

type ExtractedRunner = Omit<NormalizedRunner, "externalId">;

type RaceDetailExtraction = {
  meeting: CalendarMeeting;
  race: Omit<NormalizedRace, "externalId" | "sourceUpdatedAt" | "runners"> & {
    runners: ExtractedRunner[];
  };
  conflicts: Conflict[];
};

type NormalizedMeeting = {
  externalId: string;
  venue: string;
  countryCode: string;
  meetingDate: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  races: NormalizedRace[];
};

type NormalizedSnapshot = {
  snapshotAt: string;
  meetings: NormalizedMeeting[];
};

type TaskResult = {
  status: "succeeded" | "unchanged" | "pending_approval" | "skipped";
  payload: unknown;
  evidenceCount: number;
  proposalId?: string;
};

const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);
const conflictsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["field", "description", "material", "sources"],
    properties: {
      field: { type: "string" },
      description: { type: "string" },
      material: { type: "boolean" },
      sources: { type: "array", items: { type: "string" } },
    },
  },
};

const meetingIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["venue", "countryCode", "meetingDate", "status"],
  properties: {
    venue: { type: "string" },
    countryCode: { type: "string", enum: ["ZA"] },
    meetingDate: { type: "string" },
    status: { type: "string", enum: ["scheduled", "cancelled"] },
  },
};

const scheduleRaceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raceNumber", "title", "startsAt", "distanceMetres", "raceClass", "status"],
  properties: {
    raceNumber: { type: "integer", minimum: 1 },
    title: { type: "string" },
    startsAt: { type: "string" },
    distanceMetres: { type: ["integer", "null"], minimum: 1 },
    raceClass: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["scheduled", "in_progress", "completed", "cancelled", "abandoned", "delayed"],
    },
  },
};

const runnerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "saddleNumber",
    "horseName",
    "jockeyName",
    "trainerName",
    "draw",
    "carriedWeight",
    "status",
    "resultPosition",
  ],
  properties: {
    saddleNumber: { type: "integer", minimum: 1 },
    horseName: { type: "string" },
    jockeyName: { type: ["string", "null"] },
    trainerName: { type: ["string", "null"] },
    draw: { type: ["integer", "null"], minimum: 1 },
    carriedWeight: { type: ["number", "null"], minimum: 0 },
    status: { type: "string", enum: ["active", "reserve", "scratched", "withdrawn"] },
    resultPosition: { type: ["integer", "null"], minimum: 1 },
  },
};

const raceDetailSchema = {
  name: "mrc_race_detail",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["meeting", "race", "conflicts"],
    properties: {
      meeting: meetingIdentitySchema,
      race: {
        ...scheduleRaceSchema,
        required: [
          "raceNumber",
          "title",
          "startsAt",
          "distanceMetres",
          "raceClass",
          "status",
          "resultSummary",
          "runners",
        ],
        properties: {
          ...scheduleRaceSchema.properties,
          resultSummary: { type: ["string", "null"] },
          runners: { type: "array", minItems: 1, items: runnerSchema },
        },
      },
      conflicts: conflictsSchema,
    },
  },
};

const calendarSchema = {
  name: "mrc_weekly_race_calendar",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["weekStart", "weekEnd", "meetings", "conflicts"],
    properties: {
      weekStart: { type: "string" },
      weekEnd: { type: "string" },
      meetings: { type: "array", items: meetingIdentitySchema },
      conflicts: conflictsSchema,
    },
  },
};

const scheduleSchema = {
  name: "mrc_meeting_schedule",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["meeting", "conflicts"],
    properties: {
      meeting: {
        ...meetingIdentitySchema,
        required: ["venue", "countryCode", "meetingDate", "status", "races"],
        properties: {
          ...meetingIdentitySchema.properties,
          races: { type: "array", minItems: 1, items: scheduleRaceSchema },
        },
      },
      conflicts: conflictsSchema,
    },
  },
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";

  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://www.mrcracing.co.za",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mrc-worker-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
    ? error
    : "Unknown race-feed error.";

  return message
    .replaceAll(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replaceAll(/(?:api[_-]?key|token|secret)[=:]\s*([^\s&]+)/gi, "$1=[redacted]")
    .slice(0, 800);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function meetingExternalId(venue: string, meetingDate: string) {
  return `za-${slugify(venue)}-${meetingDate}`;
}

function meetingKey(venue: string, meetingDate: string) {
  return `${slugify(venue)}:${meetingDate}`;
}

function raceExternalId(meetingId: string, raceNumber: number) {
  return `${meetingId}-r${raceNumber}`;
}

function johannesburgDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid race timestamp: ${value}`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function johannesburgHour(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return -1;
  const hour = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed).find((part) => part.type === "hour")?.value;
  return Number(hour ?? -1);
}

function normalizePersonName(value: string | null) {
  return value?.replace(/\s+Box$/i, "").trim() || null;
}

function addCalendarDays(value: string, days: number) {
  assertDate(value, "Date");
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must be a valid ISO date.`);
  }
}

function normalizeDate(value: unknown, field: string) {
  const candidate = String(value ?? "").trim();
  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(candidate)
    ? candidate
    : Number.isNaN(Date.parse(candidate))
    ? ""
    : new Date(candidate).toISOString().slice(0, 10);
  assertDate(isoCandidate, field);
  return isoCandidate;
}

function assertNoBettingData(value: unknown, path = "payload") {
  const forbidden = /^(odds?|dividends?|payouts?|lucky.?pick|quick.?pick|bookmaker|market|price)$/i;

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoBettingData(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as JsonRecord)) {
      if (forbidden.test(key)) {
        throw new Error(`Betting data is prohibited at ${path}.${key}.`);
      }
      assertNoBettingData(item, `${path}.${key}`);
    }
  }
}

function normalizeConflict(value: unknown): Conflict[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object")
    .map((item) => ({
      field: String(item.field ?? "unknown"),
      description: String(item.description ?? "Source contradiction reported."),
      material: item.material === true,
      sources: Array.isArray(item.sources) ? item.sources.map(String).slice(0, 10) : [],
    }));
}

function canonicalVenueName(value: string) {
  const venue = value.trim();
  const normalized = slugify(venue);
  if (["grey", "grey-turf", "grey-poly", "greyville", "hollywoodbets-greyville"].includes(normalized)) {
    return "Hollywoodbets Greyville";
  }
  if (["scot", "scottsville", "hollywoodbets-scottsville"].includes(normalized)) {
    return "Hollywoodbets Scottsville";
  }
  if (["kenilworth", "hollywoodbets-kenilworth"].includes(normalized)) {
    return "Hollywoodbets Kenilworth";
  }
  if (["durbanville", "hollywoodbets-durbanville"].includes(normalized)) {
    return "Hollywoodbets Durbanville";
  }
  return venue;
}

function normalizeMeetingIdentity(meeting: CalendarMeeting) {
  const venue = canonicalVenueName(meeting.venue);
  const countryCode = meeting.countryCode.trim().toUpperCase();
  const meetingDate = normalizeDate(meeting.meetingDate, "Meeting date");

  if (!venue || countryCode !== "ZA") {
    throw new Error("Only identified South African race meetings are accepted.");
  }

  return {
    venue,
    countryCode: "ZA",
    meetingDate,
    status: meeting.status === "cancelled" ? "cancelled" as const : "scheduled" as const,
  };
}

function normalizeSchedule(extraction: MeetingScheduleExtraction) {
  assertNoBettingData(extraction);
  const meeting = normalizeMeetingIdentity(extraction.meeting);
  const raceNumbers = new Set<number>();

  const races = extraction.meeting.races.map((race) => {
    if (!Number.isInteger(race.raceNumber) || race.raceNumber < 1 || raceNumbers.has(race.raceNumber)) {
      throw new Error("Meeting schedule contains an invalid or duplicate race number.");
    }
    raceNumbers.add(race.raceNumber);

    if (johannesburgDate(race.startsAt) !== meeting.meetingDate) {
      throw new Error(`Race ${race.raceNumber} does not start on the meeting date in Johannesburg.`);
    }

    return {
      raceNumber: race.raceNumber,
      title: race.title.trim() || `Race ${race.raceNumber}`,
      startsAt: new Date(race.startsAt).toISOString(),
      distanceMetres: race.distanceMetres == null ? null : Math.round(race.distanceMetres),
      raceClass: race.raceClass?.trim() || null,
      status: race.status,
    };
  }).sort((left, right) => left.raceNumber - right.raceNumber);

  if (!races.length || races.length > 20) {
    throw new Error("Meeting schedule must contain between one and twenty races.");
  }

  return { meeting: { ...meeting, races }, conflicts: normalizeConflict(extraction.conflicts) };
}

function normalizeRaceDetail(extraction: RaceDetailExtraction, expected?: {
  venue?: string | null;
  meetingDate?: string | null;
  raceNumber?: number | null;
}) {
  assertNoBettingData(extraction);
  const meeting = normalizeMeetingIdentity(extraction.meeting);
  const race = extraction.race;

  if (expected?.venue && slugify(meeting.venue) !== slugify(expected.venue)) {
    throw new Error("Extracted venue does not match the requested meeting.");
  }
  if (expected?.meetingDate && meeting.meetingDate !== expected.meetingDate) {
    throw new Error("Extracted meeting date does not match the requested meeting.");
  }
  if (expected?.raceNumber && race.raceNumber !== expected.raceNumber) {
    throw new Error("Extracted race number does not match the requested race.");
  }
  if (johannesburgDate(race.startsAt) !== meeting.meetingDate) {
    throw new Error("Extracted race time does not fall on the meeting date in Johannesburg.");
  }

  const saddleNumbers = new Set<number>();
  const horseNames = new Set<string>();
  const resultPositions = new Set<number>();
  const normalizedMeetingId = meetingExternalId(meeting.venue, meeting.meetingDate);
  const normalizedRaceId = raceExternalId(normalizedMeetingId, race.raceNumber);
  const uniqueRunnerInputs = new Map<number, ExtractedRunner>();
  for (const runner of race.runners) {
    const existing = uniqueRunnerInputs.get(runner.saddleNumber);
    if (!existing) {
      uniqueRunnerInputs.set(runner.saddleNumber, runner);
      continue;
    }
    if (slugify(existing.horseName) !== slugify(runner.horseName)) {
      throw new Error("Race contains conflicting horses for the same saddle number.");
    }
    uniqueRunnerInputs.set(runner.saddleNumber, {
      ...existing,
      jockeyName: existing.jockeyName ?? runner.jockeyName,
      trainerName: existing.trainerName ?? runner.trainerName,
      draw: existing.draw ?? runner.draw,
      carriedWeight: existing.carriedWeight ?? runner.carriedWeight,
      resultPosition: existing.resultPosition ?? runner.resultPosition,
      status: existing.status === "active" ? runner.status : existing.status,
    });
  }
  const runners = [...uniqueRunnerInputs.values()].map((runner) => {
    if (!Number.isInteger(runner.saddleNumber) || runner.saddleNumber < 1 || saddleNumbers.has(runner.saddleNumber)) {
      throw new Error("Race contains an invalid or duplicate saddle number.");
    }
    saddleNumbers.add(runner.saddleNumber);

    if (runner.resultPosition != null) {
      if (!Number.isInteger(runner.resultPosition) || runner.resultPosition < 1 || resultPositions.has(runner.resultPosition)) {
        throw new Error("Race contains an invalid or duplicate finishing position.");
      }
      resultPositions.add(runner.resultPosition);
    }

    if (!runner.horseName.trim()) {
      throw new Error("Every runner requires a horse name.");
    }
    const horseNameKey = slugify(runner.horseName);
    if (horseNames.has(horseNameKey)) {
      throw new Error("Race contains a duplicate horse name.");
    }
    horseNames.add(horseNameKey);

    return {
      externalId: `${normalizedRaceId}-s${runner.saddleNumber}`,
      saddleNumber: runner.saddleNumber,
      horseName: runner.horseName.trim(),
      jockeyName: normalizePersonName(runner.jockeyName),
      trainerName: normalizePersonName(runner.trainerName),
      draw: runner.draw == null ? null : Math.round(runner.draw),
      carriedWeight: runner.carriedWeight == null ? null : Number(runner.carriedWeight.toFixed(1)),
      status: runner.status,
      resultPosition: runner.resultPosition == null ? null : Math.round(runner.resultPosition),
    } satisfies NormalizedRunner;
  });

  if (!runners.length || runners.length > 60) {
    throw new Error("Race must contain between one and sixty runners.");
  }

  const normalizedRace: NormalizedRace = {
    externalId: normalizedRaceId,
    raceNumber: race.raceNumber,
    title: race.title.trim() || `Race ${race.raceNumber}`,
    startsAt: new Date(race.startsAt).toISOString(),
    distanceMetres: race.distanceMetres == null ? null : Math.round(race.distanceMetres),
    raceClass: race.raceClass?.trim() || null,
    status: race.status,
    resultSummary: race.resultSummary?.trim() || null,
    sourceUpdatedAt: new Date().toISOString(),
    runners,
  };

  return {
    meeting: {
      externalId: normalizedMeetingId,
      ...meeting,
    },
    race: normalizedRace,
    conflicts: normalizeConflict(extraction.conflicts),
  };
}

async function loadConfiguration(serviceClient: ServiceClient): Promise<WorkerConfiguration> {
  const { data, error } = await serviceClient.rpc("get_race_llm_configuration");
  const vault = error ? {} : (data ?? {}) as JsonRecord;
  const legacyBaseUrl = Deno.env.get("RACE_LLM_BASE_URL") || String(vault.baseUrl ?? "");
  const legacyApiKey = Deno.env.get("RACE_LLM_API_KEY") || String(vault.apiKey ?? "");
  const searchProviderValue = (Deno.env.get("RACE_SEARCH_PROVIDER") || (Deno.env.get("OLLAMA_WEB_API_KEY") ? "ollama" : "gemini")).toLowerCase();
  const extractionProviderValue = (Deno.env.get("RACE_EXTRACTION_PROVIDER") || (Deno.env.get("GROQ_API_KEY") ? "groq" : "gemini")).toLowerCase();
  if (!(searchProviderValue === "ollama" || searchProviderValue === "gemini")) {
    throw new Error(`Unsupported race search provider: ${searchProviderValue}.`);
  }
  if (!(extractionProviderValue === "groq" || extractionProviderValue === "gemini" || extractionProviderValue === "openai" || extractionProviderValue === "ollama")) {
    throw new Error(`Unsupported race extraction provider: ${extractionProviderValue}.`);
  }
  const searchProvider: ProviderName = searchProviderValue;
  const extractionProvider: ProviderName = extractionProviderValue;
  const configuration = {
    searchProvider,
    extractionProvider,
    searchBaseUrl: searchProvider === "ollama"
      ? Deno.env.get("OLLAMA_WEB_BASE_URL") || "https://ollama.com/api"
      : Deno.env.get("RACE_GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta",
    searchApiKey: searchProvider === "ollama" ? Deno.env.get("OLLAMA_WEB_API_KEY") ?? "" : legacyApiKey,
    searchModel: searchProvider === "ollama"
      ? "ollama-web-search"
      : Deno.env.get("RACE_LLM_SEARCH_MODEL") || String(vault.searchModel ?? "gemini-3.6-flash"),
    extractionBaseUrl: extractionProvider === "groq"
      ? Deno.env.get("GROQ_BASE_URL") || "https://api.groq.com/openai/v1"
      : legacyBaseUrl,
    extractionApiKey: extractionProvider === "groq" ? Deno.env.get("GROQ_API_KEY") ?? "" : legacyApiKey,
    extractionModel: extractionProvider === "groq"
      ? Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-20b"
      : Deno.env.get("RACE_LLM_EXTRACTION_MODEL") || Deno.env.get("RACE_LLM_MODEL") ||
        String(vault.extractionModel ?? vault.model ?? "gemini-3.6-flash"),
    responseMode: Deno.env.get("RACE_LLM_RESPONSE_MODE") || String(vault.responseMode ?? "json_schema"),
    telemetry: {
      searchRequests: 0,
      fetchRequests: 0,
      extractionRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  } satisfies WorkerConfiguration;

  if (!configuration.searchApiKey || !configuration.extractionBaseUrl || !configuration.extractionApiKey || !configuration.extractionModel) {
    throw new Error("Race provider configuration is incomplete.");
  }

  return configuration;
}

function loadSearchOnlyConfiguration(): WorkerConfiguration {
  const searchProvider = (Deno.env.get("RACE_SEARCH_PROVIDER") || "ollama").toLowerCase();
  const searchApiKey = Deno.env.get("OLLAMA_WEB_API_KEY") ?? "";
  if (searchProvider !== "ollama") {
    throw new Error("The Search Lab requires RACE_SEARCH_PROVIDER=ollama.");
  }
  if (!searchApiKey) {
    throw new Error("The Ollama web-search key is not configured.");
  }

  return {
    searchProvider: "ollama",
    extractionProvider: "groq",
    searchBaseUrl: Deno.env.get("OLLAMA_WEB_BASE_URL") || "https://ollama.com/api",
    searchApiKey,
    searchModel: "ollama-web-search",
    extractionBaseUrl: "",
    extractionApiKey: "",
    extractionModel: "disabled-for-search-lab",
    responseMode: "disabled-for-search-lab",
    telemetry: {
      searchRequests: 0,
      fetchRequests: 0,
      extractionRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}

function buildPilotValidation(
  pilotType: "meeting_schedule" | "race_detail",
  normalized: ReturnType<typeof normalizeSchedule> | ReturnType<typeof normalizeRaceDetail>,
  evidence: GroundingEvidence[],
  requestedSourceCount: number,
) {
  const warnings: string[] = [];
  const sourceDomains = [...new Set(evidence.map((item) => item.domain))];
  if (sourceDomains.length < 2) {
    warnings.push("At least two independent source domains are required before database approval.");
  }
  if (requestedSourceCount > evidence.length) {
    warnings.push(`${requestedSourceCount - evidence.length} selected source page(s) could not be fetched.`);
  }

  const conflicts = normalized.conflicts ?? [];
  if (conflicts.some((conflict) => conflict.material)) {
    warnings.push("The extraction contains a material source conflict.");
  }

  let missingRequiredFields = 0;
  if (pilotType === "meeting_schedule") {
    const meeting = normalized as ReturnType<typeof normalizeSchedule>;
    missingRequiredFields = meeting.meeting.races.filter((race) =>
      !race.title || race.distanceMetres == null || !race.startsAt ||
      johannesburgHour(race.startsAt) < 8 || johannesburgHour(race.startsAt) > 22
    ).length;
    if (missingRequiredFields) {
      warnings.push(`${missingRequiredFields} race(s) have missing facts or an implausible local start time.`);
    }
  } else {
    const detail = normalized as ReturnType<typeof normalizeRaceDetail>;
    if (
      detail.race.distanceMetres == null || !detail.race.title || !detail.race.startsAt ||
      johannesburgHour(detail.race.startsAt) < 8 || johannesburgHour(detail.race.startsAt) > 22
    ) {
      missingRequiredFields += 1;
    }
    missingRequiredFields += detail.race.runners.filter((runner) =>
      !runner.horseName || runner.jockeyName == null || runner.trainerName == null ||
      runner.draw == null || runner.carriedWeight == null
    ).length;
    if (missingRequiredFields) {
      warnings.push(`${missingRequiredFields} race or runner record(s) have missing facts or an implausible local start time.`);
    }
  }

  return {
    status: warnings.length ? "review_required" : "complete",
    eligibleForProposal: warnings.length === 0,
    sourceCount: evidence.length,
    uniqueDomainCount: sourceDomains.length,
    sourceDomains,
    missingRequiredFields,
    warnings,
  };
}

async function loadSearchContext(serviceClient: ServiceClient, task: RaceFeedTask): Promise<SearchContext> {
  const [{ data: domains, error: domainsError }, { data: sources, error: sourcesError }] = await Promise.all([
    serviceClient.from("race_source_domains").select("domain,status,direct_fetch_allowed"),
    serviceClient.from("race_feed_sources").select("name,source_url,venue_hint,is_enabled").eq("is_enabled", true),
  ]);
  if (domainsError) throw new Error(`Could not load race-source policies: ${domainsError.message}`);
  if (sourcesError) throw new Error(`Could not load preferred race sources: ${sourcesError.message}`);

  const venue = task.venue?.trim().toLowerCase() ?? "";
  const preferredUrls = (sources ?? []).flatMap((source) => {
    const name = String(source.name ?? "").toLowerCase();
    if (name.includes("gemini grounded") || name.includes("ollama web search")) return [];
    const venueHint = String(source.venue_hint ?? "").trim().toLowerCase();
    if (venueHint && venue && !venue.includes(venueHint) && !venueHint.includes(venue)) return [];
    const url = String(source.source_url ?? "").trim();
    return url ? [url] : [];
  });

  return {
    preferredUrls,
    sourcePolicies: (domains ?? []).map((domain) => ({
      domain: String(domain.domain ?? "").toLowerCase(),
      status: domain.status as "approved" | "evidence_only" | "blocked",
      directFetchAllowed: domain.direct_fetch_allowed === true,
    })),
  };
}

async function loadSearchOnlyContext(serviceClient: ServiceClient): Promise<SearchContext> {
  const { data: domains, error } = await serviceClient
    .from("race_source_domains")
    .select("domain,status,direct_fetch_allowed");
  if (error) throw new Error(`Could not load race-source policies: ${error.message}`);

  return {
    preferredUrls: [],
    sourcePolicies: (domains ?? []).map((domain) => ({
      domain: String(domain.domain ?? "").toLowerCase(),
      status: domain.status as "approved" | "evidence_only" | "blocked",
      directFetchAllowed: false,
    })),
  };
}

async function updateProviderTelemetry(
  serviceClient: ServiceClient,
  runId: string,
  configuration: WorkerConfiguration,
) {
  const { error } = await serviceClient.from("race_feed_runs").update({
    search_provider_name: configuration.searchProvider,
    extraction_provider_name: configuration.extractionProvider,
    search_model_name: configuration.searchModel,
    extraction_model_name: configuration.extractionModel,
    search_fetch_count: configuration.telemetry.fetchRequests,
    extraction_request_count: configuration.telemetry.extractionRequests,
    provider_input_tokens: configuration.telemetry.inputTokens,
    provider_output_tokens: configuration.telemetry.outputTokens,
  }).eq("id", runId);
  if (error) throw new Error(`Could not record provider telemetry: ${error.message}`);
}

function buildWeeklyPrompt(task: RaceFeedTask, settings: FeedSettings) {
  const weekStart = String(task.task_payload.weekStart ?? new Date().toISOString().slice(0, 10));
  const dateTo = addCalendarDays(weekStart, settings.future_lookahead_days - 1);
  return `Find every South African thoroughbred horse-racing meeting from ${weekStart} through ${dateTo} inclusive. Check national and regional fixtures for Vaal, Turffontein, Fairview, Hollywoodbets Greyville, Hollywoodbets Scottsville, Kenilworth and Durbanville, including valid venue aliases. Return meeting venue, local meeting date, country ZA and scheduled/cancelled status only. Do not list races, runners, odds or betting products. Cross-check multiple independent public sources and explicitly describe contradictions or missing regional coverage.`;
}

function buildSchedulePrompt(task: RaceFeedTask) {
  const additional = String(task.task_payload.additionalInformation ?? "").trim();
  return `Find the complete race schedule for the South African horse-racing meeting at ${task.venue} on ${task.meeting_date}. Return every race number, local start time, distance, race title/class and status. Do not return runners, odds or betting products. Cross-check multiple independent public sources. ${additional}`.trim();
}

function buildRacePrompt(task: RaceFeedTask, resultOnly = false) {
  const additional = String(task.task_payload.additionalInformation ?? "").trim();
  return `Find ${resultOnly ? "the official result and current runner details" : "the complete current runner list"} for ${task.venue} Race ${task.race_number} on ${task.meeting_date}. Return race time, distance, title/class, saddle number, horse, jockey, trainer, draw, carried weight, scratch/withdrawal status${resultOnly ? ", result summary and official finishing positions" : ""}. Use null when a factual field is unavailable. Do not return odds, dividends, payouts or betting controls. Cross-check multiple independent public sources and explicitly describe contradictions. ${additional}`.trim();
}

async function insertFragment(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  fragmentType: "weekly_calendar" | "meeting_schedule" | "race_detail" | "result",
  payload: unknown,
  evidence: GroundingEvidence[],
  identity?: { venue: string; meetingDate: string; externalId: string; raceNumber?: number },
) {
  const contentHash = await sha256(JSON.stringify({ payload, evidence }));
  let currentQuery = serviceClient
    .from("race_feed_fragments")
    .update({ is_current: false })
    .eq("fragment_type", fragmentType)
    .eq("is_current", true);

  if (identity) {
    currentQuery = currentQuery.eq("meeting_key", meetingKey(identity.venue, identity.meetingDate));
    if (identity.raceNumber) currentQuery = currentQuery.eq("race_number", identity.raceNumber);
  } else {
    currentQuery = currentQuery.eq("task_id", task.id);
  }
  const { error: currentError } = await currentQuery;
  if (currentError) throw new Error(`Could not rotate staged race fragment: ${currentError.message}`);

  const { data, error } = await serviceClient
    .from("race_feed_fragments")
    .upsert({
      task_id: task.id,
      run_id: task.run_id,
      source_id: task.source_id,
      fragment_type: fragmentType,
      meeting_key: identity ? meetingKey(identity.venue, identity.meetingDate) : null,
      meeting_external_id: identity?.externalId ?? null,
      venue: identity?.venue ?? null,
      meeting_date: identity?.meetingDate ?? null,
      race_number: identity?.raceNumber ?? null,
      payload,
      evidence,
      content_hash: contentHash,
      is_current: true,
    }, { onConflict: "task_id,content_hash" })
    .select("id")
    .single();

  if (error) throw new Error(`Could not stage race fragment: ${error.message}`);
  return data.id as string;
}

async function upsertTask(serviceClient: ServiceClient, values: JsonRecord) {
  const { error } = await serviceClient
    .from("race_feed_tasks")
    .upsert(values, { onConflict: "task_key" });
  if (error) throw new Error(`Could not queue race-feed task: ${error.message}`);
}

function deduplicateEvidence(items: GroundingEvidence[]) {
  const unique = new Map<string, GroundingEvidence>();
  for (const item of items) {
    const key = `${item.url}|${item.factScope}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 100);
}

function scoreCompleteness(meeting: NormalizedMeeting) {
  let available = 0;
  let possible = 0;
  for (const race of meeting.races) {
    possible += 4;
    if (race.title) available += 1;
    if (race.distanceMetres) available += 1;
    if (race.startsAt) available += 1;
    if (race.runners.length) available += 1;
    for (const runner of race.runners) {
      possible += 5;
      if (runner.horseName) available += 1;
      if (runner.jockeyName) available += 1;
      if (runner.trainerName) available += 1;
      if (runner.draw) available += 1;
      if (runner.carriedWeight != null) available += 1;
    }
  }
  return possible ? Math.round((available / possible) * 10000) / 100 : 0;
}

function scoreAgreement(evidence: GroundingEvidence[], conflicts: Conflict[]) {
  const domains = new Set(evidence.map((item) => item.domain).filter(Boolean));
  const materialConflicts = conflicts.filter((conflict) => conflict.material).length;
  if (materialConflicts) return Math.max(20, 70 - materialConflicts * 15);
  if (domains.size >= 3) return 100;
  if (domains.size === 2) return 90;
  return domains.size === 1 ? 50 : 0;
}

async function buildCurrentDiff(serviceClient: ServiceClient, meeting: NormalizedMeeting) {
  let { data: currentMeeting } = await serviceClient
    .from("race_meetings")
    .select("id,external_id,venue,meeting_date,status,first_race_at,last_race_at")
    .eq("external_id", meeting.externalId)
    .eq("is_test", false)
    .maybeSingle();

  if (!currentMeeting) {
    const response = await serviceClient
      .from("race_meetings")
      .select("id,external_id,venue,meeting_date,status,first_race_at,last_race_at")
      .ilike("venue", meeting.venue)
      .eq("meeting_date", meeting.meetingDate)
      .eq("is_test", false)
      .maybeSingle();
    currentMeeting = response.data;
  }

  if (!currentMeeting) {
    return {
      diff: {
        kind: "new_meeting",
        racesAdded: meeting.races.length,
        runnersAdded: meeting.races.reduce((sum, race) => sum + race.runners.length, 0),
      },
      changeType: "new_meeting" as const,
      criticalConflict: false,
      conflictSummary: null,
    };
  }

  const { data: fixtures, error: fixtureError } = await serviceClient
    .from("fixtures")
    .select("id,race_number,starts_at,status,result_summary")
    .eq("meeting_id", currentMeeting.id);
  if (fixtureError) throw new Error(`Could not compare existing meeting: ${fixtureError.message}`);

  const fixtureIds = (fixtures ?? []).map((fixture) => fixture.id as string);
  const { data: entries, error: entryError } = fixtureIds.length
    ? await serviceClient
      .from("race_entries")
      .select("fixture_id,saddle_number,horse_name,status,result_position")
      .in("fixture_id", fixtureIds)
    : { data: [], error: null };
  if (entryError) throw new Error(`Could not compare existing runners: ${entryError.message}`);

  const timeChanges: JsonRecord[] = [];
  const resultChanges: JsonRecord[] = [];
  let missingRunnerCount = 0;
  for (const race of meeting.races) {
    const fixture = (fixtures ?? []).find((item) => item.race_number === race.raceNumber);
    if (!fixture) continue;
    if (new Date(fixture.starts_at as string).toISOString() !== race.startsAt) {
      timeChanges.push({ raceNumber: race.raceNumber, from: fixture.starts_at, to: race.startsAt });
    }
    if (fixture.result_summary && race.resultSummary && fixture.result_summary !== race.resultSummary) {
      resultChanges.push({ raceNumber: race.raceNumber, from: fixture.result_summary, to: race.resultSummary });
    }
    const existingEntries = (entries ?? []).filter((entry) => entry.fixture_id === fixture.id);
    missingRunnerCount += existingEntries.filter((entry) =>
      !race.runners.some((runner) => runner.saddleNumber === entry.saddle_number)
    ).length;
  }

  const criticalConflict = resultChanges.length > 0 || missingRunnerCount > 3;
  return {
    diff: {
      kind: raceContainsResults(meeting) ? "result" : "routine_change",
      existingMeetingId: currentMeeting.id,
      raceCountBefore: fixtures?.length ?? 0,
      raceCountAfter: meeting.races.length,
      timeChanges,
      officialResultReplacements: resultChanges,
      missingExistingRunners: missingRunnerCount,
    },
    changeType: raceContainsResults(meeting) ? "result" as const : "routine_change" as const,
    criticalConflict,
    conflictSummary: criticalConflict
      ? "Existing official results would be replaced or several existing runners are absent."
      : null,
  };
}

function raceContainsResults(meeting: NormalizedMeeting) {
  return meeting.races.some((race) =>
    Boolean(race.resultSummary) || race.runners.some((runner) => runner.resultPosition != null)
  );
}

async function submitMeetingProposal(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  meeting: NormalizedMeeting,
  evidence: GroundingEvidence[],
  conflicts: Conflict[],
) {
  const snapshot: NormalizedSnapshot = {
    snapshotAt: new Date().toISOString(),
    meetings: [meeting],
  };
  const current = await buildCurrentDiff(serviceClient, meeting);
  const materialConflicts = conflicts.filter((conflict) => conflict.material);
  const hasCriticalConflict = current.criticalConflict || materialConflicts.length > 0;
  const conflictSummary = [
    current.conflictSummary,
    ...materialConflicts.map((conflict) => conflict.description),
  ].filter(Boolean).join(" ") || null;
  const { data, error } = await serviceClient.rpc("submit_race_feed_proposal", {
    p_task_id: task.id,
    p_run_id: task.run_id,
    p_snapshot: snapshot,
    p_change_type: current.changeType,
    p_current_diff: current.diff,
    p_validation_outcome: {
      schemaValid: true,
      noBettingData: true,
      meetingComplete: true,
      conflictCount: conflicts.length,
    },
    p_evidence: evidence,
    p_completeness_score: scoreCompleteness(meeting),
    p_agreement_score: scoreAgreement(evidence, conflicts),
    p_has_critical_conflict: hasCriticalConflict,
    p_conflict_summary: conflictSummary,
    p_parent_proposal_id: task.parent_proposal_id,
    p_research_guidance: task.task_payload.additionalInformation ?? null,
  });
  if (error) throw new Error(`Could not submit race-feed proposal: ${error.message}`);

  const proposal = (data as JsonRecord)?.proposal as JsonRecord | undefined;
  return {
    status: String((data as JsonRecord)?.status ?? "pending") === "duplicate"
      ? "unchanged" as const
      : "pending_approval" as const,
    proposalId: proposal?.id ? String(proposal.id) : undefined,
    snapshot,
  };
}

async function handleWeeklyCalendar(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  settings: FeedSettings,
  configuration: WorkerConfiguration,
): Promise<TaskResult> {
  const search = await groundedSearch(
    configuration,
    buildWeeklyPrompt(task, settings),
    "weekly_calendar",
    await loadSearchContext(serviceClient, task),
  );
  const expectedWeekStart = normalizeDate(task.task_payload.weekStart, "Requested week start");
  const expectedWeekEnd = addCalendarDays(expectedWeekStart, settings.future_lookahead_days - 1);
  const extracted = await extractCalendarEvidence(configuration, search, expectedWeekStart, expectedWeekEnd);
  const uniqueMeetings = new Map(
    extracted.meetings.map((meeting) => [meetingKey(meeting.venue, meeting.meetingDate), meeting]),
  );
  await insertFragment(serviceClient, task, "weekly_calendar", {
    weekStart: expectedWeekStart,
    weekEnd: expectedWeekEnd,
    meetings: [...uniqueMeetings.values()],
    conflicts: extracted.conflicts,
    extractionErrors: extracted.errors,
  }, extracted.evidence);

  for (const meeting of uniqueMeetings.values()) {
    const externalId = meetingExternalId(meeting.venue, meeting.meetingDate);
    await upsertTask(serviceClient, {
      source_id: task.source_id,
      task_key: `meeting-schedule:${meetingKey(meeting.venue, meeting.meetingDate)}`,
      task_type: "meeting_schedule",
      state: "pending",
      meeting_external_id: externalId,
      venue: meeting.venue,
      meeting_date: meeting.meetingDate,
      task_payload: {
        venue: meeting.venue,
        meetingDate: meeting.meetingDate,
        calendarEvidence: extracted.evidence,
      },
      due_at: new Date().toISOString(),
    });
  }

  return {
    status: uniqueMeetings.size ? "succeeded" : "unchanged",
    payload: { meetingCount: uniqueMeetings.size, weekStart: expectedWeekStart, weekEnd: expectedWeekEnd },
    evidenceCount: extracted.evidence.length,
  };
}

async function handleMeetingSchedule(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  configuration: WorkerConfiguration,
): Promise<TaskResult> {
  if (!task.venue || !task.meeting_date) throw new Error("Meeting schedule task is missing venue or date.");
  const searchContext = await loadSearchContext(serviceClient, task);
  const search = configuration.searchProvider === "ollama"
    ? await ollamaWebSearchOnly(configuration, buildSchedulePrompt(task), "meeting_schedule", searchContext)
    : await groundedSearch(configuration, buildSchedulePrompt(task), "meeting_schedule", searchContext);
  const meeting = normalizeMeetingIdentity({
    venue: task.venue,
    countryCode: "ZA",
    meetingDate: task.meeting_date,
    status: "scheduled",
  });
  const supportedEvidence = search.evidence.filter((item) => evidenceSupportsCalendarMeeting([item], meeting));
  const discovered = supportedEvidence.map((item) => {
    const times = [...new Set((`${item.title ?? ""}\n${item.excerpt ?? ""}`.match(/\b(?:0?[89]|1\d|2[0-2]):[0-5]\d\b/g) ?? [])
      .map((time) => time.padStart(5, "0")))].sort();
    return { item, times };
  }).sort((left, right) => right.times.length - left.times.length)[0];
  if (!discovered || discovered.times.length < 6 || discovered.times.length > 20) {
    throw new Error("Ollama evidence did not provide a complete six-to-twenty-race start-time rail.");
  }

  const externalId = meetingExternalId(meeting.venue, meeting.meetingDate);
  const discoveredRaces = discovered.times.map((time, index) => ({
    raceNumber: index + 1,
    title: "",
    startsAt: new Date(`${meeting.meetingDate}T${time}:00+02:00`).toISOString(),
    distanceMetres: null,
    raceClass: null,
    status: "scheduled" as const,
  }));
  await insertFragment(serviceClient, task, "meeting_schedule", {
    meeting: { externalId, ...meeting, races: discoveredRaces },
    conflicts: [],
    discoveryOnly: true,
    expectedRaceCount: discoveredRaces.length,
  }, supportedEvidence, {
    venue: meeting.venue,
    meetingDate: meeting.meetingDate,
    externalId,
  });

  for (const race of discoveredRaces) {
    await upsertTask(serviceClient, {
      source_id: task.source_id,
      task_key: `race-detail:${meetingKey(meeting.venue, meeting.meetingDate)}:${race.raceNumber}`,
      task_type: "race_detail",
      state: "pending",
      meeting_external_id: externalId,
      venue: meeting.venue,
      meeting_date: meeting.meetingDate,
      race_number: race.raceNumber,
      task_payload: {
        expectedRace: race,
        expectedRaceCount: discoveredRaces.length,
        scheduleEvidence: supportedEvidence,
      },
      due_at: new Date().toISOString(),
    });
  }

  return {
    status: "succeeded",
    payload: { meeting: meeting.venue, raceCount: discoveredRaces.length, discoveryOnly: true },
    evidenceCount: supportedEvidence.length,
  };
}

async function assembleStagedMeeting(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  normalizedDetail: ReturnType<typeof normalizeRaceDetail>,
) {
  const key = meetingKey(normalizedDetail.meeting.venue, normalizedDetail.meeting.meetingDate);
  const { data: fragments, error } = await serviceClient
    .from("race_feed_fragments")
    .select("fragment_type,race_number,payload,evidence")
    .eq("meeting_key", key)
    .eq("is_current", true)
    .in("fragment_type", ["meeting_schedule", "race_detail"]);
  if (error) throw new Error(`Could not assemble staged meeting: ${error.message}`);

  const scheduleFragment = (fragments ?? []).find((fragment) => fragment.fragment_type === "meeting_schedule");
  if (!scheduleFragment) return null;
  const schedulePayload = scheduleFragment.payload as { meeting: NormalizedMeeting; conflicts?: Conflict[] };
  const expectedRaces = schedulePayload.meeting.races as unknown as ScheduleRace[];
  const detailFragments = (fragments ?? []).filter((fragment) => fragment.fragment_type === "race_detail");
  const detailsByRace = new Map(detailFragments.map((fragment) => {
    const payload = fragment.payload as { race: NormalizedRace; conflicts?: Conflict[] };
    return [Number(fragment.race_number), payload];
  }));

  if (expectedRaces.some((race) => !detailsByRace.has(race.raceNumber))) return null;

  const races = expectedRaces.map((race) => {
    const detail = detailsByRace.get(race.raceNumber)!.race;
    return {
      ...detail,
      title: race.title || detail.title,
      startsAt: race.startsAt,
      distanceMetres: race.distanceMetres ?? detail.distanceMetres,
      raceClass: race.raceClass ?? detail.raceClass,
    };
  });
  const meeting: NormalizedMeeting = {
    externalId: normalizedDetail.meeting.externalId,
    venue: normalizedDetail.meeting.venue,
    countryCode: "ZA",
    meetingDate: normalizedDetail.meeting.meetingDate,
    status: races.every((race) => race.status === "completed")
      ? "completed"
      : races.some((race) => race.status === "in_progress" || race.status === "completed")
      ? "in_progress"
      : normalizedDetail.meeting.status,
    races,
  };
  const allEvidence = deduplicateEvidence((fragments ?? []).flatMap((fragment) =>
    Array.isArray(fragment.evidence) ? fragment.evidence as GroundingEvidence[] : []
  ));
  const conflicts = [
    ...(schedulePayload.conflicts ?? []),
    ...detailFragments.flatMap((fragment) => {
      const payload = fragment.payload as { conflicts?: Conflict[] };
      return payload.conflicts ?? [];
    }),
  ];
  return await submitMeetingProposal(serviceClient, task, meeting, allEvidence, conflicts);
}

async function handleRaceDetail(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  configuration: WorkerConfiguration,
): Promise<TaskResult> {
  if (!task.venue || !task.meeting_date || !task.race_number) {
    throw new Error("Race detail task is missing meeting or race identity.");
  }
  const expected = {
    venue: task.venue,
    meetingDate: task.meeting_date,
    raceNumber: task.race_number,
    startTime: (() => {
      const startsAt = String((task.task_payload.expectedRace as JsonRecord | undefined)?.startsAt ?? "");
      const parsed = new Date(startsAt);
      return Number.isNaN(parsed.getTime())
        ? null
        : new Intl.DateTimeFormat("en-GB", {
          timeZone: "Africa/Johannesburg",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(parsed);
    })(),
  };
  const storedEvidence = Array.isArray(task.task_payload.scheduleEvidence)
    ? task.task_payload.scheduleEvidence.filter((value): value is GroundingEvidence => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<GroundingEvidence>;
      return typeof item.url === "string" && typeof item.domain === "string" && typeof item.excerpt === "string";
    })
    : [];
  const storedCandidates = [...storedEvidence].sort(
    (left, right) => raceEvidenceScore(right, expected) - raceEvidenceScore(left, expected),
  );
  const storedExtraction = storedCandidates.flatMap((evidence) => {
    const extraction = parseKnownRaceDetailEvidence(evidence, expected);
    return extraction ? [{ extraction, evidence }] : [];
  })[0];
  if (storedExtraction) {
    const normalized = normalizeRaceDetail(storedExtraction.extraction, expected);
    await insertFragment(serviceClient, task, "race_detail", normalized, [storedExtraction.evidence], {
      venue: normalized.meeting.venue,
      meetingDate: normalized.meeting.meetingDate,
      externalId: normalized.meeting.externalId,
      raceNumber: normalized.race.raceNumber,
    });
    const proposal = await assembleStagedMeeting(serviceClient, task, normalized);
    return {
      status: proposal?.status ?? "succeeded",
      payload: proposal?.snapshot ?? {
        meeting: normalized.meeting.venue,
        raceNumber: normalized.race.raceNumber,
        staged: true,
        reusedStoredEvidence: true,
      },
      evidenceCount: 1,
      proposalId: proposal?.proposalId,
    };
  }
  const context = await loadSearchContext(serviceClient, task);
  const configuredUrls = Array.isArray(task.task_payload.preferredUrls)
    ? task.task_payload.preferredUrls.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 2)
    : [];
  const permittedUrls = configuredUrls.filter((urlValue) => {
    try {
      const domain = new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
      const policy = context.sourcePolicies.find((item) => item.domain === domain);
      return policy?.status !== "blocked" && policy?.directFetchAllowed === true;
    } catch {
      return false;
    }
  });
  const search = permittedUrls.length
    ? await ollamaWebFetchOnly(configuration, permittedUrls, `race_${task.race_number}`, context)
    : await groundedSearch(
      configuration,
      buildRacePrompt(task),
      `race_${task.race_number}`,
      context,
    );
  const selected = await extractBestRaceDetail(configuration, search, expected);
  const normalized = selected.normalized;
  await insertFragment(serviceClient, task, "race_detail", {
    ...normalized,
    extractionErrors: selected.errors,
  }, [selected.evidence], {
    venue: normalized.meeting.venue,
    meetingDate: normalized.meeting.meetingDate,
    externalId: normalized.meeting.externalId,
    raceNumber: normalized.race.raceNumber,
  });

  const proposal = await assembleStagedMeeting(serviceClient, task, normalized);
  return {
    status: proposal?.status ?? "succeeded",
    payload: proposal?.snapshot ?? {
      meeting: normalized.meeting.venue,
      raceNumber: normalized.race.raceNumber,
      staged: true,
    },
    evidenceCount: 1,
    proposalId: proposal?.proposalId,
  };
}

async function loadMeetingSnapshot(serviceClient: ServiceClient, meetingId: string) {
  const { data: meeting, error: meetingError } = await serviceClient
    .from("race_meetings")
    .select("id,external_id,venue,country_code,meeting_date,status,source_updated_at")
    .eq("id", meetingId)
    .eq("is_test", false)
    .single();
  if (meetingError) throw new Error(`Result meeting could not be loaded: ${meetingError.message}`);

  const { data: fixtures, error: fixturesError } = await serviceClient
    .from("fixtures")
    .select("id,external_id,race_number,title,starts_at,distance_m,race_class,status,result_summary,source_updated_at")
    .eq("meeting_id", meetingId)
    .order("race_number", { ascending: true });
  if (fixturesError) throw new Error(`Result races could not be loaded: ${fixturesError.message}`);
  const fixtureIds = (fixtures ?? []).map((fixture) => fixture.id as string);
  const { data: entries, error: entriesError } = fixtureIds.length
    ? await serviceClient
      .from("race_entries")
      .select("fixture_id,external_id,saddle_number,horse_name,jockey_name,trainer_name,draw,carried_weight,status,result_position,source_updated_at")
      .in("fixture_id", fixtureIds)
    : { data: [], error: null };
  if (entriesError) throw new Error(`Result runners could not be loaded: ${entriesError.message}`);

  const races: NormalizedRace[] = (fixtures ?? []).map((fixture) => ({
    externalId: String(fixture.external_id ?? raceExternalId(String(meeting.external_id), Number(fixture.race_number))),
    raceNumber: Number(fixture.race_number),
    title: String(fixture.title),
    startsAt: new Date(String(fixture.starts_at)).toISOString(),
    distanceMetres: fixture.distance_m == null ? null : Number(fixture.distance_m),
    raceClass: fixture.race_class ? String(fixture.race_class) : null,
    status: String(fixture.status) as NormalizedRace["status"],
    resultSummary: fixture.result_summary ? String(fixture.result_summary) : null,
    sourceUpdatedAt: new Date(String(fixture.source_updated_at ?? meeting.source_updated_at ?? Date.now())).toISOString(),
    runners: (entries ?? []).filter((entry) => entry.fixture_id === fixture.id).map((entry) => ({
      externalId: String(entry.external_id ?? `${fixture.external_id}-s${entry.saddle_number}`),
      saddleNumber: Number(entry.saddle_number),
      horseName: String(entry.horse_name),
      jockeyName: entry.jockey_name ? String(entry.jockey_name) : null,
      trainerName: entry.trainer_name ? String(entry.trainer_name) : null,
      draw: entry.draw == null ? null : Number(entry.draw),
      carriedWeight: entry.carried_weight == null ? null : Number(entry.carried_weight),
      status: String(entry.status) as NormalizedRunner["status"],
      resultPosition: entry.result_position == null ? null : Number(entry.result_position),
    })),
  }));

  return {
    meeting: {
      externalId: String(meeting.external_id),
      venue: String(meeting.venue),
      countryCode: String(meeting.country_code),
      meetingDate: String(meeting.meeting_date),
      status: String(meeting.status) as NormalizedMeeting["status"],
      races,
    } satisfies NormalizedMeeting,
    fixtureIds,
  };
}

async function handleResultRefresh(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  configuration: WorkerConfiguration,
): Promise<TaskResult> {
  if (!task.meeting_id) throw new Error("Result refresh task is missing a meeting ID.");
  const current = await loadMeetingSnapshot(serviceClient, task.meeting_id);
  const targetRace = selectResultRefreshRace(current.meeting, task.race_number);

  if (!targetRace) {
    return { status: "skipped", payload: { reason: "No race has started yet." }, evidenceCount: 0 };
  }

  const resultTask = {
    ...task,
    venue: current.meeting.venue,
    meeting_date: current.meeting.meetingDate,
    race_number: targetRace.raceNumber,
  };
  const search = await groundedSearch(
    configuration,
    buildRacePrompt(resultTask, true),
    `result_race_${targetRace.raceNumber}`,
    await loadSearchContext(serviceClient, resultTask),
  );
  const selected = await extractBestRaceDetail(configuration, search, {
    venue: current.meeting.venue,
    meetingDate: current.meeting.meetingDate,
    raceNumber: targetRace.raceNumber,
  });
  const normalized = selected.normalized;
  const races = current.meeting.races.map((race) =>
    race.raceNumber === normalized.race.raceNumber ? normalized.race : race
  );
  const meeting: NormalizedMeeting = {
    ...current.meeting,
    status: races.every((race) => race.status === "completed")
      ? "completed"
      : races.some((race) => race.status === "completed" || race.status === "in_progress")
      ? "in_progress"
      : current.meeting.status,
    races,
  };
  await insertFragment(serviceClient, task, "result", {
    ...normalized,
    extractionErrors: selected.errors,
  }, [selected.evidence], {
    venue: meeting.venue,
    meetingDate: meeting.meetingDate,
    externalId: meeting.externalId,
    raceNumber: normalized.race.raceNumber,
  });
  const proposal = await submitMeetingProposal(
    serviceClient,
    task,
    meeting,
    [selected.evidence],
    normalized.conflicts,
  );

  return {
    status: proposal.status,
    payload: proposal.snapshot,
    evidenceCount: 1,
    proposalId: proposal.proposalId,
  };
}

function selectResultRefreshRace(meeting: NormalizedMeeting, requestedRaceNumber?: number | null) {
  const now = Date.now();
  const startedRaces = meeting.races.filter((race) => Date.parse(race.startsAt) <= now);
  if (requestedRaceNumber != null) {
    return startedRaces.find((race) => race.raceNumber === requestedRaceNumber) ?? null;
  }
  return startedRaces.find((race) =>
    !race.resultSummary || race.runners.some((runner) => runner.resultPosition == null)
  ) ?? startedRaces.at(-1);
}

async function prepareTaskForHermes(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
): Promise<{ task?: RaceFeedTask; result?: TaskResult }> {
  if (task.task_type !== "result_refresh") return { task };
  if (!task.meeting_id) {
    throw new Error("Result refresh task is missing a meeting ID.");
  }
  const current = await loadMeetingSnapshot(serviceClient, task.meeting_id);
  const targetRace = selectResultRefreshRace(current.meeting, task.race_number);
  if (!targetRace) {
    return {
      result: {
        status: "skipped",
        payload: {
          reason: task.race_number == null
            ? "No race has started yet."
            : `Race ${task.race_number} is not available or has not started.`,
        },
        evidenceCount: 0,
      },
    };
  }
  if (task.fixture_id && task.race_number == null) {
    throw new Error("A per-fixture result task must include its race number.");
  }
  return { task: {
    ...task,
    venue: current.meeting.venue,
    meeting_date: current.meeting.meetingDate,
    race_number: targetRace.raceNumber,
    task_payload: { ...task.task_payload, currentMeeting: current.meeting },
  } };
}

async function handleManualResearch(
  serviceClient: ServiceClient,
  task: RaceFeedTask,
  settings: FeedSettings,
  configuration: WorkerConfiguration,
) {
  if (task.venue && task.meeting_date) {
    return await handleMeetingSchedule(serviceClient, task, configuration);
  }
  return await handleWeeklyCalendar(serviceClient, task, settings, configuration);
}

function hermesDelegationMode() {
  return (Deno.env.get("MRC_HERMES_DELEGATION_MODE") ?? "explicit")
    .trim()
    .toLowerCase();
}

function shouldDelegateToHermes(task: RaceFeedTask) {
  const mode = hermesDelegationMode();
  if (mode === "disabled") return false;
  if (mode === "all") return true;
  if (mode === "result_refresh" || mode === "results") {
    return task.task_type === "result_refresh";
  }
  return task.task_payload.delegate_to_hermes === true ||
    task.task_payload.provider === "hermes";
}

function requiredFieldsForHermesTask(taskType: RaceFeedTask["task_type"]) {
  switch (taskType) {
    case "weekly_calendar":
      return ["venue", "countryCode", "meetingDate", "status"];
    case "meeting_schedule":
      return [
        "venue",
        "meetingDate",
        "races",
        "raceNumber",
        "title",
        "startsAt",
        "distanceMetres",
      ];
    case "race_detail":
      return [
        "race",
        "runners",
        "horseName",
        "jockeyName",
        "trainerName",
        "draw",
        "carriedWeight",
        "status",
      ];
    case "result_refresh":
      return [
        "race",
        "runners",
        "horseName",
        "jockeyName",
        "trainerName",
        "draw",
        "carriedWeight",
        "status",
        "resultPosition",
      ];
    default:
      return ["meetings", "races", "runners", "sources"];
  }
}

async function delegateTaskToHermes(
  supabaseUrl: string,
  task: RaceFeedTask,
): Promise<TaskResult> {
  const internalToken = Deno.env.get("MRC_HERMES_INTERNAL_TOKEN") ?? "";
  if (internalToken.length < 32) {
    throw new Error("MRC_HERMES_INTERNAL_TOKEN is missing or too short.");
  }

  const configuredSources = (Deno.env.get("MRC_HERMES_PERMITTED_SOURCES") ?? "")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  const permittedSources = Array.isArray(task.task_payload.permitted_sources)
    ? task.task_payload.permitted_sources
    : configuredSources;
  if (permittedSources.length === 0) {
    throw new Error(
      "Hermes delegation requires MRC_HERMES_PERMITTED_SOURCES or an explicit task allowlist.",
    );
  }

  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { scheduleEvidence: _storedEvidence, ...safeTaskPayload } =
    task.task_payload;
  const response = await fetch(
    `${supabaseUrl}/functions/v1/hermes-race-bridge/jobs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mrc-internal-token": internalToken,
      },
      body: JSON.stringify({
        correlation_id: `race-feed:${task.id}:${task.run_id}`,
        schema_version: 1,
        task_type: task.task_type,
        source_task_id: task.id,
        source_run_id: task.run_id,
        venue: task.venue,
        meeting_date: task.meeting_date,
        race_number: task.race_number,
        required_fields: requiredFieldsForHermesTask(task.task_type),
        permitted_sources: permittedSources,
        task_payload: {
          ...safeTaskPayload,
          taskKey: task.task_key,
          meetingId: task.meeting_id,
          fixtureId: task.fixture_id,
          meetingExternalId: task.meeting_external_id,
        },
        deadline,
      }),
    },
  );
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    throw new Error(
      `Hermes race bridge rejected the task: ${String(payload.error ?? response.status)}`,
    );
  }

  return {
    status: "pending_approval",
    payload: {
      delegatedTo: "hermes-race-bridge",
      bridge: payload,
      deadline,
    },
    evidenceCount: 0,
  };
}

function searchFromEvidence(evidence: GroundingEvidence[]): GroundedSearchResult {
  return {
    text: evidence.map((item) => item.excerpt ?? "").filter(Boolean).join("\n\n"),
    evidence,
  };
}

function chunkEvidence(items: GroundingEvidence[], size: number, maximumChunks: number) {
  const chunks: GroundingEvidence[][] = [];
  for (let index = 0; index < items.length && chunks.length < maximumChunks; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function calendarEvidenceScore(item: GroundingEvidence, expectedStart: string, expectedEnd: string) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const searchable = `${item.title ?? ""}\n${item.url}\n${item.excerpt ?? ""}`.toLowerCase();
  let score = 0;
  for (let date = expectedStart; date <= expectedEnd; date = addCalendarDays(date, 1)) {
    const [year, month, day] = date.split("-").map(Number);
    const longDate = `${day} ${monthNames[month - 1]} ${year}`.toLowerCase();
    if (searchable.includes(date)) score += 8;
    if (searchable.includes(longDate)) score += 8;
  }
  if (/fixture|calendar/.test(searchable)) score += 2;
  return score;
}

function evidenceSupportsCalendarMeeting(
  evidence: GroundingEvidence[],
  meeting: ReturnType<typeof normalizeMeetingIdentity>,
) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const [year, month, day] = meeting.meetingDate.split("-").map(Number);
  const longDate = `${day} ${monthNames[month - 1]} ${year}`.toLowerCase();
  const venue = slugify(meeting.venue).replace(/^hollywoodbets-/, "");
  const aliases = venue === "greyville"
    ? ["greyville", "grey-turf", "grey-poly"]
    : venue === "scottsville"
    ? ["scottsville", "scot"]
    : [venue];

  return evidence.some((item) => {
    const searchable = `${item.title ?? ""}\n${item.url}\n${item.excerpt ?? ""}`.toLowerCase();
    const slugged = slugify(searchable);
    const hasVenue = aliases.some((alias) => slugged.includes(alias));
    const hasDate = searchable.includes(meeting.meetingDate) || searchable.includes(longDate);
    return hasVenue && hasDate;
  });
}

function raceEvidenceScore(
  item: GroundingEvidence,
  expected: { venue: string; meetingDate: string; raceNumber: number },
) {
  const meeting = normalizeMeetingIdentity({
    venue: expected.venue,
    countryCode: "ZA",
    meetingDate: expected.meetingDate,
    status: "scheduled",
  });
  let score = evidenceSupportsCalendarMeeting([item], meeting) ? 30 : 0;
  const path = new URL(item.url).pathname.toLowerCase();
  if (path.includes(expected.meetingDate)) score += 15;
  if (new RegExp(`(?:/|race[-_/]?)${expected.raceNumber}(?:/|$)`, "i").test(path)) score += 20;
  if (new RegExp(`\\brace\\s*${expected.raceNumber}\\b`, "i").test(`${item.title ?? ""}\n${item.excerpt ?? ""}`)) {
    score += 10;
  }
  const domainScores: Record<string, number> = {
    "timeformracing.com": 20,
    "sportinglife.com": 18,
    "racingtv.com": 16,
    "zeturf.nl": 14,
    "trotto.de": 12,
    "form-guide.com.au": 6,
  };
  return score + (domainScores[item.domain] ?? 0);
}

async function extractCalendarEvidence(
  configuration: WorkerConfiguration,
  search: GroundedSearchResult,
  expectedStart: string,
  expectedEnd: string,
) {
  const meetings = new Map<string, ReturnType<typeof normalizeMeetingIdentity>>();
  const conflicts: Conflict[] = [];
  const successfulEvidence: GroundingEvidence[] = [];
  const errors: string[] = [];

  const rankedEvidence = [...search.evidence].sort(
    (left, right) => calendarEvidenceScore(right, expectedStart, expectedEnd) -
      calendarEvidenceScore(left, expectedStart, expectedEnd),
  );
  for (const evidence of chunkEvidence(rankedEvidence, 2, 3)) {
    try {
      const extraction = await extractStructured<CalendarExtraction>(
        configuration,
        calendarSchema,
        `Extract every distinct South African horse-racing meeting explicitly evidenced from ${expectedStart} through ${expectedEnd}. Missing an evidenced meeting is an extraction error. Do not include races or runners and do not infer unsupported meetings.`,
        searchFromEvidence(evidence),
        {
          maxCompletionTokens: 550,
          maxEvidenceCharacters: 3_500,
          maxEvidenceItems: 2,
          maxExcerptCharacters: 1_750,
        },
      );
      assertNoBettingData(extraction);
      for (const item of extraction.meetings) {
        const normalized = normalizeMeetingIdentity(item);
        if (normalized.meetingDate < expectedStart || normalized.meetingDate > expectedEnd) continue;
        if (!evidenceSupportsCalendarMeeting(evidence, normalized)) {
          errors.push(`${normalized.venue} ${normalized.meetingDate} was not jointly supported by one source.`);
          continue;
        }
        meetings.set(meetingKey(normalized.venue, normalized.meetingDate), normalized);
      }
      conflicts.push(...normalizeConflict(extraction.conflicts));
      successfulEvidence.push(...evidence);
    } catch (error) {
      errors.push(sanitizeError(error));
    }
  }

  if (!meetings.size && errors.length) {
    throw new Error(`No calendar evidence produced a valid meeting. ${errors.join(" ")}`);
  }

  return {
    meetings: [...meetings.values()],
    conflicts,
    evidence: deduplicateEvidence(successfulEvidence),
    errors,
  };
}

async function extractBestSchedule(
  configuration: WorkerConfiguration,
  search: GroundedSearchResult,
  venue: string,
  meetingDate: string,
) {
  const candidates: Array<{
    normalized: ReturnType<typeof normalizeSchedule>;
    evidence: GroundingEvidence[];
  }> = [];
  const errors: string[] = [];

  for (const evidence of chunkEvidence(search.evidence, 2, 5)) {
    try {
      const extraction = await extractStructured<MeetingScheduleExtraction>(
        configuration,
        scheduleSchema,
        `Extract only races explicitly detailed for exactly ${venue}, South Africa, on ${meetingDate}. A page may list other race times in navigation: never apply the current page title or distance to those navigation times. Include a race only when the supplied evidence supports that same race number, start time, title and distance. Do not include runners and do not infer missing facts.`,
        searchFromEvidence(evidence),
        {
          maxCompletionTokens: 650,
          maxEvidenceCharacters: 3_500,
          maxEvidenceItems: 2,
          maxExcerptCharacters: 1_750,
        },
      );
      const normalized = normalizeSchedule(extraction);
      if (slugify(normalized.meeting.venue) !== slugify(venue) || normalized.meeting.meetingDate !== meetingDate) {
        throw new Error("Meeting schedule identity does not match the requested task.");
      }
      const snippetOnly = evidence.every((item) => item.factPayload.retrievalMethod === "search_snippet");
      if (snippetOnly && normalized.meeting.races.length > evidence.length) {
        throw new Error("Search snippets cannot support more detailed races than supplied evidence pages.");
      }
      if (normalized.meeting.races.some((race) =>
        !race.title || /^race \d+$/i.test(race.title) || race.distanceMetres == null ||
        johannesburgHour(race.startsAt) < 8 || johannesburgHour(race.startsAt) > 22
      )) {
        throw new Error("A schedule source omitted a required race title, distance or plausible local time.");
      }
      candidates.push({ normalized, evidence });
    } catch (error) {
      errors.push(`${evidence.map((item) => item.domain).join(", ")}: ${sanitizeError(error)}`);
    }
  }

  if (!candidates.length) throw new Error(`No source produced a valid meeting schedule. ${errors.join(" ")}`);

  const races = new Map<number, ReturnType<typeof normalizeSchedule>["meeting"]["races"][number]>();
  const conflicts: Conflict[] = [];
  for (const candidate of candidates) {
    conflicts.push(...candidate.normalized.conflicts);
    for (const race of candidate.normalized.meeting.races) {
      const current = races.get(race.raceNumber);
      if (!current) {
        races.set(race.raceNumber, race);
        continue;
      }
      if (JSON.stringify(current) !== JSON.stringify(race)) {
        conflicts.push({
          field: `race_${race.raceNumber}`,
          description: "Independent schedule evidence disagrees for this race.",
          material: true,
          sources: candidate.evidence.map((item) => item.url),
        });
      }
    }
  }
  const first = candidates[0].normalized.meeting;
  const sortedRaces = [...races.values()].sort((left, right) => left.raceNumber - right.raceNumber);
  if (sortedRaces.length < 6 || sortedRaces.some((race, index) => race.raceNumber !== index + 1)) {
    throw new Error("The merged schedule is incomplete or has non-contiguous race numbers.");
  }
  const normalizedTitles = sortedRaces.map((race) => slugify(race.title));
  if (new Set(normalizedTitles).size !== normalizedTitles.length) {
    throw new Error("The merged schedule repeats a race title and may contain inferred navigation data.");
  }
  const normalized = {
    meeting: { ...first, races: sortedRaces },
    conflicts,
  };
  return {
    normalized,
    evidence: deduplicateEvidence(candidates.flatMap((candidate) => candidate.evidence)),
    errors,
  };
}

async function extractBestRaceDetail(
  configuration: WorkerConfiguration,
  search: GroundedSearchResult,
  expected: { venue: string; meetingDate: string; raceNumber: number; startTime?: string | null },
) {
  const candidates: Array<{
    normalized: ReturnType<typeof normalizeRaceDetail>;
    evidence: GroundingEvidence;
    score: number;
  }> = [];
  const errors: string[] = [];

  const rankedEvidence = [...search.evidence].sort(
    (left, right) => raceEvidenceScore(right, expected) - raceEvidenceScore(left, expected),
  );
  for (const evidence of rankedEvidence.slice(0, 5)) {
    try {
      const extraction = parseKnownRaceDetailEvidence(evidence, expected) ??
        await extractStructured<RaceDetailExtraction>(
          configuration,
          raceDetailSchema,
          `Extract exactly race ${expected.raceNumber} at ${expected.venue}, South Africa, on ${expected.meetingDate}, including every evidenced runner. Racecard pages may repeat each runner in desktop and mobile layouts: return each saddle number exactly once. Do not infer missing runners, jockeys, trainers, draws, weights, scratches or results.`,
          searchFromEvidence([evidence]),
          {
            maxCompletionTokens: 1_200,
            maxEvidenceCharacters: 8_000,
            maxEvidenceItems: 1,
            maxExcerptCharacters: 8_000,
          },
        );
      const normalized = normalizeRaceDetail(extraction, expected);
      if (expected.startTime) {
        const extractedStartTime = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Africa/Johannesburg",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(normalized.race.startsAt));
        if (extractedStartTime !== expected.startTime) {
          throw new Error("Extracted race time does not match the staged meeting schedule.");
        }
      }
      const declaredRunnerCount = Number(
        evidence.excerpt?.match(/Runners\s*:\s*(\d+)\s+runners?/i)?.[1] ?? 0,
      );
      if (declaredRunnerCount > 0 && normalized.race.runners.length !== declaredRunnerCount) {
        throw new Error("Extracted runner count does not match the source racecard.");
      }
      if (
        evidence.domain === "timeformracing.com" &&
        normalized.race.runners.some((runner) => runner.carriedWeight == null)
      ) {
        throw new Error("Timeform extraction omitted a carried weight.");
      }
      const score = normalized.race.runners.length * 10 + normalized.race.runners.reduce(
        (total, runner) => total + Number(Boolean(runner.jockeyName)) + Number(Boolean(runner.trainerName)) +
          Number(runner.draw != null) + Number(runner.carriedWeight != null),
        0,
      );
      candidates.push({ normalized, evidence, score });
      if (normalized.race.runners.length >= 5) break;
    } catch (error) {
      errors.push(`${evidence.domain}: ${sanitizeError(error)}`);
    }
  }

  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  if (!selected) throw new Error(`No source produced a valid runner list. ${errors.join(" ")}`);
  return { ...selected, errors };
}

function normalizeGuidance(value: unknown) {
  const guidance = String(value ?? "").replace(/\0/g, "").trim();
  if (guidance.length > 500) throw new Error("Additional search guidance cannot exceed 500 characters.");
  return guidance;
}

function normalizeManualQuery(value: unknown) {
  const query = String(value ?? "").replace(/\0/g, "").trim();
  if (query.length < 10 || query.length > 1500) {
    throw new Error("A manual Ollama query must contain between 10 and 1,500 characters.");
  }
  return query;
}

function buildSearchOnlyQuery(scope: SearchTrialScope) {
  if (scope.canonicalQuery) return scope.canonicalQuery;

  const guidance = scope.additionalGuidance
    ? ` Administrator guidance: ${scope.additionalGuidance}`
    : "";

  if (scope.searchType === "upcoming_calendar") {
    return `Find public source pages that document South African thoroughbred horse-racing meetings scheduled from ${scope.dateFrom} through ${scope.dateTo} inclusive in Africa/Johannesburg. Prioritize racing calendars and meeting schedules. Return search evidence only. Ignore odds, dividends, payouts and betting controls.${guidance}`;
  }

  return `Find public source pages containing the complete horse-racing meeting schedule and racecard details for ${scope.venue} in South Africa on ${scope.meetingDate}. Prioritize race numbers, start times, distances, race titles, saddle numbers, horse names, jockeys, trainers, draws, carried weights and scratch status. Return search evidence only. Ignore odds, dividends, payouts and betting controls.${guidance}`;
}

async function resolveSearchTrialScope(
  serviceClient: ServiceClient,
  requestBody: SyncRequest,
): Promise<SearchTrialScope> {
  const retryTrialId = String(requestBody.retryTrialId ?? "").trim() || null;
  const additionalGuidance = normalizeGuidance(requestBody.additionalGuidance);

  if (retryTrialId) {
    const { data, error } = await serviceClient
      .from("race_search_trials")
      .select("id,search_type,query_mode,canonical_query,parent_trial_id,date_from,date_to,venue,meeting_date,additional_guidance,status")
      .eq("id", retryTrialId)
      .single();
    if (error || !data) throw new Error("The race search trial selected for retry was not found.");
    if (data.status === "running") throw new Error("A running race search trial cannot be retried.");

    return {
      searchType: data.search_type as SearchTrialScope["searchType"],
      queryMode: data.query_mode as SearchTrialScope["queryMode"],
      canonicalQuery: data.canonical_query,
      parentTrialId: data.parent_trial_id,
      retryTrialId,
      dateFrom: data.date_from,
      dateTo: data.date_to,
      venue: data.venue,
      meetingDate: data.meeting_date,
      additionalGuidance: data.additional_guidance || "",
    };
  }

  const searchType = requestBody.searchType === "meeting_detail"
    ? "meeting_detail"
    : "upcoming_calendar";
  if (searchType === "upcoming_calendar") {
    const queryMode = requestBody.queryMode === "manual" ? "manual" : "recommended";
    if (queryMode === "manual" && additionalGuidance) {
      throw new Error("Manual Ollama queries cannot include separate search guidance.");
    }
    const dateFrom = johannesburgDate(new Date().toISOString());
    return {
      searchType,
      queryMode,
      canonicalQuery: queryMode === "manual" ? normalizeManualQuery(requestBody.manualQuery) : null,
      parentTrialId: null,
      retryTrialId: null,
      dateFrom,
      dateTo: addCalendarDays(dateFrom, 6),
      venue: null,
      meetingDate: null,
      additionalGuidance: queryMode === "recommended" ? additionalGuidance : "",
    };
  }

  if (requestBody.queryMode === "manual" || requestBody.manualQuery !== undefined) {
    throw new Error("Manual queries are limited to upcoming-calendar searches.");
  }

  const parentTrialId = String(requestBody.parentTrialId ?? "").trim() || null;
  const venue = String(requestBody.venue ?? "").replace(/\0/g, "").trim();
  const meetingDate = String(requestBody.meetingDate ?? "").trim();
  if (!parentTrialId || venue.length < 2 || venue.length > 120) {
    throw new Error("Meeting-detail searches require an approved parent search and a valid venue.");
  }
  assertDate(meetingDate, "Meeting date");

  return {
    searchType,
    queryMode: "recommended",
    canonicalQuery: null,
    parentTrialId,
    retryTrialId: null,
    dateFrom: meetingDate,
    dateTo: meetingDate,
    venue,
    meetingDate,
    additionalGuidance,
  };
}

function searchErrorCode(error: unknown) {
  const message = sanitizeError(error);
  if (/429|quota|rate.?limit/i.test(message)) return "provider_rate_limit";
  if (/abort|timeout|timed out/i.test(message)) return "provider_timeout";
  if (/no usable race evidence/i.test(message)) return "empty_search_results";
  if (/json|response/i.test(message)) return "invalid_provider_response";
  return "race_search_failed";
}

async function handleSearchOnlyRequest(
  request: Request,
  serviceClient: ServiceClient,
  requestBody: SyncRequest,
  actorId: string,
) {
  const configuration = loadSearchOnlyConfiguration();
  const scope = await resolveSearchTrialScope(serviceClient, requestBody);
  const canonicalQuery = buildSearchOnlyQuery(scope);
  const { data: claimData, error: claimError } = await serviceClient.rpc("claim_race_search_trial", {
    p_created_by: actorId,
    p_search_type: scope.searchType,
    p_canonical_query: canonicalQuery,
    p_date_from: scope.dateFrom,
    p_date_to: scope.dateTo,
    p_venue: scope.venue,
    p_meeting_date: scope.meetingDate,
    p_additional_guidance: scope.additionalGuidance || null,
    p_parent_trial_id: scope.parentTrialId,
    p_retry_of_trial_id: scope.retryTrialId,
    p_provider_name: configuration.searchProvider,
    p_provider_model: configuration.searchModel,
    p_query_mode: scope.queryMode,
  });
  if (claimError) return jsonResponse(request, { error: sanitizeError(claimError) }, 400);

  const claim = (claimData ?? {}) as JsonRecord;
  if (claim.status === "search_limit_reached") {
    return jsonResponse(request, claim, 429);
  }
  const trialId = String(claim.trialId ?? "");
  if (!trialId) return jsonResponse(request, { error: "Could not create the race search trial." }, 500);

  try {
    const context = await loadSearchOnlyContext(serviceClient);
    const search = await ollamaWebSearchOnly(
      configuration,
      canonicalQuery,
      scope.searchType,
      context,
    );
    const statusByDomain = new Map(context.sourcePolicies.map((policy) => [policy.domain, policy.status]));
    const results = search.evidence.slice(0, maximumSearchLabResults).map((item) => ({
      title: item.title,
      url: item.url,
      domain: item.domain,
      excerpt: item.excerpt?.slice(0, 700) ?? null,
      retrievedAt: item.retrievedAt,
      sourceStatus: statusByDomain.get(item.domain) ?? "evidence_only",
    }));
    const uniqueDomainCount = new Set(results.map((item) => item.domain)).size;
    const { error: completionError } = await serviceClient.rpc("complete_race_search_trial", {
      p_trial_id: trialId,
      p_status: "succeeded",
      p_results: results,
      p_unique_domain_count: uniqueDomainCount,
    });
    if (completionError) throw new Error(`Could not save race search evidence: ${completionError.message}`);

    return jsonResponse(request, {
      status: "succeeded",
      trialId,
      searchType: scope.searchType,
      queryMode: scope.queryMode,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      resultCount: results.length,
      uniqueDomainCount,
      providerRequestCount: configuration.telemetry.searchRequests,
      pageFetchCount: configuration.telemetry.fetchRequests,
      extractionRequestCount: configuration.telemetry.extractionRequests,
    });
  } catch (error) {
    const safeError = sanitizeError(error);
    await serviceClient.rpc("complete_race_search_trial", {
      p_trial_id: trialId,
      p_status: "failed",
      p_results: [],
      p_unique_domain_count: 0,
      p_error_code: searchErrorCode(error),
      p_error_message: safeError,
    });

    return jsonResponse(request, {
      status: "failed",
      trialId,
      error: safeError,
    }, /429|quota|rate.?limit/i.test(safeError) ? 429 : 502);
  }
}

async function handlePilotExtractionRequest(
  request: Request,
  serviceClient: ServiceClient,
  requestBody: SyncRequest,
) {
  const configuration = await loadConfiguration(serviceClient);
  const pilotType = requestBody.pilotType === "search_evidence"
    ? "search_evidence"
    : requestBody.pilotType === "race_detail"
    ? "race_detail"
    : requestBody.pilotType === "meeting_schedule"
    ? "meeting_schedule"
    : "calendar";
  const query = normalizeManualQuery(requestBody.pilotQuery);
  const context = await loadSearchOnlyContext(serviceClient);
  const sourceUrls = Array.isArray(requestBody.sourceUrls)
    ? requestBody.sourceUrls.map((url) => String(url ?? "").trim()).filter(Boolean).slice(0, 3)
    : [];
  const search = sourceUrls.length
    ? await ollamaWebFetchOnly(configuration, sourceUrls, `pilot_${pilotType}`, context)
    : await ollamaWebSearchOnly(configuration, query, `pilot_${pilotType}`, context);

  if (pilotType === "search_evidence") {
    return jsonResponse(request, {
      status: "succeeded",
      pilotType,
      evidence: search.evidence.map((item) => ({
        title: item.title,
        url: item.url,
        domain: item.domain,
        excerpt: item.excerpt?.slice(0, 900) ?? null,
      })),
      telemetry: configuration.telemetry,
    });
  }

  if (pilotType === "calendar") {
    const dateFrom = String(requestBody.dateFrom ?? "").trim();
    const dateTo = String(requestBody.dateTo ?? "").trim();
    assertDate(dateFrom, "Pilot start date");
    assertDate(dateTo, "Pilot end date");
    if (dateTo < dateFrom || dateTo > addCalendarDays(dateFrom, 6)) {
      throw new Error("The calendar pilot must use a valid window of no more than seven days.");
    }
    const extracted = await extractCalendarEvidence(configuration, search, dateFrom, dateTo);
    const extraction = {
      weekStart: `${dateFrom}T00:00:00+02:00`,
      weekEnd: `${dateTo}T23:59:59+02:00`,
      meetings: extracted.meetings,
      conflicts: extracted.conflicts,
    };

    return jsonResponse(request, {
      status: "succeeded",
      pilotType,
      extraction,
      evidence: extracted.evidence.map((item) => ({
        title: item.title,
        url: item.url,
        domain: item.domain,
        excerpt: item.excerpt?.slice(0, 700) ?? null,
      })),
      telemetry: configuration.telemetry,
    });
  }

  const venue = String(requestBody.venue ?? "").replace(/\0/g, "").trim();
  const meetingDate = String(requestBody.meetingDate ?? "").trim();
  if (venue.length < 2 || venue.length > 120) throw new Error("The meeting pilot requires a valid venue.");
  assertDate(meetingDate, "Pilot meeting date");
  const raceNumber = Number(requestBody.raceNumber);
  if (pilotType === "race_detail" && (!Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 30)) {
    throw new Error("The race-detail pilot requires a valid race number.");
  }
  const extractionInputs = sourceUrls.length
    ? search.evidence.map((item) => ({ text: item.excerpt ?? "", evidence: [item] }))
    : [search];
  const sourceExtractions: Array<{
    sourceUrl: string;
    sourceDomain: string;
    extraction: RaceDetailExtraction | MeetingScheduleExtraction;
    normalized: ReturnType<typeof normalizeRaceDetail> | ReturnType<typeof normalizeSchedule>;
  }> = [];
  const sourceErrors: Array<{ sourceUrl: string; sourceDomain: string; error: string }> = [];

  for (const input of extractionInputs) {
      const source = input.evidence[0];
      try {
        const extraction = pilotType === "race_detail"
        ? parseKnownRaceDetailEvidence(source, { venue, meetingDate, raceNumber }) ??
          await extractStructured<RaceDetailExtraction>(
            configuration,
            raceDetailSchema,
            `Extract exactly race ${raceNumber} at ${venue}, South Africa, on ${meetingDate}, including race facts and every evidenced runner. Do not infer missing runners, jockeys, trainers, draws, weights, scratches or results.`,
            input,
            {
              maxCompletionTokens: 1_800,
              maxEvidenceCharacters: 8_000,
              maxEvidenceItems: 1,
              maxExcerptCharacters: 8_000,
            },
          )
        : await extractStructured<MeetingScheduleExtraction>(
          configuration,
          scheduleSchema,
          `Extract the complete race schedule for exactly ${venue}, South Africa, on ${meetingDate}. Do not include runners. Do not infer missing races, times, titles or distances.`,
          input,
          {
            maxCompletionTokens: 1_350,
            maxEvidenceCharacters: 6_000,
            maxEvidenceItems: 1,
            maxExcerptCharacters: 6_000,
          },
        );
      assertNoBettingData(extraction);
      const normalized = pilotType === "race_detail"
        ? normalizeRaceDetail(extraction as RaceDetailExtraction, { venue, meetingDate, raceNumber })
        : normalizeSchedule(extraction as MeetingScheduleExtraction);
      sourceExtractions.push({
        sourceUrl: source?.url ?? "search-evidence",
        sourceDomain: source?.domain ?? "search-evidence",
        extraction,
        normalized,
      });
    } catch (error) {
      sourceErrors.push({
        sourceUrl: source?.url ?? "search-evidence",
        sourceDomain: source?.domain ?? "search-evidence",
        error: sanitizeError(error),
      });
    }
  }

  if (!sourceExtractions.length) {
    throw new Error(`No selected source produced a valid extraction. ${sourceErrors.map((item) => `${item.sourceDomain}: ${item.error}`).join(" ")}`);
  }

  const selected = sourceExtractions[0];
  const signatures = sourceExtractions.map((item) => {
    if (pilotType === "race_detail") {
      const detail = item.normalized as ReturnType<typeof normalizeRaceDetail>;
      return JSON.stringify({
        meeting: detail.meeting,
        race: { ...detail.race, sourceUpdatedAt: undefined },
        conflicts: detail.conflicts,
      });
    }
    return JSON.stringify(item.normalized);
  });
  const agreementStatus = sourceExtractions.length < 2
    ? "single_source"
    : signatures.every((signature) => signature === signatures[0])
    ? "matched"
    : "conflict";
  const successfulEvidence = search.evidence.filter((item) =>
    sourceExtractions.some((attempt) => attempt.sourceUrl === item.url)
  );
  const validation = buildPilotValidation(pilotType, selected.normalized, successfulEvidence, sourceUrls.length);
  if (sourceErrors.length) {
    validation.warnings.push(`${sourceErrors.length} source extraction(s) failed validation.`);
  }
  if (agreementStatus === "conflict") {
    validation.warnings.push("Independent source extractions do not fully agree.");
  }
  validation.status = validation.warnings.length ? "review_required" : "complete";
  validation.eligibleForProposal = validation.warnings.length === 0;

  return jsonResponse(request, {
    status: "succeeded",
    pilotType,
    extraction: selected.extraction,
    normalized: selected.normalized,
    validation,
    agreementStatus,
    sourceExtractions,
    sourceErrors,
    evidenceMode: sourceUrls.length ? "selected_pages" : "search_snippets",
    evidence: search.evidence.map((item) => ({
      title: item.title,
      url: item.url,
      domain: item.domain,
      excerpt: item.excerpt?.slice(0, 700) ?? null,
    })),
    telemetry: configuration.telemetry,
  });
}

async function authorizeRequest(request: Request, serviceClient: ServiceClient): Promise<AuthorizationContext | null> {
  const workerToken = request.headers.get("x-mrc-worker-token") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");

  if (workerToken) {
    const { data, error } = await serviceClient.rpc("verify_race_worker_request", { p_token: workerToken });
    if (!error && data === true) return { kind: "cron", userId: null };
  }

  if (accessToken) {
    const { data, error } = await serviceClient.auth.getUser(accessToken);
    if (!error && data.user) {
      const { data: roles } = await serviceClient
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "administrator")
        .limit(1);
      if (roles?.length) return { kind: "administrator", userId: data.user.id };
    }
  }

  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, { error: "Supabase worker configuration is incomplete." }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authorizedAs = await authorizeRequest(request, serviceClient);
  if (!authorizedAs) {
    return jsonResponse(request, { error: "Race-feed worker authentication failed." }, 401);
  }

  const requestBody = await request.json().catch(() => ({})) as SyncRequest;
  if (requestBody.mode === "pilot_extract") {
    try {
      return await handlePilotExtractionRequest(request, serviceClient, requestBody);
    } catch (error) {
      const safeError = sanitizeError(error);
      return jsonResponse(request, { status: "failed", error: safeError }, /429|quota|rate.?limit/i.test(safeError) ? 429 : 502);
    }
  }
  if (requestBody.mode === "search_only") {
    if (authorizedAs.kind !== "administrator") {
      return jsonResponse(request, { error: "Administrator access is required for the Search Lab." }, 403);
    }
    return await handleSearchOnlyRequest(request, serviceClient, requestBody, authorizedAs.userId);
  }

  if (requestBody.mode === "hermes_weekly") {
    if (authorizedAs.kind !== "administrator") {
      return jsonResponse(request, {
        error: "Administrator access is required to queue a seven-day Hermes import.",
      }, 403);
    }
    const dateFrom = johannesburgDate(new Date().toISOString());
    const dateTo = addCalendarDays(dateFrom, 6);
    const { error: queueError } = await serviceClient.rpc(
      "queue_hermes_weekly_calendar",
      {
        p_created_by: authorizedAs.userId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_additional_guidance: String(requestBody.additionalGuidance ?? "").trim() || null,
      },
    );
    if (queueError) {
      return jsonResponse(request, { error: sanitizeError(queueError) }, 400);
    }
  }

  const trigger = authorizedAs.kind === "administrator"
    ? requestBody.trigger === "retry" ? "retry" : "manual"
    : "cron";
  const workerId = `sync-race-data:${crypto.randomUUID()}`;
  const claimRpc = ["result_refresh", "results"].includes(hermesDelegationMode())
    ? "claim_race_feed_result_task_plan"
    : "claim_race_feed_task_plan";
  const { data: claimed, error: claimError } = await serviceClient.rpc(claimRpc, {
    p_worker_id: workerId,
    p_trigger: trigger,
  });

  if (claimError) {
    return jsonResponse(request, { error: sanitizeError(claimError) }, 500);
  }
  if (!claimed) {
    return jsonResponse(request, { status: "idle", message: "No race-feed task is due." });
  }
  if ((claimed as JsonRecord).status === "search_limit_reached") {
    return jsonResponse(request, claimed, 429);
  }

  const task = (claimed as JsonRecord).task as RaceFeedTask;
  const settings = (claimed as JsonRecord).settings as FeedSettings;
  let searchCount = 0;
  let evidenceCount = 0;
  let configuration: WorkerConfiguration | null = null;

  try {
    let result: TaskResult;

    if (shouldDelegateToHermes(task)) {
      const { data: localTask, error: localTaskError } = await serviceClient.rpc(
        "prepare_hermes_race_task",
        { p_task_id: task.id, p_run_id: task.run_id },
      );
      if (localTaskError) {
        throw new Error(`Could not bind the task to native Hermes: ${localTaskError.message}`);
      }
      const prepared = await prepareTaskForHermes(
        serviceClient,
        (localTask ?? task) as RaceFeedTask,
      );
      result = prepared.result ??
        await delegateTaskToHermes(
          supabaseUrl,
          prepared.task ?? ((localTask ?? task) as RaceFeedTask),
        );
    } else {
      configuration = await loadConfiguration(serviceClient);
      await updateProviderTelemetry(serviceClient, task.run_id, configuration);

      switch (task.task_type) {
        case "weekly_calendar":
          result = await handleWeeklyCalendar(serviceClient, task, settings, configuration);
          break;
        case "meeting_schedule":
          result = await handleMeetingSchedule(serviceClient, task, configuration);
          break;
        case "race_detail":
          result = await handleRaceDetail(serviceClient, task, configuration);
          break;
        case "result_refresh":
          result = await handleResultRefresh(serviceClient, task, configuration);
          break;
        case "manual_research":
          result = await handleManualResearch(serviceClient, task, settings, configuration);
          break;
        default:
          throw new Error("Unsupported race-feed task type.");
      }
    }

    evidenceCount = result.evidenceCount;
    if (configuration) {
      searchCount = Math.max(
        configuration.telemetry.searchRequests,
        configuration.telemetry.extractionRequests,
      );
      await updateProviderTelemetry(serviceClient, task.run_id, configuration);
    }
    const { error: completionError } = await serviceClient.rpc("complete_race_feed_task_plan", {
      p_task_id: task.id,
      p_run_id: task.run_id,
      p_status: result.status,
      p_search_query_count: searchCount,
      p_evidence_count: evidenceCount,
      p_extracted_payload: result.payload,
    });
    if (completionError) throw new Error(`Could not complete race-feed task: ${completionError.message}`);

    return jsonResponse(request, {
      status: result.status,
      taskType: task.task_type,
      taskId: task.id,
      proposalId: result.proposalId ?? null,
      evidenceCount,
      providers: configuration
        ? {
          search: configuration.searchProvider,
          extraction: configuration.extractionProvider,
        }
        : {
          search: "hermes-race-bridge",
          extraction: "hermes-race-bridge",
        },
    });
  } catch (error) {
    let safeError = sanitizeError(error);
    if (configuration) {
      searchCount = Math.max(
        configuration.telemetry.searchRequests,
        configuration.telemetry.extractionRequests,
      );
      try {
        await updateProviderTelemetry(serviceClient, task.run_id, configuration);
      } catch (telemetryError) {
        safeError = sanitizeError(`${safeError} Provider telemetry: ${sanitizeError(telemetryError)}`);
      }
    }
    await serviceClient.rpc("complete_race_feed_task_plan", {
      p_task_id: task.id,
      p_run_id: task.run_id,
      p_status: "failed",
      p_error_code: "race_feed_task_failed",
      p_error_message: safeError,
      p_search_query_count: searchCount,
      p_evidence_count: evidenceCount,
    });

    return jsonResponse(request, {
      status: "failed",
      taskType: task.task_type,
      taskId: task.id,
      error: safeError,
    }, 502);
  }
});
