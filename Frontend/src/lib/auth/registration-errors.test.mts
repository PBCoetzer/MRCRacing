import assert from "node:assert/strict";
import test from "node:test";
import {
  isExistingRegistrationError,
  isRegistrationEmailRateLimitError,
} from "./registration-errors.ts";

test("recognizes existing-account Auth responses", () => {
  assert.equal(isExistingRegistrationError({ code: "user_already_exists" }), true);
  assert.equal(isExistingRegistrationError({ code: "email_exists" }), true);
  assert.equal(isExistingRegistrationError(new Error("User already registered")), true);
  assert.equal(isExistingRegistrationError({ code: "invalid_credentials" }), false);
});

test("recognizes registration email rate limits", () => {
  assert.equal(
    isRegistrationEmailRateLimitError({ code: "over_email_send_rate_limit" }),
    true,
  );
  assert.equal(
    isRegistrationEmailRateLimitError(new Error("Email rate limit exceeded")),
    true,
  );
  assert.equal(isRegistrationEmailRateLimitError({ code: "weak_password" }), false);
});
