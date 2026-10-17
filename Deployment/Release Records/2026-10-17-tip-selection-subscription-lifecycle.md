# Tip Selection and Subscription Lifecycle Live Release

Date: 17 October 2026
Target: `https://www.mrcracing.co.za` and Supabase project `cjgfvqgiqrphmakruqnk`
Status: **Completed and verified on production**

## Safety boundary

- Production was unchanged throughout preparation. The approved forward-only database migration was applied at `2026-10-17T15:58:18Z` before the static deployment.
- The development website is not part of this release.
- The Hermes race worker remains online because this release does not change the race-feed pipeline.
- Only the static build timer may be paused during the final live file deployment to prevent a competing build.
- Database corrections are forward-only. Do not delete history and do not overwrite production with an old dump.

## Root cause

### Saved selections displayed as `No selection`

The affected Fairview card is `dac2e025-1178-424f-8a20-72afe895696b`. Production still contains the saved Race 3 winner and place entry `61582d5d-ef21-4b02-9f75-59d1dab9e860`, horse 9 `VENTURA BOULEVARD`. The client display depended entirely on a fresh `race_entries` lookup, so a stale or incomplete client lookup incorrectly rendered `No selection` even though the saved selection remained valid.

The fix captures immutable winner/place display snapshots when a selection is saved, backfills existing saved selections, prefers the current race entry when available, and uses the snapshot only as the fallback. The client dashboard also refreshes when the browser regains focus or becomes visible.

### Subscriptions remained usable after their end time

The production baseline contained six subscriptions with `status = 'active'` and `ends_at <= now()`. Authorization accepted an unrevoked subscription entitlement without checking the linked subscription status or time window.

The test account `jcoetzer238@gmail.com` currently has three ended segments still marked active and one valid segment ending `2026-10-20T12:40:03.863462Z`. The live correction will expire the ended segments while preserving the currently valid segment.

Production has 31 expected entitlements for currently valid subscriptions and zero missing current-subscription entitlements, so revoking stale rows does not remove valid access.

The fix makes a one-month purchase exactly 30 days, validates subscription-backed access against the linked active half-open time window, expires ended subscriptions hourly, revokes only subscription-sourced entitlements, and leaves one-off meeting purchases untouched. Clients receive one deduplicated in-app warning within seven days and see an expiry badge on the subscription card.

### Authenticator prompts

No MFA bypass is included. Supabase already preserves AAL2 for the signed-in browser session. A fresh login, private browser, cleared storage, or explicit sign-out must require a new code. A local seven-day bypass would not satisfy database RLS or Edge Function AAL2 checks and would weaken administrator security.

## Release files

- `Frontend/src/components/client/client-dashboard-client.tsx`
- `Frontend/src/lib/racing/types.ts`
- `Frontend/src/lib/racing/selection-display.ts`
- `Frontend/src/lib/racing/selection-display.test.mts`
- `Frontend/src/lib/racing/subscription-access.ts`
- `Frontend/src/lib/racing/subscription-access.test.mts`
- `supabase/migrations/20261017152937_strict_tip_selection_and_subscription_lifecycle.sql`
- `supabase/tests/strict_tip_selection_and_subscription_lifecycle_test.sql`
- `Server/mrc-site-watchdog/mrc_site_watchdog.py`
- `Server/mrc-site-watchdog/mrc-site-watchdog.service`
- `Server/mrc-site-watchdog/mrc-site-watchdog.timer`
- `Server/mrc-site-watchdog/bootstrap.sh`
- `Server/mrc-build/mrc_build_worker.py`
- `Deployment/Release Records/2026-10-17-tip-selection-subscription-lifecycle.md`

No Peach payment, development-site, communication-preference, revenue-panel, or unrelated MFA change belongs in this release.

## Backups and baselines

- Local pre-change backup: `C:\Users\coetz\OneDrive\Documents\MRC Website Backups\20261017-172833-tip-subscription-mfa-dev`
- Sanitized database harness backup: `/home/briewel/mrc-dev-db-backups/20261017-153423-pre-strict-subscription.dump`
- Sanitized backup SHA-256: `dfb041d8979e307d1b4a7c895226fcfb674594747f54dc8ab501d0f80af25a0f`
- Production schema before release: no snapshot columns and no subscription lifecycle cron job.
- Production source state before release: six ended subscriptions still marked active.
- Current live site watchdog preflight: all checked routes returned HTTP 200, including the three newest dated meeting pages found in the sitemap.
- Current `hermes-mrc-worker.timer` and `mrc-build.timer`: active.

## Validation completed

- Rollback-only migration on the sanitized production clone: passed.
- Snapshot rows backfilled in the harness: 97.
- Active one-month segments corrected in the harness: 4.
- Lifecycle dry application in the rollback-only transaction: 1 warning, 6 subscriptions expired, 42 subscription entitlements revoked.
- pgTAP: 16 passed, 0 failed.
- Frontend tests: 38 passed, 0 failed.
- Edge Function tests: 72 passed, 0 failed.
- TypeScript: passed.
- ESLint with zero warnings: passed.
- Development static export: 84 HTML files, 58 sitemap routes, 6 dynamic pages, and 81 payload aliases verified.
- Python compilation: passed.
- Live route/content watchdog: passed.
- `git diff --check`: passed.

