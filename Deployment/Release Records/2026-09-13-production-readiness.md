# Production Release Record — 13 September 2026

## Scope

- Branch: `codex/production-readiness-audit`
- Revision: `35f6d190d15aaa407f4be1b5c66a072e81fdaa93`
- Database project: `MRCRacing` (`cjgfvqgiqrphmakruqnk`)
- Frontend host: Xneelo `public_html`
- Approval references: `owner-approved-20260913-104446`, `owner-approved-20260913-105628`

## Backups

| Purpose | File | Bytes | Entries | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Independent pre-change backup | `Deployment/Xneelo Backups/public_html-before-20260913-104447.zip` | 12,054,077 | 1,024 | `75D24D2638386CBFA91791B8222147ACC760A73B5D799655D2B5D22DABDC3D4B` |
| Automatic pre-upload backup | `Deployment/Xneelo Backups/public_html-before-20260913-105637.zip` | 12,054,077 | 1,024 | `75D24D2638386CBFA91791B8222147ACC760A73B5D799655D2B5D22DABDC3D4B` |

Both backups are identical, outside Git tracking, and suitable for frontend rollback.

## Database Deployment

- Applied `20260912225129_email_marketing_consent.sql`.
- Applied `20260912232015_add_financial_fk_indexes.sql`.
- Confirmed all 106 local and remote migration versions align.
- Confirmed explicit marketing consent defaults off and anonymous execution is denied.
- Confirmed all eight targeted financial/entitlement indexes exist.
- Re-ran 13 financial invariants; every violation count remained zero.
- Re-ran Supabase security/performance advisors. Remaining warnings are tracked in the audit and were not introduced by these migrations.

## Frontend Deployment

- Verified 474 local artifact files before credential use.
- Uploaded 431 changed files.
- Retained 43 files already current.
- Removed 262 stale managed files.
- Preserved 395 legacy/system files outside the managed artifact.
- Verified remote files by SHA-256 after upload.
- Did not redeploy unchanged Edge Functions.
- Did not remove the obsolete `deliver-tip-notifications` worker because caller confirmation and separate approval remain required.

## Production Smoke Verification

- All 43 sitemap URLs return direct HTTP 200 with title and canonical metadata.
- CSP is enforced; no report-only CSP header remains.
- Dynamic blog article and comment interface render live.
- Anonymous client, tipster, and admin routes show login-required boundaries.
- Registration form, email field, and age declaration render live.
- Homepage, blog, registration, client, tipster, and admin shells fit a 390×844 viewport without horizontal overflow.
- Route-payload alias returns HTTP 200; unknown route returns HTTP 404.

## Release Decision

**CONDITIONAL GO.** The deployed code, schema, data invariants, public/private boundaries, and frontend rollback path are verified. Full GO requires the external Auth email delivery/bounce rollout, external uptime/error alert routing, owner-controlled gateway settlement reconciliation, leaked-password protection, and the first hosted CI run.
