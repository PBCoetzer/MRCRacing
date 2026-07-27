# Review Cycle 13 - Production Redirects And Role Guards

Date: 2026-07-27

## Scope

- Corrected production email-confirmation redirects.
- Added a dedicated Supabase authentication callback page.
- Hid privileged navigation unless the signed-in user has the required role.
- Protected the full client, tipster, and administrator dashboard shells.
- Verified the static production build and signed-out authorization behavior.

## Supabase URL Configuration

- Site URL: `https://www.mrcracing.co.za`
- Production confirmation callback: `https://www.mrcracing.co.za/auth/callback/`
- Production password reset callback: `https://www.mrcracing.co.za/reset-password/`
- Local development redirects remain permitted under `http://localhost:3000/**`.

The confirmation email template continues to use Supabase's `{{ .ConfirmationURL }}` value. Supabase verifies the email first and then redirects to the registered production callback.

## Application Changes

- Registration requests now use `/auth/callback/` as `emailRedirectTo`.
- The callback completes the Supabase PKCE flow, reads the user's roles, and routes to the correct dashboard.
- The site header initially exposes only Home and Pricing.
- Client, Tipster, and Admin links are added only after a valid session and matching database role are confirmed.
- The complete dashboard shell stays hidden until its role check succeeds.
- Password reset pages verify the recovery session before enabling a password update.

## Role Rules

- Client dashboard: `client` or `administrator`
- Tipster dashboard: `tipster` or `administrator`
- Admin dashboard: `administrator`

Supabase row-level security remains the server-side source of truth. The navigation and page guards are an additional user-interface protection layer.

## Validation

Commands passed:

```powershell
npm run lint
npm run build
```

Browser checks passed:

- Signed-out home navigation does not show Client, Tipster, or Admin.
- Signed-out Admin and Tipster routes show only the generic login-required page.
- Protected workspace names, sidebars, and dashboard content are not rendered while signed out.
- `/auth/callback/` renders successfully.
- No Next.js error overlay appeared during the checks.

## Retest Note

Previously issued email links retain their original destination. A fresh registration or a newly issued confirmation email is required to test the corrected production URL.

## Production Deployment

- GitHub commit: `0218d37`
- Xneelo backup: `mrc_public_html_backup_20260727_084202`
- Local static export files: `196`
- Uploaded files: `196`
- Missing or size-mismatched files: `0`
- Unexpected non-build files after sync: `0`

Live HTTP checks returned `200` for:

- `/`
- `/auth/callback/`
- `/client/`
- `/tipster/`
- `/admin/`

Live headless-browser checks confirmed:

- Signed-out navigation contains no Client, Tipster, or Admin links.
- Admin and Tipster routes show `Login required`.
- Protected workspace labels and dashboard headings are not rendered while signed out.
- The authentication callback page renders without a framework error overlay.
