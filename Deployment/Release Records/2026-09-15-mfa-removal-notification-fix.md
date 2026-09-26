# MFA Removal Notification Fix

- Deployment approval: `user-approved-mfa-removal-notice-fix-20260915-091058`
- Deployment date: 15 September 2026
- Scope: static Xneelo frontend only

## Root Cause

The account-security screen automatically called Supabase Auth `mfa.unenroll()` for every unfinished TOTP factor before generating a replacement QR code. Supabase sends its `mfa_factor_unenrolled_notification` security email whenever an unfinished or verified factor is removed, so clients could receive “A verification method was removed from your account” without first seeing an explicit removal confirmation.

## Fix

- Removed automatic deletion of unfinished TOTP factors from normal enrollment startup.
- Added an unfinished-setup state that explains why a new QR code cannot yet be created.
- Required explicit confirmation before clearing an unfinished setup, regenerating a QR code, cancelling enrollment, or removing a verified authenticator.
- Explained that Supabase will send a genuine security notification after the confirmed removal.
- Kept Supabase MFA removal notifications enabled.

## Verification

- Focused ESLint and TypeScript checks passed.
- All 13 frontend authentication and blog-format tests passed.
- Production static build passed for 72 generated routes.
- Static-export verification passed for 69 HTML files, 45 sitemap routes, 6 dynamic pages, and 66 payload aliases.
- Xneelo deployment verified 492 local files: 408 uploaded and 84 already current.
- Live `/account/security/` returned HTTP 200.
- Live account-security payload returned `Cache-Control: no-store, max-age=0, must-revalidate`.
- Live MFA JavaScript chunk contains the unfinished-setup explanation and matches the local SHA-256 `9CBC4EA4732301B29783848D94F947F43D7EAFE72B463E58BFEC3D60B76C2ED5`.

## Xneelo Backup

- Backup: `Deployment/Xneelo Backups/public_html-before-20260915-091059.zip`
- Size: 13,429,684 bytes
- Entries: 925
- SHA-256: `640B729A9516142C68314FE9610EEEF35062906B75D5AEAF752F878849921100`

## Rollback

Restore the recorded Xneelo backup. No database migration or Supabase Edge Function change was required for this release.
