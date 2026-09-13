# Security Audit

## Controls Verified

- No private credential or service-role secret is shipped in the static frontend.
- All exposed public-schema tables have RLS enabled.
- Payment callbacks reject missing or invalid signatures and do not credit from browser return parameters.
- Privileged RPCs sampled during the audit use an empty `search_path` and explicit administrator, owner, or service-role checks.
- Public storage is limited to blog WebP media; tipster application documents remain private and path-scoped.
- Anonymous probes could not read payments, invoke admin RPCs, create checkouts, or pass invalid gateway callbacks.

## SEC-001 — Vulnerable production framework dependency

| Field | Value |
| --- | --- |
| Severity | Critical |
| Area | Dependency security |
| Problem | `next@16.2.11` is affected by current critical and high advisories; transitive PostCSS, Sharp, and NanoID advisories are also present. |
| Impact | A vulnerable production dependency can expose the application or build environment to remote-code-execution, image-processing, file-read, or identifier-generation weaknesses depending on the deployed feature path. |
| Redacted evidence | `npm audit --omit=dev` reports 1 critical and 3 high findings and recommends Next `16.3.5`. |
| Object | `Frontend/package.json`, `Frontend/package-lock.json` |
| Recommended fix | Upgrade Next and `eslint-config-next` to the patched compatible release, regenerate the lockfile, and rerun the full build and dependency audit. |
| Verification | `npm audit --omit=dev`, ESLint, TypeScript, static build, browser smoke tests. |
| Status | Fixed and deployed from `bf9fa0f`; Next and `eslint-config-next` are `16.3.5`, the full build passes, and `npm audit --omit=dev` reports zero vulnerabilities. |

## SEC-002 — CSP is report-only

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Browser security headers |
| Problem | Xneelo sends `Content-Security-Policy-Report-Only`; violating script, frame, image, or connection loads are reported by the browser but not blocked. |
| Impact | A future injection or compromised third-party resource receives less browser containment than the declared policy implies. |
| Redacted evidence | Live response and `Frontend/public/.htaccess` contain only the report-only header. |
| Object | `Frontend/public/.htaccess` |
| Recommended fix | Enforce the verified policy, retain only required origins, and smoke-test Auth, Turnstile, analytics, Supabase, video, and payment journeys. |
| Verification | Live header check plus browser console/network smoke tests. |
| Status | Fixed and deployed from `bf9fa0f`; production smoke confirms enforced CSP and no report-only CSP header. |

## SEC-003 — Compromised-password protection is disabled

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Authentication |
| Problem | Supabase Auth leaked-password protection is disabled. |
| Impact | Users can select passwords known to occur in breach corpuses, increasing account-takeover risk. |
| Redacted evidence | Live Supabase security advisor warning. |
| Object | Supabase Auth password settings |
| Recommended fix | Enable leaked-password protection in Supabase Auth and verify registration and password-reset behavior. |
| Verification | Supabase advisor clears and a controlled compromised-password test is rejected. |
| Status | External configuration action required |

## SEC-004 — Large executable `SECURITY DEFINER` surface

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Database API authorization |
| Problem | Supabase reports 8 anonymous and 74 authenticated executable `SECURITY DEFINER` functions. Many are intentional APIs, but legacy overloads and broad grants expand the review surface. |
| Impact | A future function missing an internal ownership or role check could bypass RLS with owner privileges. |
| Redacted evidence | Live advisors list 82 externally executable definer functions. Sampled financial/admin functions passed authorization and `search_path` review. |
| Object | Public RPC grants and function definitions |
| Recommended fix | Maintain an allowlist, revoke obsolete overloads, move worker-only helpers to `app_private`, and add automated role-contract tests. |
| Verification | Advisor diff, grant inventory, anonymous/authenticated negative tests, and rollback-only role simulations. |
| Status | Mitigated locally in `9ac65c7`; a maintained anonymous allowlist, grant checks, and pinned-`search_path` pgTAP contracts were added. Live read-only checks found zero unexpected anonymous definer functions and zero unpinned application definer functions. Broader authenticated actor tests remain. |

## SEC-005 — Obsolete deployed notification function is not reproducible

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Edge Function supply chain |
| Problem | Live Supabase contains `deliver-tip-notifications` version 18, but no matching local source or config exists. The active cron uses `process-tip-notifications`; the obsolete endpoint remains deployed with an outdated email footer. |
| Impact | Production includes unaudited drift that cannot be rebuilt from Git and unnecessarily increases the callable attack surface. |
| Redacted evidence | 15 live functions versus 14 local function directories; no active cron references the obsolete slug. |
| Object | Supabase Edge Function `deliver-tip-notifications` |
| Recommended fix | Confirm no external caller depends on it, then remove or disable the obsolete function after approval. |
| Verification | Function inventory, cron inventory, logs for recent invocation, then a 404/disabled response after removal. |
| Status | Open; production cleanup requires approval |

## Advisor Notes

- Six RLS-enabled/no-policy tables are server-only queue/audit tables. This is safe only while table grants remain revoked; retain a grant regression test.
- Supabase remediation references: [anonymous definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
