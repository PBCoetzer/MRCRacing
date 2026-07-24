# Review Cycle 9 - Live Cleanup And Functional Tests

Date: 2026-07-24

## Scope

- Cleaned Xneelo `public_html` after manual uploads.
- Rebuilt and force-synced the static Next.js export.
- Tested live routing, static assets, auth forms, and protected workspaces.
- Verified Supabase auth/database state for the live project.

## Xneelo Cleanup

- Replaced `public_html` with the current `Frontend/out` export.
- Quarantined stray non-build files outside `public_html`.
- Final expected export count: `183` files.
- Final remote count: `191` files.
- Missing expected files: `0`.
- Non-chunk extras in `public_html`: `0`.
- Retained legacy files only under `_next/static/chunks/` so cached browsers do not fail during chunk loading.

Quarantine folders created during the cleanup cycle:

- `mrc_public_html_quarantine_20260724_072456`
- `mrc_public_html_quarantine_20260724_074020`
- `mrc_public_html_quarantine_20260724_074348`
- `mrc_public_html_quarantine_20260724_074648`
- `mrc_public_html_quarantine_20260724_075525`

## Code Fixes

- Added `RoleGate` for live Supabase session and role checks.
- Protected `/client/` for `client` and `administrator` roles.
- Protected `/tipster/` for `tipster` and `administrator` roles.
- Hid admin metrics, tabs, and sample ledger rows until the administrator role check passes.
- Normalized Supabase `Auth session missing!` responses into user-facing login-required messages.

## Local Validation

Commands passed:

```powershell
npm run lint
npm run build:static
```

Static export checks:

- `/client/index.html` does not expose `Bright Comet each-way`.
- `/tipster/index.html` does not expose `Bright Comet each-way`.
- `/admin/index.html` does not expose `Credit ledger activity`.

## Live Route Checks

The following live routes returned HTTP `200`:

- `https://www.mrcracing.co.za/`
- `https://www.mrcracing.co.za/login/`
- `https://www.mrcracing.co.za/register/`
- `https://www.mrcracing.co.za/forgot-password/`
- `https://www.mrcracing.co.za/reset-password/`
- `https://www.mrcracing.co.za/client/`
- `https://www.mrcracing.co.za/tipster/`
- `https://www.mrcracing.co.za/admin/`

## Browser Functional Checks

Passing browser checks:

- Home page loads with title `MRC Racing Tips | Premium Sports Tips`.
- Client dashboard shows `Login required` when signed out.
- Tipster dashboard shows `Login required` when signed out.
- Admin dashboard asks for an administrator login when signed out.
- Signed-out client, tipster, and admin pages do not show private mock tip/admin content.
- No browser console errors appeared after restoring legacy chunks.
- Login form returns `Login issueInvalid login credentials` for invalid credentials.
- Forgot password form returns `Email sentReset link sent. Check your inbox and follow the secure link.`

## Supabase Auth Findings

Create-account testing reached Supabase, but positive signup is currently blocked by Supabase auth email limits:

- `example.com` test addresses are rejected as invalid by Supabase.
- `@mrcracing.co.za` test signup reached `/signup` but returned `email rate limit exceeded`.
- Supabase auth logs confirmed a `429` `over_email_send_rate_limit` result.
- No `mrc.codex.test.%` users were created in `auth.users`.

## Remaining Blockers

- Configure Supabase custom SMTP, or wait for the hosted email rate limit to reset, before a full positive create-account and email-confirmation login test can pass.
- Payment gateway buttons are still static package buttons; PayFast, Ozow, PayGate, and Instant EFT adapters remain planned work.
- Production sports/racing data feeds remain planned work.
