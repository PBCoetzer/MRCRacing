# Tipster Card Navigation Hotfix

## Approval and scope

- Owner approval: continue with the planned frontend-only production hotfix.
- Release commit: `48a0ab37341804bffb651c614546f0e6a371b7bc`.
- Scope: restore same-page Tipster dashboard shortcuts, browser-history synchronization, and clear active-card edit actions.
- Database migrations: none.
- Edge Function deployments: none.
- Financial freezes or mutations: none.

## Root cause and correction

- The shared workspace sidebar dispatched `mrc-dashboard-view-change`, but the Tipster overview shortcuts relied only on a Next.js hash navigation.
- The production bundle could update the URL without synchronizing the state-driven dashboard panel, most visibly on mobile.
- A shared navigation handler now updates browser history and dispatches the dashboard event for every same-page workspace link.
- Dashboard navigation also synchronizes on `hashchange`, `popstate`, and the shared dashboard event.
- Active meeting cards now show `Edit open tips (N)` using the actual selection cutoff, while locked cards continue to show `View results`.
- Published title, summary, and price remain immutable; only future race selections and meeting options remain editable until their cutoffs.

## Validation

- `npm ci`: passed with 454 packages and zero vulnerabilities.
- Production dependency audit: passed with zero vulnerabilities.
- ESLint: passed.
- TypeScript: passed.
- Frontend tests: 25 passed, including four dashboard-navigation regression tests.
- Edge Function tests: 61 passed.
- Production static build: passed with 89 pages.
- Static export verification: passed with 86 HTML files, 60 sitemap routes, 8 dynamic pages, and 83 payload aliases.
- Production-artifact environment isolation: passed with no development domain, Tailscale, test-account, self-hosted API, or MFA-bypass reference.

## Backup and deployment

- Pre-deployment backup: `Deployment/Xneelo Backups/public_html-before-20260929-061214.zip`.
- Immediate deployment backup: `Deployment/Xneelo Backups/public_html-before-20260929-061722.zip`.
- Both archives contain 1,142 entries, are 15,283,272 bytes, and have SHA-256 `46B8941E42362A0E154486D02ADCABAB1559AA756E61A1F287EFB301B984CFD2`.
- Xneelo deployment: 603 local files verified, 532 uploaded, 71 unchanged, 3 stale generated files removed, 562 legacy or system files preserved, and 1,165 remote files present after deployment.
- Every uploaded file passed remote SHA-256 verification.

## Live verification

- Homepage, login, Tipster dashboard, Tipster editor, and GJ public profile returned HTTP 200.
- No live route contained a development-environment reference.
- The live Tipster bundle contains the shared dashboard event handler, `Manage Meeting Cards`, and `Edit open tips (N)` action.
- GJ and MrC remain active, verified Tipsters.
- Both Fairview cards remain published with 9 open races and 6 open meeting options.
- No `tip_card_revision_failed` audit exists in the last 30 days.
- No production card, wallet, ledger, payout, race-feed, notification, or database row was mutated by this release.

## Rollback

- If a frontend regression is reported, restore either verified Xneelo backup and re-run the public-route smoke checks.
- No database rollback or financial correction is required for this frontend-only release.
