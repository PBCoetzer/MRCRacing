export type JsonRecord = Record<string, unknown>;

export const taskTypes = [
  "weekly_calendar",
  "meeting_schedule",
  "race_detail",
  "result_refresh",
  "manual_research",
] as const;

export type HermesRaceJobRequest = {
  correlation_id: string;
  schema_version: 1;
  task_type: typeof taskTypes[number];
  source_task_id?: string;
  source_run_id?: string;
  venue?: string;
  meeting_date?: string;
  race_number?: number;
  required_fields: string[];
  permitted_sources: string[];
  task_payload: JsonRecord;
  available_at?: string;
  deadline?: string;
};

export type HermesRaceSource = {
  domain: string;
  url: string;
  title?: string;
  retrieved_at: string;
  content_hash?: string;
  excerpt?: string;
};

export type HermesRaceResult = {
  job_id: string;
  correlation_id: string;
  schema_version: 1;
  status: "succeeded" | "partial" | "blocked";
  normalized_data: JsonRecord;
  sources: HermesRaceSource[];
  confidence: number;
  warnings: unknown[];
  conflicts: unknown[];
  evidence_hash: string;
  started_at: string;
  completed_at: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/i;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function stringValue(
  value: unknown,
  label: string,
  maxLength: number,
  required = true,
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function uuidValue(value: unknown, label: string, required = false) {
  const normalized = stringValue(value, label, 36, required);
  if (normalized && !uuidPattern.test(normalized)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return normalized;
}

function isoTimestamp(value: unknown, label: string, required = false) {
  const normalized = stringValue(value, label, 64, required);
  if (normalized && Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return normalized;
}

function isoDate(value: unknown, label: string) {
  const normalized = stringValue(value, label, 10, false);
  if (normalized && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  return normalized;
}

export function canonicalDomain(value: string) {
  let normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (normalized.includes("://")) {
    try {
      normalized = new URL(normalized).hostname.toLowerCase().replace(
        /\.$/,
        "",
      );
    } catch {
      throw new Error("Source domain or URL is invalid.");
    }
  }
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}

export function sourceMatchesPermittedDomain(
  sourceDomain: string,
  permittedSources: string[],
) {
  const source = canonicalDomain(sourceDomain);
  return permittedSources.some((item) => {
    const permitted = canonicalDomain(item);
    return source === permitted || source.endsWith(`.${permitted}`);
  });
}

function stringArray(value: unknown, label: string, maxItems = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(
      `${label} must be an array with at most ${maxItems} entries.`,
    );
  }
  return value.map((item, index) =>
    stringValue(item, `${label}[${index}]`, 500)
  );
}

export function validateJobRequest(value: unknown): HermesRaceJobRequest {
  const input = record(value, "Job");
  const correlationId = stringValue(
    input.correlation_id,
    "correlation_id",
    160,
  );
  const schemaVersion = input.schema_version === undefined
    ? 1
    : Number(input.schema_version);
  if (schemaVersion !== 1) throw new Error("schema_version must be 1.");

  const taskType = stringValue(input.task_type, "task_type", 40);
  if (!taskTypes.includes(taskType as typeof taskTypes[number])) {
    throw new Error("Unsupported task_type.");
  }

  const sourceTaskId = uuidValue(input.source_task_id, "source_task_id");
  const sourceRunId = uuidValue(input.source_run_id, "source_run_id");
  const meetingDate = isoDate(input.meeting_date, "meeting_date");
  const availableAt = isoTimestamp(input.available_at, "available_at");
  const deadline = isoTimestamp(input.deadline, "deadline");
  if (
    availableAt && deadline && Date.parse(deadline) <= Date.parse(availableAt)
  ) {
    throw new Error("deadline must be after available_at.");
  }

  let raceNumber: number | undefined;
  if (input.race_number !== undefined && input.race_number !== null) {
    raceNumber = Number(input.race_number);
    if (!Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 99) {
      throw new Error("race_number must be an integer between 1 and 99.");
    }
  }

  const payload = input.task_payload === undefined
    ? {}
    : record(input.task_payload, "task_payload");

  return {
    correlation_id: correlationId,
    schema_version: 1,
    task_type: taskType as HermesRaceJobRequest["task_type"],
    ...(sourceTaskId ? { source_task_id: sourceTaskId } : {}),
    ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
    ...(stringValue(input.venue, "venue", 160, false)
      ? { venue: stringValue(input.venue, "venue", 160, false) }
      : {}),
    ...(meetingDate ? { meeting_date: meetingDate } : {}),
    ...(raceNumber ? { race_number: raceNumber } : {}),
    required_fields: stringArray(input.required_fields, "required_fields"),
    permitted_sources: (() => {
      const sources = stringArray(
        input.permitted_sources,
        "permitted_sources",
        50,
      );
      if (sources.length < 1) {
        throw new Error("permitted_sources must not be empty.");
      }
      return [...new Set(sources.map((source) => canonicalDomain(source)))];
    })(),
    task_payload: payload,
    ...(availableAt ? { available_at: availableAt } : {}),
    ...(deadline ? { deadline } : {}),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export async function evidenceHash(sources: unknown) {
  const bytes = new TextEncoder().encode(stableStringify(sources));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

export async function validateResult(
  value: unknown,
): Promise<HermesRaceResult> {
  const input = record(value, "Result");
  const jobId = uuidValue(input.job_id, "job_id", true);
  const correlationId = stringValue(
    input.correlation_id,
    "correlation_id",
    160,
  );
  if (Number(input.schema_version) !== 1) {
    throw new Error("schema_version must be 1.");
  }

  const status = stringValue(input.status, "status", 20);
  if (!["succeeded", "partial", "blocked"].includes(status)) {
    throw new Error("Unsupported result status.");
  }

  const normalizedData = record(input.normalized_data, "normalized_data");
  if (
    !Array.isArray(input.sources) || input.sources.length < 1 ||
    input.sources.length > 50
  ) {
    throw new Error("sources must contain between 1 and 50 entries.");
  }
  const sources = input.sources.map((source, index) => {
    const item = record(source, `sources[${index}]`);
    const url = stringValue(item.url, `sources[${index}].url`, 2048);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`sources[${index}].url is invalid.`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`sources[${index}].url must use HTTPS.`);
    }
    const declaredDomain = canonicalDomain(
      stringValue(item.domain, `sources[${index}].domain`, 255),
    );
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const hostnameDomain = canonicalDomain(hostname);
    if (
      hostnameDomain !== declaredDomain &&
      !hostnameDomain.endsWith(`.${declaredDomain}`)
    ) {
      throw new Error(
        `sources[${index}].domain does not match its URL hostname.`,
      );
    }
    const retrievedAt = isoTimestamp(
      item.retrieved_at,
      `sources[${index}].retrieved_at`,
      true,
    );
    if (Date.parse(retrievedAt) > Date.now() + 5 * 60 * 1000) {
      throw new Error(`sources[${index}].retrieved_at is in the future.`);
    }
    return {
      domain: hostname,
      url,
      ...(stringValue(item.title, `sources[${index}].title`, 500, false)
        ? {
          title: stringValue(item.title, `sources[${index}].title`, 500, false),
        }
        : {}),
      retrieved_at: retrievedAt,
      ...(stringValue(
          item.content_hash,
          `sources[${index}].content_hash`,
          80,
          false,
        )
        ? {
          content_hash: stringValue(
            item.content_hash,
            `sources[${index}].content_hash`,
            80,
            false,
          ),
        }
        : {}),
      ...(stringValue(item.excerpt, `sources[${index}].excerpt`, 4000, false)
        ? {
          excerpt: stringValue(
            item.excerpt,
            `sources[${index}].excerpt`,
            4000,
            false,
          ),
        }
        : {}),
    };
  });

  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence must be between 0 and 1.");
  }
  if (!Array.isArray(input.warnings) || input.warnings.length > 100) {
    throw new Error("warnings must be an array.");
  }
  if (!Array.isArray(input.conflicts) || input.conflicts.length > 100) {
    throw new Error("conflicts must be an array.");
  }

  const suppliedHash = stringValue(input.evidence_hash, "evidence_hash", 71);
  if (!sha256Pattern.test(suppliedHash)) {
    throw new Error("evidence_hash must be a SHA-256 value.");
  }
  const expectedHash = await evidenceHash(sources);
  if (suppliedHash.toLowerCase() !== expectedHash) {
    throw new Error("evidence_hash does not match the submitted sources.");
  }

  const startedAt = isoTimestamp(input.started_at, "started_at", true);
  const completedAt = isoTimestamp(input.completed_at, "completed_at", true);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("completed_at precedes started_at.");
  }

  return {
    job_id: jobId,
    correlation_id: correlationId,
    schema_version: 1,
    status: status as HermesRaceResult["status"],
    normalized_data: normalizedData,
    sources,
    confidence,
    warnings: input.warnings,
    conflicts: input.conflicts,
    evidence_hash: expectedHash,
    started_at: startedAt,
    completed_at: completedAt,
  };
}

export function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
