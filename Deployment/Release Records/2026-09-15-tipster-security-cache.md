# Tipster Account-Security Cache Hotfix

## Diagnosis

- All three live tipster accounts are active and email-confirmed.
- Two tipster accounts have a verified TOTP factor.
- The live account-security payload already contained the authentication-only role gate, so the repeated screenshot was not caused by missing tipster access or missing database roles.
- Apache returned mutable Next route-payload files such as `__next._full.txt` without a `Cache-Control` header. A mobile browser could therefore reuse the previous deployment's role-gate payload and continue showing the obsolete access error.

## Fix

- Added `no-store, max-age=0, must-revalidate`, `Pragma: no-cache`, and `Expires: 0` headers for every mutable `__next.*.txt` route payload.
- Kept content-hashed `/_next/static/` assets on the existing immutable one-year cache policy.
- Added a static-export regression check that fails the build if the route-payload cache rule is removed.

## Verification And Deployment

- Approval reference: `user-requested-tipster-security-cache-fix-20260915-075003`.
- Full verification passed: ESLint, TypeScript, 13 frontend tests, 44 Edge Function tests, terminology validation, 71-page static build, and static-export verification.
- Deployment verified 486 local files, uploaded 402, retained 84 current files, removed 3 stale managed files, and preserved 437 legacy/system files.
- Rollback backup: `Deployment/Xneelo Backups/public_html-before-20260915-075005.zip`, 13,409,868 bytes, 923 entries, SHA-256 `50601DEACE774989383A8247F304E764E063F2904BC9EAF338A3FEE7294195AB`.
- Live `/account/security/__next._full.txt` now returns the required no-store headers and contains `requireRole: false`.
