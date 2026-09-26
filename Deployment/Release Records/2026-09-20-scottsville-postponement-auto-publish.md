# Scottsville Postponement And Automatic Race Publishing

## Incident

- The Hollywoodbets Scottsville meeting scheduled for 20 September 2026 was postponed to 21 September 2026.
- Hermes fetched a complete eight-race card with 110 runners, but the bridge could not apply it.
- The website therefore retained the obsolete 20 September meeting until the production repair was applied.

## Root Causes

1. `app_private.reconcile_postponed_race_meetings` used `min(id)` on a UUID column. PostgreSQL has no `min(uuid)` aggregate, so every verified postponement failed during proposal handoff.
2. A proposal supported by one approved source is intentionally capped at 70 percent confidence, while the production threshold was 90 percent. Complete one-source cards could not auto-apply.
3. The paid-search daily budget was exhausted at 82 of 25 queries. `claim_race_feed_task_plan` incorrectly blocked local Hermes tasks even though those jobs do not consume the paid search provider.
4. PostgREST errors are plain objects. The bridge only preserved messages from `Error` instances, so the database fault was reduced to `Unexpected Hermes race bridge failure.`

## Changes

- Applied migration `20260920175818_repair_postponed_meeting_auto_publish`.
  - Replaced `min(uuid)` with a deterministic ordered UUID aggregate.
  - Preserved the existing meeting, fixture, card, purchase, and entitlement identities across a verified postponement.
  - Rejected obsolete result proposals and cancelled obsolete result tasks and queued jobs.
  - Allowed complete, conflict-free proposals from one approved source to auto-apply at the designed 70 percent single-source confidence cap.
- Applied migration `20260920180645_allow_hermes_tasks_past_search_limit`.
  - Paid-search limits continue to protect Gemini-backed work.
  - Tasks explicitly delegated to Hermes continue after the paid-search budget is exhausted.
- Deployed `hermes-race-bridge` version 28.
  - Plain PostgREST error messages are now sanitized and retained for diagnostics.

## Production Repair

- Replayed the stored verified Scottsville result after the migration passed a rollback-only production preflight.
- Preserved meeting ID `c2099d12-cc96-46bf-af97-aadee6b22361`.
- Moved the meeting from 20 September to 21 September 2026.
- Applied eight fixtures and 110 runners.
- Removed the duplicate/stale 20 September meeting representation.
- Cancelled eight obsolete result tasks.

## Verification

- Rollback-only replay verified meeting identity, fixture uniqueness, runner reconciliation, task cleanup, and automatic approval.
- The 18:07 UTC cron execution claimed the Scottsville schedule task despite the exhausted paid-search budget.
- The Hermes server claimed the job at 18:11 UTC and completed it at 18:12 UTC.
- The fresh proposal used two approved sources, scored 99.25 percent, and auto-applied without an error.
- Live homepage verification showed Scottsville on Monday, 21 September with races 1 through 8 at 12:07, 12:45, 13:20, 13:55, 14:30, 15:05, 15:40, and 16:15 SAST.
- Supabase security and performance advisors reported no finding tied to either replaced function.

## Backup And Rollback

- Pre-change snapshot: `C:\Users\coetz\OneDrive\Documents\MRC Website Production Backups\scottsville-postponement-before-20260920-1800.json`
- Database changes are forward-only. If compensation is required, restore the captured meeting and fixture schedule, return the confidence and source thresholds to their prior values, and replace the two functions from the preceding migration definitions.

## Source Evidence

- Race Coast postponement notice: `https://www.racecoast.co.za/please-note-hollywoodbets-scottsville-meeting-scheduled-for-20-september-2026-has-now-been-postponed-to-21-september-2026/`
- Formgrids meeting card: `https://www.formgrids.info/subscriber/fgRaceCards.aspx?opt=FullCard&fc=2026-09-21,Scottsville,ZA`
