# Access Control Audit

## Permission Matrix

| Capability | Anonymous | Client | Tipster | Administrator |
| --- | --- | --- | --- | --- |
| Public pages, published profiles/articles/race data | Read | Read | Read | Read |
| Own profile, wallet, purchases, subscriptions, entitlements | No | Own only | Own client account only | Audited admin views |
| View paid meeting-card content | No | Entitled/free only | Own cards | Audited admin access |
| Create or revise meeting cards | No | No | Own tipster record | Authorized admin/test path |
| Publish blog articles | No | Approved author only | Approved author only | Moderate/pin/approve |
| Configure roles, users, refunds, wallets | No | No | No | Administrator RPCs only |
| Payment completion | No | No | No | Service role after provider verification |

## ACC-001 — Private route shells rely on client-side gating

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Route authorization |
| Problem | Static-export private routes are downloadable HTML/JavaScript shells and `RoleGate` decides presentation after hydration. RLS/RPC checks, not the route shell, are the security boundary. |
| Impact | A route-name or component bundle can be inspected by anyone, and any future accidental static embedding of private data would be exposed. Current pages do not embed customer records in HTML. |
| Redacted evidence | No Next middleware/server runtime exists; private route pages wrap content in `RoleGate`. Anonymous table/RPC probes were denied or empty. |
| Object | `Frontend/src/components/auth/role-gate.tsx`, `/admin/`, `/client/`, `/tipster/` |
| Recommended fix | Keep all private data behind RLS/RPCs, add a build assertion that private HTML contains no sensitive payloads, and consider server-rendered hosting if route-level denial is required. |
| Verification | Anonymous artifact scan and negative API tests. |
| Status | Accepted architecture risk with automated artifact secret/private-key scanning in `9ac65c7`; data authorization remains at RLS/RPC boundaries. |

## ACC-002 — Privileged RPC authorization needs automated coverage

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Database authorization |
| Problem | The large role-sensitive RPC surface is protected mainly by repeated in-function checks, but no comprehensive permission-contract suite exists. |
| Impact | A future RPC or overload can accidentally permit cross-account reads or writes despite RLS. |
| Redacted evidence | Sampled anonymous/admin negative probes pass; Supabase reports 74 authenticated executable definer functions. |
| Object | Public RPCs, especially `admin_*`, purchase, refund, card, and wallet functions |
| Recommended fix | Add rollback-only tests for anonymous, client, tipster-owner, tipster-non-owner, administrator, and service roles against a maintained RPC allowlist. |
| Verification | Test suite proves every unauthorized case fails and every permitted ownership case succeeds. |
| Status | Partially remediated in `9ac65c7`; 11 pgTAP contracts cover RLS, private-schema grants, server-only tables, anonymous RPC allowlisting, search paths, and sampled privileged RPC denial. Final live read-only checks passed; full synthetic client/tipster/admin actor coverage requires the non-production environment in `DEP-003`. |

## Ownership Conclusions

- The inspected RLS policies use restrictive active-account gates plus ownership/visibility policies; the active-account policies do not independently grant table access.
- Browser role checks improve UX but are not trusted for data authorization.
- Service-role usage is confined to Edge Functions.
