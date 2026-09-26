import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowEmailMarketingConsentPrompt } from "./email-marketing-consent.ts";

test("requests an explicit decision for an administrative legacy backfill", () => {
  assert.equal(
    shouldShowEmailMarketingConsentPrompt({
      enabled: true,
      confirmedAt: null,
      consentVersion: "2026-09-16-email-announcements",
      consentSource: "legacy_backfill",
      currentVersion: "2026-09-16-email-announcements",
      requiresConfirmation: true,
    }),
    true,
  );
});

test("does not prompt again after an explicit current-version choice", () => {
  assert.equal(
    shouldShowEmailMarketingConsentPrompt({
      enabled: false,
      confirmedAt: "2026-09-16T14:00:00.000Z",
      consentVersion: "2026-09-16-email-announcements",
      consentSource: "privacy_consent_prompt",
      currentVersion: "2026-09-16-email-announcements",
      requiresConfirmation: false,
    }),
    false,
  );
});

test("requests a new choice when the notice version changes", () => {
  assert.equal(
    shouldShowEmailMarketingConsentPrompt({
      enabled: true,
      confirmedAt: "2026-09-16T14:00:00.000Z",
      consentVersion: "older-version",
      consentSource: "registration",
      currentVersion: "2026-09-16-email-announcements",
      requiresConfirmation: true,
    }),
    true,
  );
});