## Approved production evidence

- Operator approval received in the release chat on 17 October 2026.
- Migration `strict_tip_selection_and_subscription_lifecycle`: applied successfully to `cjgfvqgiqrphmakruqnk`.
- Snapshot columns after migration: 2.
- Existing selection rows backfilled with at least one snapshot: 148.
- Ended subscriptions still marked active after lifecycle processing: 0.
- Subscription lifecycle cron: one active job on `17 * * * *`.
- Fairview Race 3 winner/place snapshot: `9. VENTURA BOULEVARD` for both selections.
- Test-account ended segments: expired; valid segment ending `2026-10-20T12:40:03.863462Z`: active.
- Affected Fairview card entitlement: preserved and linked to the valid active segment.
- Confirmed four-argument checkout RPC: executable by authenticated clients.
- Raw two-argument checkout RPC: remains private.
- Supabase security/performance advisor category counts: unchanged from the recorded pre-release baseline.

The production Supabase advisor baseline contains existing notices. This release must not add a new advisory. Re-run both security and performance advisors after the migration and compare them with the recorded baseline.

## Controlled live rollout

1. Re-run the read-only production baseline and save affected subscription/card rows to the release evidence folder.
2. Confirm `hermes-mrc-worker.timer` and `mrc-build.timer` are active and no build service is running.
3. Pause only `mrc-build.timer`; do not stop the Hermes race worker.
4. Apply `strict_tip_selection_and_subscription_lifecycle` to production as one transaction.
5. Verify snapshot backfill, exact 30-day rules, the lifecycle cron, zero ended active subscriptions, and the affected Fairview Race 3 fallback snapshot.
6. Re-run Supabase security and performance advisors and compare with the pre-release baseline.
7. Create a focused release commit from the verified production code baseline, excluding every unrelated development change, then push that commit to the live source branch.
8. Build the static site with production public environment values and deploy through the existing rollback-safe Xneelo deployment script.
9. Install the watchdog and updated build verifier. The watchdog runs every two minutes and uses `hermes-failure-notify@.service` for the existing Telegram incident path.
10. Run post-deploy smoke tests for the homepage, horse-racing index, newest dated meeting pages, client workspace, tipster workspace, Admin Racing, sitemap, and robots.
11. Verify the affected client card through the normal client UI and verify the test account retains only its genuinely current subscription access.
12. Re-enable `mrc-build.timer`, confirm both live timers are active, and observe the watcher/build/Hermes logs for at least 15 minutes.

## Completed production verification

- Focused release commit `df24c8da1dbbb05230c7b72f92ebee72cf265270` is on `origin/main`.
- The production static site contains both approved client markers: `Selection temporarily unavailable` and `Ends in`.
- Production smoke tests passed for the homepage, horse-racing index, client workspace, tipster workspace, Admin Racing, sitemap, robots, and the newest dated Turffontein, Durbanville, and Fairview meeting pages.
- `mrc-build.timer`, `hermes-mrc-worker.timer`, and `mrc-site-watchdog.timer` are active.
- The watchdog completed successfully at `2026-10-17 20:25 SAST`; all ten checked routes returned HTTP 200 and the service result was `success` with exit status 0.
- The watchdog runs every two minutes and retains `hermes-failure-notify@.service` as its failure handler for the established Telegram incident path.
- The installed build verifier and watchdog SHA-256 values match the approved staged files.
- The subscription lifecycle job remains active on `17 * * * *`; its first three scheduled production runs at 18:17, 19:17, and 20:17 SAST succeeded.
- Ended subscriptions still marked active: 0.
- Test account `jcoetzer238@gmail.com`: three ended segments are expired and the valid segment ending `2026-10-20T12:40:03.863462Z` remains active.
- Pre-deployment static backup retained at `C:\Users\coetz\OneDrive\Documents\MRC Website Live Releases\20261017-df24c8d\Deployment\Xneelo Backups\public_html-before-20261017-180351.zip`; archive integrity passed before deployment.
- No development-site, Peach payment, communication-preference, revenue-panel, or MFA-bypass change was included.

## Failure handling

- If the database migration fails, the transaction rolls back and the existing live site remains compatible.
- If the static build fails, do not deploy files.
- If Xneelo deployment or smoke testing fails, use the deployment script's immediately preceding static release backup; do not restore an old database dump.
- If a database defect is found after commit, apply a new forward-only corrective migration.
- Pause only the component responsible for the fault. Do not pause the Hermes worker for a frontend, subscription, or Xneelo issue.
- Keep Telegram alerts enabled for watcher or deployment-service failures.

## Approval gate

Do not apply the production migration, push the live source commit, deploy Xneelo files, alter timers, or install systemd units until the operator explicitly approves this release.
