# Code Quality Audit

## CQ-001 — Production static build is blocked by a stale validator

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Build correctness |
| Problem | `audit-public-terminology.mjs` expects hard-coded terms-version constants that were removed when the app switched to authoritative dynamic terms RPCs. |
| Impact | The release command fails even though lint, TypeScript, and raw Next export pass; operators may bypass the required release script. |
| Redacted evidence | `npm run build:static` fails with “premium terms versions are not synchronized.” |
| Object | `Frontend/scripts/audit-public-terminology.mjs` |
| Recommended fix | Validate the current RPC-backed terms contract and authoritative migration instead of deleted UI constants. |
| Verification | Terminology audit and `build:static` both pass. |
| Status | Fixed in `9768710`; terminology validation checks the authoritative RPC-backed contract, `build:static` passes, and the verified artifact is deployed. |

## CQ-002 — Oversized multi-responsibility modules

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Maintainability |
| Problem | Several modules exceed 1,300 lines; the largest frontend component and race sync function are approximately 2,667 lines each. |
| Impact | Changes are harder to review and test, regressions affect wider surfaces, and client bundles are harder to split. |
| Redacted evidence | `admin-user-detail-client.tsx` 2,667 lines; `sync-race-data/index.ts` 2,666; two other frontend components exceed 1,500. |
| Object | Admin, client, tipster, and race-sync modules |
| Recommended fix | Extract typed domain hooks/services and lazy tab panels incrementally, without changing business contracts. |
| Verification | Focused tests remain green and route bundle sizes decrease. |
| Status | Open, staged refactor |

## CQ-003 — Deno tests require undocumented per-function commands

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Test reproducibility |
| Problem | A single repository-wide Deno test command fails because shared tests cannot resolve bare imports without a selected function import map. |
| Impact | Developers and CI can skip tests or run an incomplete subset accidentally. |
| Redacted evidence | At baseline, one command failed on `@supabase/supabase-js` and `spark-md5`; 37 tests passed only when split across function configs. |
| Object | Supabase Deno configuration and package scripts |
| Recommended fix | Add a root test runner or root Deno import map and one documented command for all Edge tests. |
| Verification | One command type-checks and runs every test. |
| Status | Fixed in `9ac65c7` and `6b22f51`; one pinned root Deno configuration runs all 43 Edge tests successfully. |

## CQ-004 — No continuous integration gate

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Change control |
| Problem | The repository has no CI workflow enforcing lint, TypeScript, static export, terminology, dependency, or Edge tests. |
| Impact | Broken or vulnerable changes can be merged and deployed without repeatable evidence. |
| Redacted evidence | No `.github/workflows` configuration exists. |
| Object | Repository automation |
| Recommended fix | Add a least-privilege CI workflow using public build credentials or mocked public content, with secrets kept in the platform secret store. |
| Verification | Pull requests require all checks to pass. |
| Status | Fixed in `9ac65c7`; the least-privilege GitHub Actions workflow runs an isolated Supabase database contract job plus the complete frontend, dependency, Edge, build, and artifact gate. The equivalent local pipeline produced the deployed artifact; repository-secret configuration and the first hosted run remain owner actions. |

## CQ-005 — Inactive legacy frontend remains in repository

| Field | Value |
| --- | --- |
| Severity | Low |
| Area | Repository hygiene |
| Problem | `frontend-app` contains a small starter application unrelated to the active `Frontend` deployment. |
| Impact | Contributors can edit or build the wrong application and automated scanners process dead code. |
| Redacted evidence | Active deployment scripts point to `Frontend`; `frontend-app` contains only four starter source files. |
| Object | `frontend-app` |
| Recommended fix | Archive or remove it in a separately approved cleanup commit after confirming no external workflow references it. |
| Verification | Repository search and deployment dry run use only `Frontend`. |
| Status | Open, non-blocking |
