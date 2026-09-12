const websitePattern =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9.-]*\.(?:co\.za|com|net|org|io|app)\b\S*/gi;
const promotionalPattern =
  /\b(?:hollywoodbets|race\s*coast|gallop\s*tv|tabgold|4racing|lucky\s*fish|play\s*soccer|youcanbetonus|telebet|racing240|tote)\b/i;

function canonicalRaceClass(value: string | null | undefined) {
  let normalized = String(value ?? "").replace(websitePattern, " ").replace(
    /\s+/g,
    " ",
  ).trim();
  if (
    !normalized || promotionalPattern.test(normalized) ||
    normalized.length > 100
  ) return "";

  const exact = new Map<string, string>([
    ["mdn plate", "Maiden Plate"],
    ["open mdn", "Open Maiden"],
    ["mid stks", "Middle Stakes"],
    ["clsfd stks", "Classified Stakes"],
    ["pin stks", "Pinnacle Stakes"],
    ["con plate", "Conditions Plate"],
    ["hcp", "Handicap"],
  ]);
  normalized = exact.get(normalized.toLowerCase()) ?? normalized;
  return normalized
    .replace(/\bMdn\b/gi, "Maiden")
    .replace(/\bHCP\b/gi, "Handicap")
    .replace(/\bClsfd\b/gi, "Classified")
    .replace(/\bMid\b/gi, "Middle")
    .replace(/\bPin\b/gi, "Pinnacle")
    .replace(/\bCon\b/gi, "Conditions")
    .replace(/\bCHL\b/gi, "Challenge")
    .replace(/\bSpg\b/gi, "Spring")
    .replace(/\bStks\b/gi, "Stakes")
    .replace(/\bLadys\b/gi, "Ladies")
    .replace(/\s+/g, " ")
    .trim();
}

function classFromSource(sourceTitle: string) {
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/work\s+riders\s+maiden\s+plate/i, () => "Work Riders Maiden Plate"],
    [/open\s+maiden/i, () => "Open Maiden"],
    [/maiden\s+plate/i, () => "Maiden Plate"],
    [
      /\b(MR|FM)\s+(\d+)\s+(?:divided\s+)?handicap/i,
      (match) => `${match[1].toUpperCase()} ${match[2]} Handicap`,
    ],
    [
      /apprentice\s+([A-E])\s+stakes/i,
      (match) => `Apprentice ${match[1].toUpperCase()} Stakes`,
    ],
    [/\bclass\s+(\d+)\b/i, (match) => `Class ${match[1]}`],
    [/\b([A-E])\s+stakes\b/i, (match) => `${match[1].toUpperCase()} Stakes`],
    [/middle\s+stakes/i, () => "Middle Stakes"],
    [/classified\s+stakes/i, () => "Classified Stakes"],
    [/pinnacle\s+stakes/i, () => "Pinnacle Stakes"],
    [/conditions\s+plate/i, () => "Conditions Plate"],
  ];
  for (const [pattern, format] of patterns) {
    const match = sourceTitle.match(pattern);
    if (match) return format(match);
  }
  return "";
}

function factualConditions(sourceTitle: string) {
  const conditionStart = sourceTitle.indexOf("(");
  if (conditionStart < 0) return "";
  const conditions = sourceTitle.slice(conditionStart).replace(
    websitePattern,
    " ",
  ).replace(/\s+/g, " ").trim();
  if (!/^\((?:F\s*(?:and|&)\s*M|For\b|Open\b|Non[-\s])/i.test(conditions)) {
    return "";
  }
  return conditions.slice(0, 240).trim();
}

export function mrcRaceDisplayTitle(
  sourceTitle: string | null | undefined,
  raceNumber: number,
  raceClass: string | null | undefined,
) {
  const source = String(sourceTitle ?? "").replace(/\0/g, "").replace(
    /\s+/g,
    " ",
  ).trim();
  let displayClass = canonicalRaceClass(raceClass) || classFromSource(source) ||
    `Race ${raceNumber}`;

  if (/work\s+riders/i.test(source) && /^Maiden Plate$/i.test(displayClass)) {
    displayClass = `Work Riders ${displayClass}`;
  } else if (
    /\bapprentice\b/i.test(source) && /^[A-E] Stakes$/i.test(displayClass)
  ) {
    displayClass = `Apprentice ${displayClass}`;
  }
  if (
    /\bdivided\s+handicap\b/i.test(source) && / Handicap$/i.test(displayClass)
  ) {
    displayClass = displayClass.replace(/ Handicap$/i, " Divided Handicap");
  }

  const conditions = factualConditions(source);
  return `${displayClass}${conditions ? ` ${conditions}` : ""}`
    .replace(websitePattern, " ")
    .replace(/\s+/g, " ")
    .trim();
}
