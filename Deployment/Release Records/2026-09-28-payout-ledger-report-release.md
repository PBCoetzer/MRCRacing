# Payout Ledger and Reporting Release

## Approval and scope

- Owner approval: proceed with the planned live update after verified backups, temporary financial freezes, production migration, deployment, reconciliation, and monitored reactivation.
- Release branch: `codex/production-payout-ledger-20260928`.
- New permanent database migration: `20260928172538_tipster_payout_requests_and_current_period_reports.sql`.
- The existing forward-only revenue period remains unchanged: `content-spend-10-20-70-v2-forward-only`, effective `2026-09-28T01:42:36.127366Z`.
- Historical financial rows, client Purchased Credits, Reward Credits, entitlements, subscriptions, payments, and wallet balances remain immutable.
- Reward Credits remain excluded from Horse Care, platform, and Tipster allocations.
- No Edge Function source changes are included in this release.

## Pre-release backups

External backup root: `C:\Users\coetz\OneDrive\Documents\MRC Production Backups\20260928-213340-payout-ledger`

- Xneelo `public_html` archive: `public_html-before-20260928-212511.zip`, 21,152,771 bytes, SHA-256 `0FCDD9F98AACE93F59F6173A06E81827EBA4A38F0E3B640C09978202FD781421`.
- Public schema dump: `public-schema.sql`, SHA-256 `71B88172A2D18CE477040D7E444F735B26879946A27EF816B15D869E7209F31B`.
- Complete public data dump: `public-data.sql`, 126,128,461 bytes, SHA-256 `C0D66A4B373A567B2A4D00F004B1BFB916C56187AADC438D75FD0FD048C082E9`.
- Pre-freeze financial manifest: `pre-freeze-financial-manifest.json`, SHA-256 `A082AC9CCF92C3715A9ED9146D6B395361E725FC6C348A3AD233AEC705A49848`.
- Pre-release health snapshot: `pre-release-health.json`, SHA-256 `B9A9EBD10157FAB4DBE70873A006F10679C97C408AA0E50A18FE3FA29B68E9CA`.
- Migration and scheduler state: `migration-and-scheduler-state.json`, SHA-256 `EC79A23B067CD5D936CA17115E1B79C5D8EA3EE6B94003FC200D54FCFBA5F6A4`.
- Edge Function inventory: `edge-functions.json`, SHA-256 `C4EF2AF1078DA8B4B69169679CD7E8886EC53B1E126548015C5B160F66AB7BF9`.
- Physical-backup status: `supabase-physical-backup-status.json`, SHA-256 `660093604E9D05E51A771F3A9693888BBCF4D710983EC046C34A5`.
- Backup verification: `backup-verification.json` and `SHA256SUMS.txt` passed before any production mutation.

## Baseline

- Wallets: 249.
- Total wallet balance: 5,220 Credits.
- Purchased Credit balance: 1,910 Credits.
- Reward Credit balance: 3,310 Credits.
- Content purchases: 97.
- Financial period, split, wallet, history, idempotency, related-entry, gross-composition, and opening-settlement checks: valid.
- Queued or running race-feed jobs: 0.
- Queued site-build jobs: 0.
- Pending notifications: 118 SMS notifications with zero attempts. This pre-existing backlog is not automatically released because doing so could send stale messages and incur cost.

## Development verification

- Purchased-only meeting smoke purchase: 20 Purchased Credits allocated as 2 Horse Care, 4 platform, and 14 Tipster Credits.
- Mixed subscription smoke purchase: 350 gross Credits, comprising 175 Purchased and 175 Reward Credits, allocated as 17.5 Horse Care, 35 platform, and 122.5 Tipster Credits.
- Reward-only meeting smoke purchase: 20 Reward Credits allocated as zero revenue.
- Post-payout earning smoke purchase: 10 Purchased Credits allocated as 1 Horse Care, 2 platform, and 7 Tipster Credits.
- Full development payout lifecycle: 136.5 Credits requested, marked paid with reference `DEV-SMOKE-20260928`, and confirmed received across two earning rows.
- Current-period unassigned earning after payout: 7 Credits.
- Desktop and mobile revenue interfaces were visually verified, including approximately 10% desktop margins and a 390-pixel mobile layout without horizontal overflow.

## Automated validation

- `npm ci`: passed; 454 packages and zero vulnerabilities.
- Production dependency audit: passed with zero vulnerabilities.
- ESLint: passed.
- TypeScript: passed.
- Frontend tests: 21 passed.
- Edge Function tests: 61 passed.
- Production static build: passed with 89 pages.
- Static export verification: passed with 86 HTML files, 60 sitemap routes, 8 dynamic pages, and 83 payload aliases.
- Production-artifact environment isolation: passed; no development domain, Tailscale, test-account, self-hosted API, or MFA-bypass reference.
- Payout workflow pgTAP: 19 passed.
- Content split pgTAP: 24 passed.
- Financial invariant pgTAP: 13 passed.
- Linked database lint: no errors; one pre-existing warning for unused parameters in the intentionally blocked legacy `admin_refund_purchase` wrapper.

## Legacy settlement report

- Report period: all 95 content purchases before the current 10/20/70 revenue period.
- Gross spend: 6,035 Credits.
- Purchased Credits: 4,650.
- Reward Credits excluded: 1,385.
- Historical Horse Care allocation: 0 Credits.
- Historical platform allocation: 465 Credits.
- Historical Tipster allocation: 4,185 Credits.
- PDF SHA-256: `F075482A125FE0FE67FD3977479F1A3D2BD73C2EC5CB94962F1CC398965DD564`.

## Cutover record

The following fields are completed during the live cutover:

- Release commit: pending.
- Checkout freeze: pending.
- Full financial freeze: pending.
- T-0 manifest and hash: pending.
- Migration application: pending.
- Post-migration reconciliation: pending.
- Static deployment and Xneelo deployment hash: pending.
- Live route and role smoke tests: pending.
- Financial reactivation: pending.
- Post-reactivation manifest and hash: pending.
- Monitoring automation reactivation: pending.

## Rollback policy

- Before financial reactivation, a failed check keeps operations frozen while frontend or function artifacts are restored as needed.
- After new transactions exist, freeze financial operations and apply a forward-only correction.
- Never restore an old database dump over new transactions, recalculate client balances, or delete immutable ledger history.
