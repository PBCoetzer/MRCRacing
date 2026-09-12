# Deployment Audit

## Strengths

- Xneelo deploy scripts use strict host-key checking, remote backup, assets-first/HTML-last order, SHA-256 verification, and delayed obsolete-file removal.
- Credentials are stored with Windows DPAPI outside Git.
- Generated output, stale Next trees, temporary files, backups, and deployment archives are ignored.
- Database changes are represented as forward migrations and Edge Functions have per-function import maps.

## DEP-001 — Supabase function config does not match production

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Deployment reproducibility |
| Problem | `supabase/config.toml` declares 9 functions, while 14 active local function sources exist and 15 functions are live. It also marks `blog-media-upload` as JWT-disabled although the live deployment has JWT verification enabled. |
| Impact | CLI deployment can omit functions or change authentication behavior unintentionally. |
| Redacted evidence | Local/live function and config inventory. |
| Object | `supabase/config.toml`, Supabase Edge Function metadata |
| Recommended fix | Declare every maintained local function with the correct entrypoint/import map/JWT mode and classify the extra live legacy function for removal. |
| Verification | Config inventory equals source inventory; live metadata matches after approved deployment. |
| Status | Fixed locally in `9768710`; all 14 maintained functions are declared with reconciled JWT/import-map behavior. The obsolete fifteenth live function remains an approved production-cleanup action under `SEC-005`. |

## DEP-002 — Release is not continuously verified

| Field | Value |
| --- | --- |
| Severity | High |
| Area | CI/CD |
| Problem | No CI gate runs the production build, tests, dependency audit, or artifact validation before deployment. |
| Impact | Local machine state becomes the only release gate and stale artifacts can be uploaded. |
| Redacted evidence | No workflow configuration exists; the required local release command currently fails (`CQ-001`). |
| Object | Repository automation and deployment process |
| Recommended fix | Add CI checks and generate a checksummed static artifact from a committed revision. Keep deployment as a separate approved action. |
| Verification | CI publishes a verified artifact only when every required check passes. |
| Status | Fixed locally in `9ac65c7` and `d87316d`; CI produces a verified artifact, and the Xneelo script requires an approval reference and reruns artifact verification before credentials are decrypted. First hosted CI execution remains pending. |

## DEP-003 — Environment separation is incomplete

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Change isolation |
| Problem | The audit found one live Supabase project and no maintained development branch/environment manifest for destructive integration testing. |
| Impact | Database and Auth integration changes are harder to test safely without touching production-equivalent services. |
| Redacted evidence | Supabase branch workflow is not documented in the repository. |
| Object | Supabase environment strategy |
| Recommended fix | Establish a non-production Supabase branch/project with synthetic data and environment-specific redirect/provider settings. |
| Verification | Migration reset, role tests, Auth tests, and Edge tests complete in non-production without customer data. |
| Status | Partially remediated; CI starts an isolated local Supabase stack and runs migration/pgTAP contracts without production data. A persistent hosted non-production Auth/provider environment remains an owner decision and may incur cost. |

## DEP-004 — Deployment guide contains stale paths and archive workflow

| Field | Value |
| --- | --- |
| Severity | Low |
| Area | Runbook accuracy |
| Problem | The guide still references an older `OneDrive\MRC Website` path and manual tracked ZIP workflow alongside the newer automated deployment. |
| Impact | An operator can build or upload from the wrong directory or recreate an unreviewed deployment archive. |
| Redacted evidence | Path and ZIP instructions differ from the active Hermes Bridge worktree and current ignore policy. |
| Object | `Deployment/Production Deployment Guide.md` |
| Recommended fix | Update the guide to the active worktree, verified build command, external artifact location, approval gate, and rollback procedure. |
| Verification | A dry run from a fresh checkout follows the documented commands without ambiguity. |
| Status | Fixed locally in `d87316d`; the runbook now uses the Hermes Bridge path, verified artifact workflow, explicit approval gate, database/functions/frontend order, Xneelo backup, and compensating-migration procedure. |
