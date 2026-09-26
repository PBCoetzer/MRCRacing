# Payment Checkout CSP And MFA Fix

## Status

- Production deployment completed on 15 September 2026 after owner approval.
- Supabase `create-credit-checkout` version 33 is active.
- The verified static frontend is live on Xneelo.
- No test payment, Credit balance change, or wallet mutation was performed.

## Root Cause

The production Content Security Policy introduced on 13 September 2026 restricted
`form-action` to the MRC site and Supabase. The checkout page created a pending payment
record and then submitted an HTML form to `https://pay.ozow.com`. The browser blocked
that cross-origin form submission before Ozow received it.

Production evidence supports the timing: paid Ozow transactions exist through
12 September, while all 18 Ozow checkouts created from 13 September onward remain
pending without a provider callback.

The 2FA release also added an unnecessary privileged MFA-factor lookup to ordinary
client checkout. That lookup was not the cause of the 18 pending records, but it could
deny checkout to a valid client whose current session had not yet reached AAL2.

## Changes

- Generate an Ozow payment URL server-to-server through the Ozow payment-request API.
- Return only a validated `https://pay.ozow.com` redirect URL to the browser.
- Record the Ozow payment-request ID or a sanitized provider failure on the payment.
- Mark provider-request failures as failed instead of leaving them pending.
- Return actionable, sanitized Ozow errors with an HTTP 502 response.
- Allow `https://pay.ozow.com` in `form-action` as rollback/fallback compatibility.
- Keep client checkout authenticated, but remove administrator-level MFA inspection.
- Preserve AAL2 enforcement on administrator pages, administrative Edge Functions,
  database owner checks, and administrator role checks.

## Verification

- Frontend TypeScript passed.
- Frontend ESLint passed.
- Authentication and MFA routing tests passed: 13/13.
- Edge Function tests passed: 48/48.
- `create-credit-checkout` passed Deno type checking.
- Static production build passed for 72 generated pages.
- Static export verification passed for 69 HTML files, 45 sitemap routes,
  6 dynamic pages, and 66 payload aliases.
- Generated `.htaccess` contains the Ozow CSP fallback.
- Deployed Edge Function version 33 is active with bundle SHA-256
  `7bdc68509fb9bf9656d1de37cb607dd5f42d2fe52c6e5707e230fe432d7c2a03`.
- Deployed function inspection confirms server-side Ozow URL generation, validated
  redirect responses, and removal of privileged MFA-factor lookup from checkout.
- Live CORS preflight returns HTTP 200 for `https://www.mrcracing.co.za`.
- Live unauthenticated checkout returns HTTP 401 without creating a payment record.
- Live `/pricing/` and `/account/security/` routes return HTTP 200.
- Live CSP permits `https://pay.ozow.com` in `form-action`.
- The apex pricing route redirects to the canonical `www` route.

## Deployment

1. Deployed `create-credit-checkout` version 33 with `verify_jwt = false`; the
   function continues to validate the authenticated user inside its handler.
2. Backed up 932 live Xneelo files before upload.
3. Uploaded 408 changed files, retained 84 current files, and removed 3 stale files.
4. Verified the live routes, redirect, CSP, CORS, and authentication boundary.

Approval reference:
`approved-by-owner-20260915-payment-checkout-2fa-fix`

Rollback archive:
`Deployment/Xneelo Backups/public_html-before-20260915-102334.zip`

- Size: 13,468,015 bytes
- Entries: 932
- SHA-256: `6A7C8DAF241B22E677BB6E7502DAD52C5915202C8A71E23B72E8F34964C6C11C`

## Remaining Live Confirmation

The next genuine client checkout will provide the final provider-side confirmation.
It should redirect to Ozow and record the Ozow payment-request ID. This confirmation
was not simulated because doing so would create a production payment record.

## Rollback

- Restore the prior Xneelo archive for the frontend.
- Redeploy the previous `create-credit-checkout` Edge Function version.
- Do not modify or delete historical pending payment records during rollback.
