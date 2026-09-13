# Registration Hotfix Release Record — 13 September 2026

## Investigation

- The reported address already belonged to an email-confirmed account.
- The account had one email identity, a profile, account controls, a wallet, the client role, and a recorded Terms acceptance.
- The account had previously signed in successfully.
- The current diagnostic event was a password-recovery dispatch, not a new account creation or confirmation dispatch.
- No customer account, password, role, wallet, or confirmation state was changed during the investigation.

## Root Cause

Supabase may return either an obfuscated user response or an Auth error when `signUp()` is called for an existing confirmed address. The form already handled the obfuscated response but treated Auth error codes such as `user_already_exists` and `email_exists` as a red registration failure. A consumed or expired captcha response could also be reported as definitive failure even when the client had already received the successful confirmation message from an earlier request.

## Changes

- Classify existing-account Auth codes and messages as an existing-account outcome.
- Direct repeat registrants to login or password reset without exposing account details.
- Classify email-send rate limits as an uncertain/recent-request outcome.
- Explain that a received confirmation email means the account was created, even if the captcha response became ambiguous.
- Add focused tests for existing-account and email-rate-limit classifications.
- Add the Auth classification tests to the full local release gate.

## Verification

- Focused Auth tests: 2 passed, 0 failed.
- Edge Function tests: 43 passed, 0 failed.
- ESLint and TypeScript: passed.
- Next static generation: 69 routes.
- Static artifact verification: 66 HTML files, 43 sitemap routes, 4 dynamic pages, and 63 payload aliases.
- Production dependency audit: zero vulnerabilities.
- Live `/register/`: HTTP 200, mobile width fits 390px without horizontal overflow.
- Live JavaScript contains the existing-account, uncertain-registration, and confirmation-email recovery guidance.

## Deployment

- Approval reference: `owner-requested-registration-hotfix-20260913-120619`.
- Application revision: `293dfe5299a0f27b64035d831ae939eda4b8e762`.
- Verified 474 local files; uploaded 390, retained 84 current files, removed 3 stale managed files, and preserved 396 legacy/system files.
- Remote files passed post-upload SHA-256 verification.
- No database migration, customer-data mutation, or Edge Function deployment was required.

## Rollback

- Backup: `Deployment/Xneelo Backups/public_html-before-20260913-120620.zip`.
- Size: 12,845,643 bytes across 869 entries.
- SHA-256: `510AA4498E53E45D4A7F4C6D7B0CD15A7744676342E23E92A0608C809CFC6FE6`.
