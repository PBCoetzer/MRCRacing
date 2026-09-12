# Master Findings Register

Initial release decision: **NO-GO**  
Reason: one critical dependency finding and multiple high release blockers remain open.

| ID | Severity | Area | Short problem | Initial status |
| --- | --- | --- | --- | --- |
| SEC-001 | Critical | Security | Vulnerable Next production dependency | Open |
| SEC-002 | High | Security | CSP is report-only | Open |
| SEC-003 | Medium | Auth | Leaked-password protection disabled | External action |
| SEC-004 | Medium | Database API | Large definer-function execute surface | Open |
| SEC-005 | Medium | Edge Functions | Obsolete deployed worker missing from Git | Open |
| FIN-001 | Medium | Payments | Provider settlement evidence external | Manual test |
| ACC-001 | Medium | Access | Private shells use client-side presentation gate | Accepted risk/test gap |
| ACC-002 | Medium | Access | RPC permission matrix lacks automation | Open |
| SEO-001 | Medium | SEO | Sitemap static URLs redirect | Open |
| SEO-002 | High | SEO | Dynamic primary content missing from initial HTML | Open |
| SEO-003 | Medium | SEO | Static route-payload aliases return 404 | Open |
| PERF-001 | High | Performance | LCP is 6.8–10.0 seconds | Open |
| PERF-002 | Medium | Performance | Priority hero image is 1.78 MiB | Open |
| PERF-003 | Medium | Performance | 453–767 KiB estimated unused JS | Open |
| A11Y-001 | Medium | Accessibility | Live badge contrast is insufficient | Open |
| A11Y-002 | Medium | Accessibility | No authenticated axe/keyboard coverage | Open |
| UX-001 | Medium | UI/UX | Dense mobile tables hide actions off-screen | Open |
| UX-002 | Medium | UI/UX | No route-level error boundary | Open |
| DB-001 | High | Database | Local/live migration history drift | Open |
| DB-002 | Medium | Database | 54 unindexed foreign keys | Open |
| DB-003 | Low | Database | 39 multiple-permissive policy cases | Open |
| DB-004 | Low | Database | Server-only no-policy posture needs regression check | Open |
| CQ-001 | High | Build | Stale terms validator blocks static release | Open |
| CQ-002 | Medium | Code quality | Oversized multi-responsibility modules | Open |
| CQ-003 | Medium | Tests | Edge tests need multiple undocumented commands | Open |
| CQ-004 | High | CI | No continuous integration gate | Open |
| CQ-005 | Low | Hygiene | Inactive legacy frontend remains | Open |
| PRIV-001 | High | Privacy | All-client marketing email lacks separate consent | Open |
| PRIV-002 | Medium | Privacy | Data-subject request process is manual | Open |
| PRIV-003 | Medium | Privacy | No operational retention schedule | Open |
| MON-001 | High | Monitoring | No centralized error/uptime alerting | Open |
| MON-002 | High | Auth email | Delivery and bounce tracking inactive | External action |
| MON-003 | Medium | Monitoring | Queue freshness thresholds undefined | Open |
| DEP-001 | High | Deployment | Function config differs from live/source inventory | Open |
| DEP-002 | High | Deployment | No verified release artifact pipeline | Open |
| DEP-003 | Medium | Deployment | No isolated integration environment | Owner decision |
| DEP-004 | Low | Deployment | Runbook paths and archive steps are stale | Open |

## Evidence Standard

Each finding's full problem, impact, redacted evidence, object, recommended fix, verification method, and status are maintained in its domain report. IDs are permanent; resolved findings remain in the register with an updated status rather than being deleted.
