# Master Findings Register

Initial release decision: **NO-GO**

Current release decision: **CONDITIONAL GO after approved production rollout**

Reason: no critical finding remains, production schema/frontend deployment and rollback were verified, and financial/access/blog boundaries remain clean. Full GO requires external Auth delivery, monitoring, settlement, and hosted-CI evidence.

| ID | Severity | Area | Short problem | Current status |
| --- | --- | --- | --- | --- |
| SEC-001 | Critical | Security | Vulnerable Next production dependency | Fixed and deployed; zero npm vulnerabilities |
| SEC-002 | High | Security | CSP is report-only | Fixed and verified live; enforced CSP present |
| SEC-003 | Medium | Auth | Leaked-password protection disabled | Open external configuration |
| SEC-004 | Medium | Database API | Large definer-function execute surface | Mitigated with allowlist/grant tests; broader actor matrix pending |
| SEC-005 | Medium | Edge Functions | Obsolete deployed worker missing from Git | Open separate cleanup approval and caller confirmation |
| FIN-001 | Medium | Payments | Provider settlement evidence external | Open owner-controlled acceptance test |
| ACC-001 | Medium | Access | Private shells use client-side presentation gate | Accepted architecture risk; artifact scan and live anonymous checks pass |
| ACC-002 | Medium | Access | RPC permission matrix lacks automation | Partially fixed with 17 pgTAP contracts including six blog contracts |
| SEO-001 | Medium | SEO | Sitemap static URLs redirect | Fixed and verified live across 43 direct URLs |
| SEO-002 | High | SEO | Dynamic primary content missing from initial HTML | Fixed and deployed; export and live article checks pass |
| SEO-003 | Medium | SEO | Static route-payload aliases return 404 | Fixed and deployed; 63 aliases verified locally and a live alias returns 200 |
| PERF-001 | High | Performance | LCP is 6.8–10.0 seconds | Mitigated to 3.0–3.5 seconds in release artifact; hosted retest pending |
| PERF-002 | Medium | Performance | Priority hero image is 1.78 MiB | Fixed and deployed with 84,870-byte WebP |
| PERF-003 | Medium | Performance | 453–767 KiB estimated unused JS | Mitigated to 87–91 KiB; staged optimization remains |
| A11Y-001 | Medium | Accessibility | Live badge contrast is insufficient | Fixed and deployed; local Lighthouse passes |
| A11Y-002 | Medium | Accessibility | No authenticated axe/keyboard coverage | Partial manual coverage; synthetic environment pending |
| UX-001 | Medium | UI/UX | Dense mobile tables hide actions off-screen | Primary tipster list fixed; lower-priority tables remain |
| UX-002 | Medium | UI/UX | No route-level error boundary | Fixed and deployed |
| DB-001 | High | Database | Local/live migration history drift | Fixed; all 106 migration versions align |
| DB-002 | Medium | Database | 54 unindexed foreign keys | Eight financial/entitlement indexes deployed; lower-priority indexes remain |
| DB-003 | Low | Database | 39 multiple-permissive policy cases | Deferred until full actor matrix exists |
| DB-004 | Low | Database | Server-only no-policy posture needs regression check | Fixed with pgTAP and live read-only checks |
| CQ-001 | High | Build | Stale terms validator blocks static release | Fixed; release build passes and verified artifact is deployed |
| CQ-002 | Medium | Code quality | Oversized multi-responsibility modules | Open staged refactor |
| CQ-003 | Medium | Tests | Edge tests need multiple undocumented commands | Fixed; one command runs 43 tests |
| CQ-004 | High | CI | No continuous integration gate | Workflow fixed locally; first hosted run and secrets remain pending |
| CQ-005 | Low | Hygiene | Inactive legacy frontend remains | Deferred approved cleanup |
| PRIV-001 | High | Privacy | All-client marketing email lacks separate consent | Fixed and deployed; explicit opt-in defaults off and gates all-client announcements |
| PRIV-002 | Medium | Privacy | Data-subject request process is manual | Mitigated with operations runbook |
| PRIV-003 | Medium | Privacy | No operational retention schedule | Proposed schedule documented; owner approval pending |
| MON-001 | High | Monitoring | No centralized error/uptime alerting | Partial repository controls; external monitor/alerting open |
| MON-002 | High | Auth email | Delivery and bounce tracking inactive | Open external provider, DNS, hook, and webhook rollout |
| MON-003 | Medium | Monitoring | Queue freshness thresholds undefined | Thresholds and aggregate health queries documented |
| DEP-001 | High | Deployment | Function config differs from live/source inventory | Maintained config reconciled; obsolete live function cleanup pending |
| DEP-002 | High | Deployment | No verified release artifact pipeline | Verified local pipeline used successfully in production; first hosted CI run pending |
| DEP-003 | Medium | Deployment | No isolated integration environment | Local CI stack added; hosted environment remains open |
| DEP-004 | Low | Deployment | Runbook paths and archive steps are stale | Fixed and successfully exercised |

## Verification Snapshot

- `npm run verify:local`: pass.
- Deno Edge tests: 43 passed, 0 failed.
- Next static generation: 69 routes.
- Artifact validation: 66 HTML files, 43 sitemap routes, 4 dynamic pages, 63 payload aliases.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- Local Lighthouse: 91–94 performance, 100 accessibility, 100 best practices.
- Production read-only financial checks: 13 of 13 invariants at zero violations after migration deployment.
- Production blog/access checks: 193 active accounts, zero missing client roles, anonymous RPC denial, approved-author guards, and live mobile comment UI verified.
- Migration history: all 106 local and remote versions aligned.
- Production frontend: 474 files verified; all 43 sitemap URLs return direct 200 responses with enforced CSP.
- Rollback: two matching 1,024-entry Xneelo backups verified by SHA-256.

## Evidence Standard

Each finding's full problem, impact, redacted evidence, object, recommended fix, verification method, and status are maintained in its domain report. IDs are permanent; resolved findings remain in the register rather than being deleted.
