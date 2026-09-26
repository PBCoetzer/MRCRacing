# Full outstanding production release

Status: revenue allocation and frontend rolled back on 26 September 2026 after the owner reported Credit inconsistencies. Unrelated non-financial database migrations and existing Edge Function improvements remain deployed.

Approval reference: `user-approved-full-outstanding-deployment-20260926`

## Database migrations

Applied in order to Supabase project `cjgfvqgiqrphmakruqnk`:

1. `20260916140048_capture_explicit_email_marketing_reconfirmation.sql`
2. `20260917104421_cleanup_stale_unconfirmed_accounts.sql`
3. `20260921080521_formgrids_primary_secondary_consensus.sql`
4. `20260921093726_telegram_change_only_feedback.sql`
5. `20260924063745_prioritize_results_and_settle_verified_winners.sql`
6. `20260926082101_content_spend_10_20_70_revenue_split.sql`

The migration history was re-read after deployment and contains all six versions.

## Revenue reconciliation

- Revenue allocation is triggered when Purchased Credits are consumed by meeting cards or subscriptions, not when Credits are bought.
- Reward Credits remain excluded from monetary allocation.
- Horse Care receives 10%, MRC Racing Tips receives 20%, and the Tipster receives 70%.
- 87 active historical content purchases were reconciled during migration.
- A new 40-Credit live content purchase completed after deployment and used the new split, bringing the verified totals to 88 purchases and 4,310 Purchased Credits.
- Current allocation is 431 Horse Care Credits, 862 platform Credits, and 3,017 Tipster Credits.
- 1,385 Reward Credits were excluded.
- Purchase split mismatches: 0.
- Tipster earnings ledger mismatches: 0.

## Edge Functions

Published the current local versions of all 15 managed functions:

- `admin-user-control`
- `auth-email-webhook`
- `auth-send-email`
- `blog-media-upload`
- `create-credit-checkout`
- `deliver-sms-notifications`
- `hermes-race-bridge`
- `ozow-notification`
- `payfast-itn`
- `payment-return`
- `process-tip-notifications`
- `race-lifecycle`
- `site-build-bridge`
- `sync-race-data`
- `telegram-race-feedback`

All functions reported `ACTIVE` after deployment. The historical `deliver-tip-notifications` function remains available but the canonical delivery worker is `process-tip-notifications`.

The Telegram webhook secret was generated and stored as a server-only Supabase secret. Telegram accepted registration of `https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/telegram-race-feedback` with signed webhook delivery.

## Frontend

- Full verification passed before upload: ESLint, TypeScript, 16 application tests, 60 Edge Function tests, static build, and export verification.
- The static build contains 84 routes and 81 HTML files.
- Xneelo deployment uploaded 490 changed files, retained 80 current files, and removed 3 stale generated files.
- Live smoke tests returned HTTP 200 for the homepage, `/admin/revenue/`, `/account/security/`, `/blog/`, and `/tipster/`.
- The live `/admin/revenue/` page contains the new content revenue split workspace.
- A non-mutating unauthenticated checkout probe returned the expected HTTP 401 response.

## Rollback artifacts

- `Deployment/Xneelo Backups/public_html-before-20260926-104332.zip`
- `Deployment/Xneelo Backups/public_html-before-20260926-105052.zip`
- SHA-256 for both archives: `2026CDDCE51892DA5FD8145C5990C138D66F5CD5B8AFC65CFCAC9313C6ED596D`

Database migrations are forward-only. Use Supabase recovery facilities and compensating migrations rather than deleting financial or audit rows.

## Remaining manual items

- Update the Tipster/platform agreement and public financial wording so the legal documents explicitly describe the 10% Horse Care, 20% platform, and 70% Tipster split.
- Supabase advisors still report pre-existing security-definer and RLS advisory items. The newly added revenue report is restricted through the existing active-administrator and MFA-aware role check.
