# Turnstile Production Build Hotfix

Date: 17 October 2026
Target: `https://www.mrcracing.co.za`
Status: **Validated; production static deployment pending**

## Incident

The live login, registration, and password-recovery forms displayed `Authentication temporarily unavailable` because the 17 October static export was built from an isolated release checkout whose `NEXT_PUBLIC_TURNSTILE_SITE_KEY` value was empty.

The approved production configuration still contained the expected Cloudflare Turnstile public site key. The same key was also present in the verified pre-deployment Xneelo backup, confirming that this was a static-build packaging regression rather than a Cloudflare, Supabase, account, or credential failure.

## Correction

- Rebuild the unchanged production application with the approved production public environment values.
- Require the static verifier to find the configured Turnstile site key in the exported assets.
- Require the server build worker to run the static verifier before any deployment.
- Add the login route to the live watchdog and fail when the configuration-unavailable message is rendered.

## Safety boundary

- No user account was used to test the correction.
- No production database row, Supabase Auth setting, payment record, race, queue, or entitlement was changed.
- The Hermes race worker remains online.
- The existing verified full Xneelo backup at `Deployment/Xneelo Backups/public_html-before-20261017-180351.zip` remains the rollback baseline.

## Validation

- The new static verifier rejected the broken export because the Turnstile key was missing.
- The new watchdog rejected the broken live login page because it rendered the configuration-unavailable state.
- The corrected export contains the approved key and no longer renders the outage message.
- ESLint with zero warnings: passed.
- TypeScript: passed.
- Authentication tests: 25 passed, 0 failed.
- Production static build: 107 pages generated.
- Static export verification: 104 HTML files, 78 sitemap routes, 8 dynamic pages, and 101 payload aliases passed.

## Deployment verification required

After upload, verify the Turnstile challenge renders on login, registration, and password recovery; rerun the complete public-route watchdog; confirm all three production timers remain active; and install the updated verifier and watchdog without stopping the Hermes worker.
