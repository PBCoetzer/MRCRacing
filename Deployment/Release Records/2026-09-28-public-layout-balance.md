# Public desktop layout balance

Status: completed and verified on 28 September 2026.

Approval reference: `owner-approved-desktop-layout-20260928`

Release branch: `codex/production-promotion-20260928`

Base commit: `7e63800870f1d7b05fb9695ef089e0f3f52b778e`

The frontend-only layout patch was deployed from the reviewed working tree without a database migration or Edge Function deployment. Its SHA-256 is `61A3A0625A9051DE58AEAFFF923A92A8EF551A16A92178A40440DD61E5D71C70`.

## Scope

- Added a public marketing container that keeps the existing mobile and tablet widths, uses the existing 10% desktop margins, and caps very wide desktop content at 1,280 pixels.
- Applied the public container to Home, Blog, Horse Care, Pricing, and public Tipster pages.
- Left Client, Tipster, and Admin workspaces and race-data tables on the wider data layout.
- Limited the desktop pinned-blog media column to 320 by 480 pixels.
- Limited the featured Betfred banner to 224 pixels high on wide desktop while keeping it aligned with the affiliate and Credit grids.

## Verification

- Production dependency audit: 0 vulnerabilities.
- ESLint: passed.
- TypeScript and production build: passed.
- Frontend tests: 21 passed.
- Edge Function regression tests: 61 passed.
- Static export verification: 85 HTML files, 59 sitemap routes, 7 dynamic pages, and 82 payload aliases.
- Production artifact isolation scan: passed with the production Supabase host and no development-only references.

## Xneelo deployment

- Static files verified: 596.
- Files uploaded: 508.
- Files already current: 88.
- Stale generated files removed: 3.
- Legacy or system files preserved: 529.
- Final remote file count: 1,125.

The pre-release backup is stored at `C:\Users\coetz\OneDrive\Documents\MRC Production Backups\20260928-044054-layout\public_html-before-20260928-044054.zip` with SHA-256 `76FA698726660057B3331FD648F2601F739C726CF87030FE0E465CF5C51BE6DE`.

The 596-file static artifact manifest is stored beside the backup. Its SHA-256 is `9EFD1A805EF0CB7A0DCE9DE5906176324C772A80AF773F202F7FBA01416B47C2`.

## Live smoke tests

- Home, Pricing, Tipsters, Blog, Horse Racing, Horse Care, Login, and Register returned HTTP 200.
- At 2,048 pixels, public marketing content is 1,280 pixels wide with 384-pixel left and right margins.
- The live pinned article is 482 pixels high and the featured Betfred block is 271 pixels high, including its header.
- Pricing and Blog use the same 1,280-pixel desktop content width.
- At 390 pixels, the homepage content is 358 pixels wide with 16-pixel margins and no horizontal overflow.
- Browser smoke tests reported no page errors.

No production database records, Credits, payments, entitlements, subscriptions, revenue allocations, or Edge Functions were changed by this release.

## Homepage alignment follow-up

Approval reference: `owner-approved-home-inline-followup-20260928`

The homepage hero and upcoming-race block were moved from the wider data shell to the same public marketing container as the remaining homepage sections.

- All seven homepage marketing containers now measure 1,280 pixels wide with a 384-pixel left edge at a 2,048-pixel viewport.
- The 390-pixel mobile viewport remains 358 pixels wide with 16-pixel margins and no horizontal overflow.
- Static verification and the production artifact isolation scan passed before deployment.
- Xneelo verified 596 local files, uploaded 503 changed files, retained 93 identical files, removed 3 stale generated files, and preserved 529 legacy or system files.
- The follow-up rollback backup is `C:\Users\coetz\OneDrive\Documents\MRC Production Backups\20260928-045658-home-inline\public_html-before-20260928-045658.zip`, SHA-256 `FE2DEAD2BE9CC71F66D4BA7E05AEB43EA00D2277BC7323E6146E78B1AB70FC2E`.
- The follow-up 596-file artifact manifest has SHA-256 `CBA0FEC08D5A33CF241CA2A2CBAC07EF012C082883035053D529CCC7CE5FD6C0`.
- Live desktop and mobile browser checks completed without page errors.
