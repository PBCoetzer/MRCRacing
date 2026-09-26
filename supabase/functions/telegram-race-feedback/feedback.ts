export type RaceFeedbackHint = {
  raceNumber?: number;
  saddleNumber?: number;
  horseName?: string;
  jockeyName?: string;
  status?: "active" | "reserve" | "scratched" | "withdrawn";
};

function clean(value: unknown) {
  return [...String(value ?? "")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value ?? "");
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 99
    ? parsed
    : undefined;
}

function cleanName(value: string | undefined) {
  const normalized = clean(value)
    .replace(/^(?:horse|runner)\s+/i, "")
    .replace(/^#?\d{1,2}\s+/, "")
    .replace(/^#?\d{1,2}$/, "")
    .replace(/\s+is$/i, "")
    .replace(/^is$/i, "")
    .replace(/\s+(?:is\s+)?(?:active|reserve|scratched|withdrawn)$/i, "")
    .trim();
  if (!normalized || normalized.length > 120) return undefined;
  return normalized;
}

export function parseRaceFeedback(value: unknown) {
  const text = clean(value);
  if (text.length < 3 || text.length > 500) {
    throw new Error("Feedback must contain between 3 and 500 characters.");
  }

  const raceMatch = /\brace\s*(?:no\.?\s*)?#?\s*(\d{1,2})\b/i.exec(text);
  const statusMatch = /\b(active|reserve|scratched|withdrawn)\b/i.exec(text);
  const saddleMatch =
    /\b(?:horse|runner|number|no\.?)\s*#?\s*(\d{1,2})\b/i.exec(
      text,
    ) ?? /#(\d{1,2})\b/.exec(text);
  const jockeyMatch = /\bjockey(?:\s+(?:changed|change))?\s+(?:to|is)\s+(.+)$/i
    .exec(
      text,
    );
  const raceNumber = positiveInteger(raceMatch?.[1]);
  const saddleNumber = positiveInteger(saddleMatch?.[1]);
  const status = statusMatch?.[1]?.toLowerCase() as RaceFeedbackHint["status"];
  let horseName: string | undefined;

  if (!jockeyMatch && statusMatch) {
    const start = raceMatch ? raceMatch.index + raceMatch[0].length : 0;
    const candidate = text.slice(start, statusMatch.index).trim();
    horseName = cleanName(candidate);
  }

  const hint: RaceFeedbackHint = {
    ...(raceNumber ? { raceNumber } : {}),
    ...(saddleNumber ? { saddleNumber } : {}),
    ...(horseName ? { horseName } : {}),
    ...(jockeyMatch?.[1] ? { jockeyName: cleanName(jockeyMatch[1]) } : {}),
    ...(status ? { status } : {}),
  };

  return { text, hint };
}

export function formatFeedbackAcknowledgement(hint: RaceFeedbackHint) {
  const details = [
    hint.raceNumber ? `Race ${hint.raceNumber}` : "",
    hint.saddleNumber ? `Horse #${hint.saddleNumber}` : "",
    hint.horseName ? hint.horseName : "",
    hint.jockeyName ? `jockey: ${hint.jockeyName}` : "",
    hint.status ? `status: ${hint.status}` : "",
  ].filter(Boolean).join(" · ");

  return [
    "✅ Feedback saved for administrator review.",
    details,
    "No race data was changed automatically.",
  ].filter(Boolean).join("\n");
}
