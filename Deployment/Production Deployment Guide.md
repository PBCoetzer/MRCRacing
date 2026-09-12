# Production Deployment Guide

Status: audited local release process; production deployment requires explicit approval

## Production Map

- Source worktree: `C:\Users\coetz\OneDrive\Documents\MRC Website Hermes Bridge`
- Frontend: Next.js static export hosted from Xneelo `public_html`
- Backend: Supabase project `MRCRacing` (`cjgfvqgiqrphmakruqnk`)
- Deployment workflow: database migrations, Edge Functions, static frontend, smoke tests
- Rollback: forward-only database compensation plus the timestamped Xneelo backup produced by the deploy helper

Never store credentials, customer data, provider payloads, deployment archives, or environment files in Git. Generated exports, archives, local secrets, and backups are already ignored.

## Release Gate

Production remains blocked until all of the following are true:

1. `AUDIT/FINAL-REPORT.md` has no open critical or high finding that affects the release.
2. The working tree contains only the reviewed commits intended for release.
3. The linked migration list has been reconciled and every new migration has been reviewed.
4. The complete local verification suite passes.
5. A database backup or Supabase point-in-time recovery window is confirmed for risky data changes.
6. The Xneelo credential and SSH host key are available outside Git.
7. The user explicitly approves production deployment after reviewing the final report.

An earlier approval for a different change does not approve this audit release.

## Local Verification

```powershell
Set-Location "C:\Users\coetz\OneDrive\Documents\MRC Website Hermes Bridge\Frontend"
npm ci
npm audit --omit=dev --audit-level=high
npm run verify:local
Set-Location ..
npx supabase migration list --linked
```

`npm run verify:local` runs ESLint, TypeScript, all Deno Edge tests, terminology validation, the 69-route static build, and static artifact verification. Database contract tests run in CI against a fresh isolated Supabase instance with every migration applied.

Before release, also rerun the Supabase security and performance advisors and record any accepted residual finding in `AUDIT/FINAL-REPORT.md`.

## Release Artifact

Use `Frontend/out` only after the verification command succeeds. If a ZIP is required for manual inspection, create it outside the repository, include the commit SHA in its filename, calculate SHA-256, and delete it after the retention window. Do not recreate `Deployment/mrc-racing-tips-xneelo-static.zip` in Git.

## Deployment Order

### 1. Database migrations

1. Confirm the production migration list still matches the audited baseline.
2. Review new SQL for locks, data rewrites, grants, RLS, RPC compatibility, and forward-only recovery.
3. Export affected data before any risky migration.
4. Apply only reviewed migrations in version order.
5. Run focused read-only verification queries and both Supabase advisors.

Never apply a migration merely to test its syntax against production. Prepare compensating SQL for changes that cannot be transactionally reversed.

### 2. Edge Functions

Deploy only maintained functions declared in `supabase/config.toml`. Preserve the reviewed JWT setting for each function. Do not redeploy or remove the legacy `deliver-tip-notifications` function without a separately approved cleanup because that changes production state.

After each deployment, verify the function version and perform only invalid or non-mutating probes against payment and webhook endpoints. Never create a real charge or adjust a wallet for a smoke test.

### 3. Static frontend

The deploy command requires an approval reference and refuses an unverified export:

```powershell
Set-Location "C:\Users\coetz\OneDrive\Documents\MRC Website Hermes Bridge"
.\Deployment\Deploy-Xneelo.ps1 -ApprovalReference "approved-by-owner-YYYYMMDD-HHMM"
```

The deploy helper:

1. Uses the DPAPI-protected credential under ignored `Deployment/.secrets`.
2. Enforces the configured SSH host key.
3. Downloads the current `public_html` tree into an ignored timestamped backup.
4. Uploads assets before HTML.
5. Verifies deployed files by SHA-256.
6. Removes stale frontend files only after successful verification.

Upload the contents of `Frontend/out` directly into `public_html`; never create `public_html/out/index.html`.

### 4. Production smoke tests

Verify at minimum:

- `/`, `/pricing/`, `/tipsters/`, `/blog/`, `/horse-racing/`, `/horse-care/`
- `/login/`, `/register/`, `/forgot-password/`, `/reset-password/`
- authenticated `/client/`, `/tipster/`, and `/admin/` role boundaries
- one existing entitled card view without a new purchase
- metadata, canonical URL, sitemap, robots, dynamic blog/tipster HTML, and custom 404 behavior
- RSC prefetch aliases return 200 during client navigation
- payment return pages display safely without finalizing a payment
- notification, race-feed, Hermes, and site-build queue summaries remain within runbook thresholds

Run mobile, tablet, and desktop checks without changing production data.

## Rollback

### Frontend

1. Stop further uploads.
2. Retain the failed deployment output and generated backup path.
3. Restore the timestamped `public_html-before-*.zip` backup over `public_html`.
4. Verify hashes and rerun public smoke tests.

### Edge Functions

Redeploy the last known-good committed function version and confirm its JWT setting. Do not change database state as part of an Edge rollback unless the reviewed compensating migration requires it.

### Database

Database migrations are forward-only. Apply the prepared compensating SQL or restore from the approved backup/PITR path. Escalate any payment, Credit, entitlement, or refund inconsistency before allowing new financial operations.

## Required Release Record

Record the approval reference, commit SHA, migration versions, Edge Function versions, static artifact SHA-256, Xneelo backup path, smoke-test result, advisor result, operator, and timestamps. Never include secret values or private customer data.
