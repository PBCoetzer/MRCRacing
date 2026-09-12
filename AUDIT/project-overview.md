# Production Readiness Project Overview

Audit snapshot: 2026-09-13 00:28 SAST  
Baseline commit: `fb668805b69bc709aed3a2a555c40a653716a131`  
Audit branch: `codex/production-readiness-audit`

## Scope

- Production-equivalent worktree: `C:\Users\coetz\OneDrive\Documents\MRC Website Hermes Bridge`
- Frontend: Next.js 16 static export in `Frontend`, React 19, TypeScript, Tailwind CSS, Radix/shadcn components.
- Backend: Supabase PostgreSQL, Auth, RLS, RPCs, Storage, Cron, queues, and Edge Functions in project `MRCRacing`.
- Hosting: Xneelo Apache static hosting deployed by the rollback-safe SFTP scripts in `Deployment`.
- Public site: `https://www.mrcracing.co.za` with apex and HTTP canonical redirects.
- Legacy code: `frontend-app` is an inactive starter shell and is not part of the active deployment.

## Safety Baseline

- External backup: `C:\Users\coetz\OneDrive\Documents\MRC Website Audit Backups\mrc-production-audit-baseline-20260913-000355.tar.gz`
- Backup SHA-256: `ACCEDA33D1CA783C92331900DF0471747DB21C6DE4EF626A16963CDA07894C09`
- The backup excludes Git metadata, dependencies, build output, environment files, credentials, secrets, deployment archives, and generated temporary files.
- The 149 pre-audit worktree changes were scanned and committed as the immutable sanitized baseline.
- Production customer data, balances, and provider endpoints were not mutated during the audit.

## Architecture Map

| Layer | Active implementation | Trust boundary |
| --- | --- | --- |
| Browser | Static Next.js pages and client-side Supabase SDK | Publishable key only; no service key |
| Identity | Supabase Auth | Hosted Auth service, Turnstile on registration |
| Data API | PostgREST tables and `SECURITY DEFINER` RPCs | RLS plus explicit function authorization |
| Payments | Ozow and PayFast Edge Functions | Signed callbacks plus provider verification |
| Credits | Transactional PostgreSQL functions | Row locks, unique idempotency keys, immutable ledger |
| Notifications | PostgreSQL outbox/queues and Supabase Edge workers | Worker tokens, signed webhooks, provider credentials |
| Race feed | Cron, Edge workers, proposal/review workflow | Allowlisted sources and admin approval controls |
| Static deploy | Local build, Xneelo SFTP, HTML-last upload | DPAPI credential outside Git and remote backup |

## Current Verification Evidence

- ESLint passes.
- TypeScript `--noEmit` passes.
- Raw Next build succeeds and emits 69 routes.
- `build:static` fails because the terms-version audit still expects removed hard-coded constants; see `CQ-001`.
- All 43 crawled sitemap URLs resolve to final HTTP 200 responses with a title, description, and canonical URL.
- Thirty-seven Deno tests pass when invoked with their function-specific import maps.
- Production dependency audit reports one critical and three high vulnerabilities; see `SEC-001`.
- Live read-only financial and referential-integrity checks returned zero invariant violations.
- WhatsApp is not implemented. Telegram and SMS notification paths are present.

## Constraints

- Google Search Console, payment-provider dashboards, email-provider dashboards, DNS, and Xneelo server logs require external owner access and are listed as manual verification actions.
- Any database migration, Edge Function deployment, frontend upload, or production configuration change requires explicit approval after local remediation and verification.
