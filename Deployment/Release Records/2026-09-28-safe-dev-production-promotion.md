# Safe dev-to-production promotion

Status: completed and verified on 28 September 2026.

Approval reference: `owner-approved-safe-promotion-20260928`

Release branch: `codex/production-promotion-20260928`

Production baseline: `352797e`

Reviewed release commit: `3cff937fc226f4b3fb03fdfbe433bac2fa8430dc`

## Financial cutover

- Credit checkout creation was frozen first. There were no unexpired pending checkouts before T-0.
- Content purchases, payment completion, refunds, scheduled refunds, and wallet adjustments were frozen at T-0.
- Migration `20260926230353_activate_forward_only_10_20_70_revenue_period.sql` was the only new permanent production migration.
- The forward-only revenue period started at `2026-09-28T01:42:36.127366Z` (`03:42:36.127366` SAST).
- All financial grants were restored only after database, Edge Function, static-site, browser, and advisor checks passed.
- Raw two-argument purchase functions remain blocked. Only the verified authenticated wrappers are executable.

The new policy applies only when Purchased Credits are spent on a meeting card or subscription:

- Horse Care: 10%.
- MRC platform: 20%.
- Tipster: 70%.
- Reward Credits: excluded.
- Credit top-ups: excluded.

## Opening settlement

The immutable paid-history snapshot records all pre-period obligations as settled:

- Horse Care: 45 Credits.
- MRC platform: 465 Credits.
- Tipsters: 4,185 Credits.

The new current period opened with zero purchases and zero Horse Care, platform, and Tipster balances. Historical rows were not recalculated or rewritten.

## Financial reconciliation

- Wallets: 248.
- Total wallet balance: 5,145 Credits.
- Purchased Credit balance: 1,840 Credits.
- Reward Credit balance: 3,305 Credits.
- Historical content purchases: 95.
- Credit transactions: 169.
- Payments: 183, including 52 paid payments.
- Entitlements: 139, all active.
- Subscriptions: 8, all active.
- Negative or component-mismatched wallets: 0.
- Unexpired pending payments at cutover: 0.
- Allocation reconciliation differences: 0.

The T-0, post-activation, and post-unfreeze manifests have identical wallet rows, financial aggregates, and fingerprints. Client Credits, Reward Credits, purchases, payments, entitlements, subscriptions, earnings, Horse Care entries, and remittances were preserved.

## Backups

External backup root: `C:\Users\coetz\OneDrive\Documents\MRC Production Backups\20260928-032555-3cff937`

- Public schema dump: `public-schema.sql`, 633,204 bytes, SHA-256 `433AFC91823949661EEFEEF8C3EEB8D7BB7EE836FFD6F2264B59824C92E0F743`.
- Complete public data dump: `public-data.sql`, 127,207,161 bytes, SHA-256 `7746951C4C42C21902D2C74FDF87C256F8920DFA80D859E62D8B61305FD3BF2B`.
- T-0 financial manifest: `t0-financial-manifest.json`, SHA-256 `36880181224079015677A9CAECC013176FAE09A6B3260106E5B3F6B0933EACAA`.
- Post-activation manifest: `post-activation-financial-manifest.json`, SHA-256 `804F8BB3FC578F622E0732093E7F46BA34213559C7D91681AE918E56E5A5A46D`.
- Post-unfreeze manifest: `post-unfreeze-financial-manifest.json`, SHA-256 `4145E05F06A111F25F91E6F2E3315DEC8BE572609148909EE13E206F5FA2FB75`.
- Xneelo pre-release archive: `public_html-before-20260928-034704.zip`, 22,252,833 bytes, SHA-256 `B5940F1580958A55F9D0173B879320EC860F17580A815A57CCDAED9F7B9B2277`.
- Live Edge Function source, versions, JWT settings, and file hashes were captured under `live-edge-snapshot` before deployment.

## Edge Functions

Only the approved five functions were deployed:

