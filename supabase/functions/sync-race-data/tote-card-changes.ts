import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;
type ServiceClient = SupabaseClient;

export type ToteCardChangeLink = {
  venue: string;
  url: string;
};

export type ToteRunnerChange = {
  raceNumber: number;
  saddleNumber: number;
  horseName: string;
  comment: string;
};

export type ToteScratchChange = ToteRunnerChange & {
  status: "reserve" | "scratched";
};

export type ToteJockeyChange = ToteRunnerChange & {
  jockeyName: string;
};

export type ToteCardChanges = {
  venue: string;
  meetingDate: string;
  observedAt: string;
  scratchings: ToteScratchChange[];
  jockeyChanges: ToteJockeyChange[];
};

type SecondaryChangeTarget = {
  meetingId: string;
  venue: string;
  meetingDate: string;
  cachedSourceUrl: string | null;
};

const toteBaseUrl = "https://www.tote.co.za";
const maximumSourceAgeMs = 10 * 60 * 1000;

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#x") || key.startsWith("#X")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return namedEntities[key.toLowerCase()] ?? entity;
  });
}

function htmlText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function positiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function absoluteToteUrl(value: string) {
  const decoded = decodeHtml(value);
  const url = new URL(decoded, toteBaseUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.tote.co.za") {
    throw new Error("Tote source URL is outside the approved host.");
  }
  return url.toString();
}

function sectionRows(html: string, heading: string) {
  const headingPattern = new RegExp(
    `<h3[^>]*>\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h3>`,
    "i",
  );
  const headingMatch = headingPattern.exec(html);
  if (!headingMatch) return [];
  const remainder = html.slice(headingMatch.index + headingMatch[0].length);
  const tableMatch = remainder.match(
    /<table\b[^>]*>[\s\S]*?<tbody\b[^>]*>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/i,
  );
  if (!tableMatch) return [];
  return [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) =>
      [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
        htmlText(cell[1])
      )
    )
    .filter((cells) => cells.length > 0);
}

export function canonicalRaceVenue(value: string) {
  return value
    .toLowerCase()
    .replace(/\bhollywoodbets\b/g, "")
    .replace(/\bturffontein\s+(inside|standside)\b/g, "turffontein")
    .replace(/\bracecourse\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeJockeyName(value: string) {
  const cleaned = value.replace(/^\*\s*/, "").replace(/\.{3,}/g, "").trim();
  if (!cleaned) return null;
  const claimMatch = cleaned.match(
    /^(.*?)\s*\(\s*-(\d+(?:\.\d+)?)\s*kg\s*\)\s*$/i,
  );
  if (!claimMatch) return cleaned;
  const claim = Number.parseFloat(claimMatch[2]);
  const formattedClaim = String(claim);
  return `${claimMatch[1].trim()}-${formattedClaim}`;
}

function normalizeHorseName(value: string) {
  return value.replace(/\s*\(\s*draw\s+\d+\s*\)\s*$/i, "").trim();
}

function johannesburgTimestamp(
  day: string,
  month: string,
  year: string,
  time: string,
) {
  return `${year}-${month}-${day}T${time}+02:00`;
}

export function parseToteFixtureCardChangeLinks(
  html: string,
  expectedDate: string,
) {
  const compactDate = expectedDate.replaceAll("-", "");
  const links = new Map<string, ToteCardChangeLink>();
  for (
    const blockMatch of html.matchAll(
      /<div\s+class=["'][^"']*accordion-item[^"']*["'][^>]*>([\s\S]*?)(?=<div\s+class=["'][^"']*accordion-item|$)/gi,
    )
  ) {
    const block = blockMatch[1];
    const buttonMatch = block.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i);
    const linkMatch = block.match(
      /href=["']([^"']*\/fixtures\/card-changes\?[^"']+)["']/i,
    );
    if (!buttonMatch || !linkMatch) continue;
    const href = decodeHtml(linkMatch[1]);
    const parsedUrl = new URL(href, toteBaseUrl);
    if (parsedUrl.searchParams.get("date") !== compactDate) continue;
    const venue = htmlText(buttonMatch[1]).replace(/\s+[A-Z]{2,4}\s*$/, "")
      .trim();
    if (!venue) continue;
    const url = absoluteToteUrl(href);
    links.set(`${canonicalRaceVenue(venue)}:${url}`, { venue, url });
  }
  return [...links.values()];
}

