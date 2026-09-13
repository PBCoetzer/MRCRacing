const existingRegistrationCodes = new Set([
  "email_exists",
  "identity_already_exists",
  "user_already_exists",
]);

const emailRateLimitCodes = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

function readErrorValue(error: unknown, key: "code" | "message") {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const errorRecord = error as Record<string, unknown>;
  const value = errorRecord[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isExistingRegistrationError(error: unknown) {
  const code = readErrorValue(error, "code");
  const message = readErrorValue(error, "message");

  return existingRegistrationCodes.has(code) ||
    /user already registered|account already exists|email already (?:exists|registered|in use)/i.test(message);
}

export function isRegistrationEmailRateLimitError(error: unknown) {
  const code = readErrorValue(error, "code");
  const message = readErrorValue(error, "message");

  return emailRateLimitCodes.has(code) ||
    /email.*rate limit|too many.*email|confirmation.*recently/i.test(message);
}