- `admin-user-control`: version 29, JWT verification enabled, bundle SHA-256 `284fd81cd4e59c9b38820306965a4faf4a284c4e936b33c0eec924400dc857a5`.
- `hermes-race-bridge`: version 31, JWT verification disabled, bundle SHA-256 `23c5366c43e36ce3f9d5ce3065e2512b369e3accdcd621f773f648c6be09b229`.
- `process-tip-notifications`: version 41, JWT verification disabled, bundle SHA-256 `59275f027d8e586017532b4d63b98d9ae4f0348b57549107973cf9224816e0a3`.
- `race-lifecycle`: version 21, JWT verification disabled, bundle SHA-256 `9f43d1f074b8e066cd2956d1f03e7947d0b96637731c30756b7956e7ef8da954`.
- `sync-race-data`: version 82, JWT verification disabled, bundle SHA-256 `818fdba408ae259c42743f7073e5cf4b06c8c1a92bf89f4b02d5e159a54ca07a`.

The deployed administrator function contains MFA enforcement and no development MFA bypass or development-domain reference.

## Verification

- `npm ci`: passed.
- Production dependency audit: 0 vulnerabilities.
- ESLint: passed.
- TypeScript: passed.
- Frontend tests: 21 passed.
- Edge Function tests: 61 passed.
- Production static build: 88 routes, 85 HTML files, and 82 payload aliases.
- Static export verification: passed.
- Production-artifact development-reference scan: passed.
- Live revenue-split pgTAP checks: 24 passed.
- Live financial-invariant pgTAP checks: 13 passed.
- pgTAP was removed after verification.
- Migration history is aligned through `20260926230353`.
- Supabase advisors were re-run after activation. They report only the existing RLS/security-definer/password-protection, unindexed-FK, unused-index, and multiple-permissive-policy advisory classes; no cutover-specific failure was introduced.

## Frontend deployment and smoke tests

The Xneelo helper verified 596 local files, uploaded 541 changed files, retained 55 identical files, removed 774 stale generated files, preserved 524 legacy or system files, and finished with 1,120 remote files.

- Public homepage, login, tipsters, horse-racing, Horse Care, pricing, and blog routes return HTTP 200.
- Client, Tipster, Admin, and profile routes display the correct unauthenticated access guard without console errors.
- Existing entitlement, subscription, purchase, and wallet fingerprints are unchanged. No production user was impersonated and no financial test transaction was created.
- Live race data renders two non-test meetings within the next seven days; queued race-feed tasks are zero.
- Desktop containers use approximately 10% left and right margins at 1,440 px.
- Tablet and 390 px mobile layouts have no horizontal overflow and expose the mobile navigation correctly.
- The production export and live DOM contain no development domain, Tailscale, test-account, self-hosted API, or MFA-bypass reference.
- The Betfred affiliate CTA is present, and its email markup remains table-based and mobile-safe through the verified notification tests.

## Monitoring

The first organic post-cutover content purchase must be checked against allocation version `content-spend-10-20-70-v2-forward-only`. Its Purchased Credit portion must reconcile exactly to 10/20/70 and its Reward Credit portion must contribute zero. Reconciliation is repeated at one hour and 24 hours without modifying financial history.

If a later discrepancy appears, freeze financial operations immediately and apply a forward-only correction. Never restore an old database dump over new transactions or delete immutable ledger history.

## One-hour monitoring checkpoint

Completed read-only at `2026-09-28T03:29:15.002743Z`, after the required one-hour threshold.

- Revenue period, effective timestamp, exclusions, and 10/20/70 rates: valid.
- Opening paid settlement totals: valid.
- Historical purchase, Tipster earnings, and Horse Care fingerprints: unchanged.
- Wallets checked: 248; invalid or component-mismatched wallets: 0.
- Duplicate purchase, Credit transaction, earnings, and Horse Care accrual keys: 0.
- Current-period content purchases: 0; first organic purchase is still pending.
- Current-period Horse Care, platform, and Tipster balances: 0 Credits.
- The 24-hour reconciliation is not due yet.
