# Formgrids Primary Feed and Secondary Consensus Alerts

## Status

- Implemented locally on 21 September 2026.
- Not deployed to production pending explicit approval.
- Production race data was not changed during development or verification.

## Source Policy

- Formgrids is the sole authoritative publishing feed.
- Ordinary Hermes race tasks are restricted to `formgrids.info`.
- Raceform and Tote are comparison-only sources and cannot publish race data.
- A secondary-source difference becomes reviewable only when at least two independent domains report the same normalized change within 30 minutes.
- Consensus creates an administrator Telegram and in-app alert containing the exact difference and evidence sources. It never changes the race entry.

## Implementation

- Added private forced-RLS tables for secondary checks, normalized observations, and deduplicated incidents.
- Added service-role-only RPCs for deterministic Tote changes and isolated Hermes comparison snapshots.
- Changed the Tote card-change worker from direct application to comparison evidence recording.
- Added isolated Raceform comparison jobs every ten minutes and retained a three-minute Tote comparison schedule during race-day hours.
- Prevented comparison-only Hermes results from entering the normal proposal or ingestion path.
- Added Telegram review messaging with no approve/apply action.
- Updated the Formgrids proposal gate so complete, conflict-free Formgrids snapshots can continue automatic publication at the configured confidence threshold.

## Verification

- The migration compiled against the live Supabase schema inside a transaction and was rolled back.
- Deno formatting and type checks passed for all changed Edge Functions.
- All 20 focused Deno tests passed: Tote parsing (2), Hermes contracts (9), and notification delivery/rendering (9).
- Rollback-only live-data simulations proved that deterministic Tote evidence and an isolated Raceform snapshot normalize to the same difference; one secondary source creates no incident, two matching sources create exactly one Telegram review incident, repeated evidence is deduplicated, and the underlying race entry remains unchanged.
- A separate rollback-only queue simulation proved that ordinary Hermes jobs are restricted to Formgrids and comparison jobs are isolated to Raceform.
- The migration and simulation were rolled back; production schema and race data remain unchanged.

## Deployment Order

1. Apply `20260921080521_formgrids_primary_secondary_consensus.sql`.
2. Deploy `sync-race-data`.
3. Deploy `hermes-race-bridge`.
4. Deploy `process-tip-notifications`.
5. Run one manual Tote comparison and one isolated Raceform comparison.
6. Confirm Telegram delivery, private comparison evidence, and unchanged race data.
7. Re-run Supabase security and performance advisors.

## Rollback

- Disable the two secondary-comparison cron jobs.
- Redeploy the previous Edge Function versions.
- Preserve comparison evidence and incidents for audit purposes.
- Use a compensating migration for database rollback; do not allow a secondary source to become a publisher during rollback.
