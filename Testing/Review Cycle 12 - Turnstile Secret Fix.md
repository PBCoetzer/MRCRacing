# Review Cycle 12 - Turnstile Secret Fix

Date: 27 July 2026

## Issue

Client registration failed with:

`captcha protection: request disallowed (invalid-input-secret)`

The frontend Turnstile widget was producing a token and Supabase was receiving the signup request. The Turnstile secret saved in Supabase contained two character-case transcription errors.

## Resolution

- Replaced the Turnstile secret in Supabase Authentication > Attack Protection.
- Kept CAPTCHA protection enabled with Cloudflare Turnstile.
- Did not store the Turnstile secret in source control, deployment files, or this report.
- No frontend rebuild or Xneelo upload was required because the public site key and CAPTCHA-enabled forms were already deployed.

## Verification

- Cloudflare `siteverify` accepted the configured secret and rejected an intentionally invalid response token with `invalid-input-response`.
- A harmless Supabase signup probe returned HTTP `400`, error code `captcha_failed`, and `invalid-input-response`.
- The Supabase probe no longer returned `invalid-input-secret`.
- The live registration route returned HTTP `200`.
- The probe used a reserved test email and an invalid CAPTCHA token, so it did not create an account or send an email.

## Browser Note

The Codex in-app browser crashes when loading pages that embed Cloudflare Turnstile. Browser-based CAPTCHA verification was therefore stopped. Complete the final human registration check in Chrome or Edge.

## Final Manual Check

1. Open `https://www.mrcracing.co.za/register` in Chrome or Edge.
2. Complete the Turnstile verification.
3. Register with a new email address.
4. Confirm that the registration succeeds and the confirmation email arrives.
