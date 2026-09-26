# Greyville Postponement And Race Queue Repair

> Incident note, 20 September 2026: deployment step 5 used an older `origin/main` frontend and unintentionally rolled back newer application features. The Greyville database and Edge Function corrections remained valid. The current audited frontend was restored and verified in `2026-09-20-frontend-rollback-restoration.md`.

## Status

- Production deployment completed on 19 September 2026 after the platform owner approved the Greyville release.
- The existing Greyville meeting moved from 18 September 2026 to 20 September 2026 without replacing its published tip card, purchase, or entitlements.
- The public racecard, race listing, and sitemap now expose Greyville on 20 September; the stale 18 September route returns HTTP 404.
- Release decision: **GO** for this scoped correction.

## Root Cause

- Weekly discovery correctly found Greyville on 20 September and created a `meeting_schedule` task.
- `sync-race-data` marked that source task as completed immediately after placing an asynchronous Hermes job on the queue.
- Eight repeated Greyville result tasks for the postponed 18 September meeting flooded the single worker with obsolete work.
- The valid 20 September schedule job waited behind those result jobs until its two-hour deadline expired.
- The Hermes claim query permanently excluded expired jobs but left them in the `queued` state, so the task appeared successful while no proposal or replacement meeting existed.
- The ingestion path treated the new date as an unrelated meeting and had no safe way to preserve an existing published card across a postponement.

## Changes

- Prioritizes meeting schedules and race details ahead of result refresh jobs.
- Deduplicates active Hermes jobs by source task so five-minute result polling cannot create a queue flood.
- Marks expired jobs as failed with an explicit audit event instead of leaving them invisibly queued.
- Keeps delegated source tasks pending until Hermes has returned and handed off the result.
- Uses 24-hour deadlines for calendar and meeting schedules, 12 hours for race details, and two hours for result refreshes.
- Reconciles a postponed meeting only when venue, race count, absence of official results, and at least 80% of race-number/horse identities match.
- Reuses the existing meeting ID so tip cards, purchases, entitlements, selections, revisions, and access logs remain attached.
- Includes a guarded Greyville repair using the verified 20 September race times and official postponement notice.
- Stops queued 18 September result jobs, reschedules result polling to the corrected race times, and reopens the 20 September Hermes verification job.
- Realigns selection locks to the postponed fixture start times only when a meeting-date change was recorded and the affected fixtures have no results.

## Verified Greyville Schedule

- Race 1: 13:07 SAST
- Race 2: 13:45 SAST
- Race 3: 14:20 SAST
- Race 4: 14:55 SAST
- Race 5: 15:30 SAST
- Race 6: 16:05 SAST
- Race 7: 16:40 SAST
- Race 8: 17:15 SAST

## Verification

- Full migration executed against production inside a transaction and rolled back successfully.
- Rollback validation produced one scheduled Greyville meeting on 20 September with the existing published card and both existing entitlements preserved.
- Queue simulation confirmed a duplicate source poll reused the existing Hermes job instead of creating another job.
- Queue simulation confirmed the Greyville 20 September meeting schedule was claimed ahead of result refresh work.
- `deno check` passed for `sync-race-data` with its function import map.
- `sync-race-data` tests passed: 13/13.
- Production retained meeting ID `5d3110a8-30d6-4520-887c-35043e4fcdab`, card ID `3e776cef-74ee-43e9-9277-67284bcba308`, one purchase, and two entitlements.
- All eight production fixtures are scheduled on 20 September and all eight selection locks equal their corrected start times.
- Hermes job `42dc69cc-b72c-44d1-bbd5-a39421265eb5` was claimed by `influx-hermes-01`, returned, accepted, and handed off as proposal `874b469b-8dcf-485f-9753-b4b2ed44dd96`.
- The content build completed successfully. Its automatic worker was still configured for shadow mode, so the clean `origin/main` export was rebuilt and promoted with the rollback-safe Xneelo helper.
- Local clean-export validation passed: Next static build, TypeScript during build, ESLint with zero warnings, 74 HTML files, corrected Greyville route, corrected sitemap, and no stale Greyville route.
- Production smoke tests passed for `/`, `/horse-racing/`, the corrected Greyville page, `sitemap.xml`, `robots.txt`, and `/login/`.
- `https://www.mrcracing.co.za/horse-racing/greyville/2026-09-20/` returns HTTP 200 with the correct title; the 18 September URL returns HTTP 404.

## Deployment Order

1. Applied production migration `20260919152904_repair_postponed_meeting_queue`.
2. Applied production migration `20260919153314_align_postponed_meeting_selection_locks` after verification exposed the published-card lock preservation trigger.
3. Deployed `sync-race-data` Edge Function version 79 with `verify_jwt=false`, preserving its custom worker and administrator authentication.
4. Confirmed the Greyville schedule job was claimed, returned, accepted, and handed off.
5. Built and deployed clean `origin/main` commit `57a0a393fb76e7e41c04467c1d6aa857e6ff40f5` to Xneelo.
6. Uploaded 819 changed files, retained 88 current files, removed 30 stale generated files, and hash-verified 907 release files.

## Backups And Release Evidence

- Approval reference: owner approval in the Greyville deployment conversation on 19 September 2026.
- Targeted database backup: `C:\Users\coetz\OneDrive\Documents\MRC Website Backups\greyville-before-20260919-152755.json`
- Database backup SHA-256: `24E433A2473872F72C172C2DEDE4493EFA7AE212E5B0919F3D717816192A18B9`
- Xneelo backup: `C:\Users\coetz\OneDrive\Documents\MRC Website Backups\public_html-before-greyville-20260919-174147.zip`
- Xneelo backup SHA-256: `98962825AD03282804B09110FF8C48C320286E0270BE6AD77231918ACD8EFF68`
- Corrected Greyville page SHA-256: `91FC5099CCF7F9D50118E7C1FA1A116FC191D112E48E4A566D1235153F371F86`

## Advisor Follow-Up

- No advisor call failed after deployment.
- Existing security-advisor backlog remains: six RLS-without-policy informational findings, eight anonymous and 75 authenticated executable `SECURITY DEFINER` warnings, and leaked-password protection disabled.
- Existing performance-advisor backlog remains: 46 unindexed foreign keys, 34 unused indexes, and 39 multiple-permissive-policy warnings.
- These pre-existing audit items are outside this scoped correction and remain tracked by the production-readiness audit.

## Rollback

- The migration is forward-only once deployed because it corrects live meeting identity and audit history.
- Before deployment, export the affected Greyville meeting, fixtures, entries, tip card, entitlements, race-feed tasks, and Hermes jobs.
- If compensation is required, restore those rows from the export and redeploy the previous `sync-race-data` Edge Function version.
