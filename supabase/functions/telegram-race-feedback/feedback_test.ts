import {
  formatFeedbackAcknowledgement,
  parseRaceFeedback,
} from "./feedback.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parses a race and saddle-number scratching", () => {
  const result = parseRaceFeedback("Race 1 Horse 10 is scratched");
  assert(result.hint.raceNumber === 1, "race number was not parsed");
  assert(result.hint.saddleNumber === 10, "saddle number was not parsed");
  assert(result.hint.status === "scratched", "status was not parsed");
  assert(!result.hint.horseName, "a saddle number is not a horse name");

  const shorter = parseRaceFeedback("Race 1 Horse 10 scratched");
  assert(
    !shorter.hint.horseName,
    "a short saddle reference is not a horse name",
  );
});

Deno.test("parses a horse name and jockey correction", () => {
  const horse = parseRaceFeedback("Race 3 CLEVER KID scratched");
  assert(horse.hint.horseName === "CLEVER KID", "horse name was not parsed");

  const jockey = parseRaceFeedback(
    "Race 2 Horse 4 jockey changed to Craig Zackey",
  );
  assert(jockey.hint.raceNumber === 2, "jockey correction race is missing");
  assert(jockey.hint.saddleNumber === 4, "jockey correction saddle is missing");
  assert(
    jockey.hint.jockeyName === "Craig Zackey",
    "jockey name was not parsed",
  );
});

Deno.test("rejects empty and overlong feedback", () => {
  let emptyRejected = false;
  let longRejected = false;
  try {
    parseRaceFeedback(" ");
  } catch {
    emptyRejected = true;
  }
  try {
    parseRaceFeedback("x".repeat(501));
  } catch {
    longRejected = true;
  }
  assert(emptyRejected && longRejected, "invalid feedback should be rejected");
});

Deno.test("acknowledgement confirms review-only behavior", () => {
  const message = formatFeedbackAcknowledgement({
    raceNumber: 1,
    saddleNumber: 10,
    status: "scratched",
  });
  assert(message.includes("Race 1"), "acknowledgement lacks the parsed race");
  assert(
    message.includes("No race data was changed automatically"),
    "acknowledgement must state that no automatic change occurred",
  );
});