export function parseToteCardChanges(html: string): ToteCardChanges {
  const headingMatch = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  const heading = headingMatch ? htmlText(headingMatch[1]) : "";
  const meetingMatch = heading.match(
    /^(.*?)\s+on\s+\w+\s+(\d{2})\/(\d{2})\/(\d{4})$/i,
  );
  if (!meetingMatch) {
    throw new Error("Tote card-change meeting identity was not found.");
  }

  const observedMatch = html.match(
    /As\s+at\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
  );
  if (!observedMatch) {
    throw new Error("Tote card-change source timestamp was not found.");
  }

  const scratchings = sectionRows(html, "Card Scratchings").flatMap((cells) => {
    if (cells.length < 4) return [];
    const raceNumber = positiveInteger(cells[0]);
    const saddleNumber = positiveInteger(cells[1]);
    const horseName = normalizeHorseName(cells[2]);
    const comment = cells[3].trim();
    if (!raceNumber || !saddleNumber || !horseName) return [];
    return [{
      raceNumber,
      saddleNumber,
      horseName,
      comment,
      status: /reserve\s+runner/i.test(comment)
        ? "reserve" as const
        : "scratched" as const,
    }];
  });

  const jockeyChanges = sectionRows(html, "Jockey Changes").flatMap((cells) => {
    if (cells.length < 4) return [];
    const raceNumber = positiveInteger(cells[0]);
    const saddleNumber = positiveInteger(cells[1]);
    const horseName = normalizeHorseName(cells[2]);
    const jockeyName = normalizeJockeyName(cells[3]);
    if (!raceNumber || !saddleNumber || !horseName || !jockeyName) return [];
    return [{
      raceNumber,
      saddleNumber,
      horseName,
      comment: cells[3],
      jockeyName,
    }];
  });

  return {
    venue: meetingMatch[1].trim(),
    meetingDate: `${meetingMatch[4]}-${meetingMatch[3]}-${meetingMatch[2]}`,
    observedAt: johannesburgTimestamp(
      observedMatch[1],
      observedMatch[2],
      observedMatch[3],
      observedMatch[4],
    ),
    scratchings,
    jockeyChanges,
  };
}

async function fetchToteHtml(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
      "User-Agent": "MRC-Racing-Secondary-Card-Change-Monitor/1.0",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Tote returned HTTP ${response.status}.`);
  return await response.text();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${
    [...new Uint8Array(digest)].map((item) =>
      item.toString(16).padStart(2, "0")
    ).join("")
  }`;
}

function johannesburgDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

async function recordFailure(
  serviceClient: ServiceClient,
  target: SecondaryChangeTarget,
  sourceUrl: string | null,
  error: unknown,
) {
  await serviceClient.rpc("record_secondary_race_change_failure", {
    p_meeting_id: target.meetingId,
    p_source_domain: "tote.co.za",
    p_source_url: sourceUrl,
    p_error_code: "secondary_tote_change_check_failed",
    p_error_message: error instanceof Error ? error.message : String(error),
  });
}

export async function syncSecondaryToteCardChanges(
  serviceClient: ServiceClient,
) {
  const localDate = johannesburgDate(new Date());
  const { data, error } = await serviceClient.rpc(
    "get_secondary_tote_change_targets",
    { p_local_date: localDate },
  );
  if (error) {
    throw new Error(
      `Could not load secondary card-change targets: ${error.message}`,
    );
  }
  const targets = Array.isArray(data) ? data as SecondaryChangeTarget[] : [];
  if (targets.length === 0) {
    return {
      status: "idle",
      checkedAt: new Date().toISOString(),
      meetings: [],
    };
  }

  let discoveredLinks: ToteCardChangeLink[] | null = null;
  const results: JsonRecord[] = [];
  for (const target of targets) {
    let sourceUrl = target.cachedSourceUrl;
    try {
      if (!sourceUrl) {
        if (!discoveredLinks) {
          const compactDate = localDate.replaceAll("-", "");
          const indexUrl = `${toteBaseUrl}/fixtures?date=${compactDate}`;
          discoveredLinks = parseToteFixtureCardChangeLinks(
            await fetchToteHtml(indexUrl),
            localDate,
          );
        }
        sourceUrl = discoveredLinks.find((link) =>
          canonicalRaceVenue(link.venue) === canonicalRaceVenue(target.venue)
        )?.url ?? null;
      }
      if (!sourceUrl) {
        throw new Error(
          `No Tote card-change page was found for ${target.venue}.`,
        );
      }

      const html = await fetchToteHtml(sourceUrl);
      const parsed = parseToteCardChanges(html);
      if (
        parsed.meetingDate !== target.meetingDate ||
        canonicalRaceVenue(parsed.venue) !== canonicalRaceVenue(target.venue)
      ) {
        throw new Error(
          "Tote card-change page does not match the requested meeting.",
        );
      }
      const sourceAge = Date.now() - Date.parse(parsed.observedAt);
      if (
        !Number.isFinite(sourceAge) || sourceAge < -5 * 60 * 1000 ||
        sourceAge > maximumSourceAgeMs
      ) {
        throw new Error(
          "Tote card-change page is stale or has an invalid source timestamp.",
        );
      }

      const { data: recorded, error: recordError } = await serviceClient.rpc(
        "record_secondary_race_change_list",
        {
          p_meeting_id: target.meetingId,
          p_source_domain: "tote.co.za",
          p_source_url: sourceUrl,
          p_source_observed_at: parsed.observedAt,
          p_content_hash: await sha256(html),
          p_changes: {
            scratchings: parsed.scratchings,
            jockeyChanges: parsed.jockeyChanges,
          },
        },
      );
      if (recordError) {
        throw new Error(
          `Could not record Tote comparison changes: ${recordError.message}`,
        );
      }
      results.push({
        meetingId: target.meetingId,
        venue: target.venue,
        status: "succeeded",
        result: recorded,
      });
    } catch (error) {
      await recordFailure(serviceClient, target, sourceUrl, error);
      results.push({
        meetingId: target.meetingId,
        venue: target.venue,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    status: results.some((result) => result.status === "failed")
      ? "partial"
      : "succeeded",
    checkedAt: new Date().toISOString(),
    meetings: results,
  };
}
