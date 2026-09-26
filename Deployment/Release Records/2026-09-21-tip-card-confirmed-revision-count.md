# Tip Card Confirmed Revision Count

## Status

- Production database migration and frontend deployment completed on 21 September 2026.
- Approval reference: `user-requested-accurate-revision-count-20260921`.
- Supabase migration: `20260921062409_accurate_confirmed_tip_card_revision_count.sql`.

## Root Cause

- `tip_cards.revision` is an optimistic-lock version used to reject stale edits.
- Every private draft save increments that internal version before publication.
- The Tipster and client screens incorrectly displayed the internal lock version as the published revision count.
- Immutable `tip_card_revisions` records are created only when a Tipster confirms the initial publication or publishes a correction, so they are the accurate revision history.

## Correction

- Added `tip_cards.confirmed_revision_count` and backfilled it from immutable `tip_card_revisions` history.
- Added a database trigger that synchronizes the count after every confirmed revision insert or deletion.
- Kept the existing `revision` field unchanged for safe concurrent-edit checks and notification idempotency.
- Updated Tipster dashboard, meeting-card editor, client marketplace, and public Tipster profile queries to use the confirmed count.
- Updated the editor state immediately after a successful publication or correction so the displayed count increases without a page reload.

## Verified Examples

- MrC Durbanville, 23 September: internal lock version `9`; confirmed revision count `1`.
- MrC Fairview, 18 September: internal lock version `4`; confirmed revision count `3`.
- GJ Vaal, 17 September: internal lock version `13`; confirmed revision count `3`.
- A transaction-rollback test inserted a temporary immutable correction and confirmed the displayed count increased by exactly one; no test data remained.

## Verification

- ESLint passed.
- TypeScript passed.
- Authentication, blog, and consent tests passed: 16/16.
- Supabase Edge Function tests passed: 48/48.
- Terminology validation passed across 42 files.
- Next.js static export passed with 79 generated routes.
- Static-export verification passed for 76 HTML files, 52 sitemap routes, 6 dynamic pages, and 73 payload aliases.
- Live `/tipster/`, `/tipster/manage-tips/`, and `/client/` returned HTTP 200.
- The deployed Tipster JavaScript contains the `confirmed_revision_count` contract.
- Local and live migration history both end at `20260921062409`.

## Deployment

- Xneelo verified 538 local release files: 453 uploaded and 85 already current.
- Nine stale generated files were removed; 484 legacy or system files were preserved.
- Rollback backup: `Deployment/Xneelo Backups/public_html-before-20260921-082630.zip`.
- Backup SHA-256: `4091F9BF3A503BEAA85C6A0B1D5B4FB82CBFB279D8095FF1E3FFB326DDD06C8A`.

## Rollback

- Restore the Xneelo archive above to revert the frontend.
- The database change is additive. If compensation is required, first remove the synchronization trigger and function, then remove `confirmed_revision_count` only after deploying a frontend that no longer selects it.
