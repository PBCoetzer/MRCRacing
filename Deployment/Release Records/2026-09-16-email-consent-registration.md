# Email Consent Registration

## Status

- Production database migration and frontend deployment completed on 16 September 2026 after owner approval.
- All 204 active registered clients have email notifications enabled and a recorded marketing-consent timestamp.
- The migration added 201 auditable legacy-client consent records while preserving existing withdrawals and disabled preferences.

## Changes

- Made email-announcement consent mandatory during new account registration.
- Stored the consent flag and version in Supabase Auth signup metadata.
- Updated the new-user database trigger to persist the consent timestamp and immutable audit event.
- Backfilled eligible active client profiles that had no prior consent or withdrawal record.
- Kept consent withdrawal available through the client profile notification preferences.

## Verification

- Production active clients: 204.
- Production consented and enabled clients: 204.
- Production eligible clients missing consent: 0.
- Backfill audit rows created: 201.
- Registration trigger contains the versioned consent contract.
- Full local verification passed: ESLint, TypeScript, 13 frontend/auth/blog tests, 48 Edge Function tests, terminology validation, and the static build.
- Static export verification passed for 73 HTML files, 49 sitemap routes, 6 dynamic pages, and 70 payload aliases.
- Live `/register/` returned HTTP 200 and its deployed JavaScript contains the required email-announcement consent control.
- Supabase migration history is reconciled for migration `20260916104518`.

## Deployment

- Approval reference: `approved-by-owner-20260916-email-consent-registration`
- Source commit at deployment: `5a0afbcbfce300ffaf770130542733e0402918f8` with the listed consent changes uncommitted in the audited worktree.
- Database migration: `supabase/migrations/20260916104518_backfill_and_capture_email_marketing_consent.sql`
- Files verified: 516.
- Files uploaded: 432.
- Files already current: 84.
- Stale managed files removed: 3.
- Legacy or system files preserved: 443.
- No Edge Function deployment was required.

## Rollback

- Frontend backup: `Deployment/Xneelo Backups/public_html-before-20260916-132016.zip`
- Backup size: 13,660,902 bytes.
- Backup SHA-256: `B139113D87D27079D8FB88B3D3D44CD8939510F2B2FE906BB931A14E5E4F93E8`.
- Database compensating script: `Database/one-off-repairs/rollback_20260916104518_email_marketing_consent.sql`.
- The database rollback targets only unchanged backfill records and does not remove later user-confirmed consent or withdrawals.

## Follow-up

- Configure Resend separately for authenticated email delivery, event webhooks, bounce tracking, and suppression handling.
- Existing Supabase security and performance advisor warnings remain tracked by the production-readiness audit; this release introduced no new release-blocking advisor finding.
