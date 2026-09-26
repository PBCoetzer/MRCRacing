# Frontend Rollback Restoration

## Status

- Production restoration completed on 20 September 2026.
- Release decision: **GO** for the corrective frontend restoration.
- The current audited frontend is live and connected to the existing production database.
- No database records, tipster profiles, meeting cards, purchases, entitlements, or theme settings were lost.

## Incident

- The Greyville release rebuilt and deployed static files from clean `origin/main` commit `57a0a393fb76e7e41c04467c1d6aa857e6ff40f5`.
- That commit was older than the reviewed application state in `codex/production-readiness-audit`.
- The upload replaced the current frontend with an older export while leaving the newer Supabase schema and data in place.
- The mismatch made the site appear rolled back and caused the old tipster dashboard to report missing profile data, zero cards, zero earnings, missing strike-rate behavior, and missing custom colours.

## Corrective Action

- Rebuilt the complete current frontend from the active audited worktree.
- Re-ran the full local verification suite before deployment.
- Backed up the live Xneelo site before replacing any files.
- Deployed and hash-verified the current static export.
- Removed stale generated files left by the older export while preserving legacy and system files.

## Verification

- ESLint passed.
- TypeScript passed.
- Authentication, blog, and consent tests passed: 16/16.
- Supabase Edge Function tests passed: 48/48.
- Terminology validation passed across 42 files.
- Next.js static export passed with 79 generated routes, 76 HTML files, 52 sitemap routes, 6 dynamic pages, and 73 payload aliases.
- Xneelo deployment verified 538 local release files: 496 uploaded and 42 already current.
- Xneelo deployment removed 388 stale generated files and preserved 480 legacy or system files.
- Critical production routes return HTTP 200, including the home page, tipster workspace, tip management, account security, tipster application, blog, pricing, racing, corrected Greyville page, sitemap, robots, and login.
- The live home page loads current production meetings, the pinned journal post, and current Credit packages.
- The live tipster directory reports current settled statistics: MrC winner 53.9% and place 68.6%; GJ winner 33.3% and place 46.7%.
- GJ's public profile applies the stored blue theme values: primary `#41B8F4`, secondary `#B9ECFF`, and surface `#08263F`.
- The restored frontend includes the secured earnings RPC, tipster theme editor, Place Selection result handling, profile security, and 2FA routes.

## Deployment Evidence

- Approval reference: `user-reported-production-rollback-20260920`.
- Deployment result: `succeeded`.
- Xneelo backup: `C:\Users\coetz\OneDrive\Documents\MRC Website Hermes Bridge\Deployment\Xneelo Backups\public_html-before-20260920-173237.zip`
- Xneelo backup SHA-256: `47DBE0F81948C39C74402DC2359591CA1B3BA903D9AF9BDDCADEA20E5F6F60DE`

## Prevention

- Never rebuild a production release from `origin/main` merely because it is clean when the deployed application includes reviewed work not yet present on that branch.
- Use the reviewed release worktree or an immutable approved build artifact as the frontend source of truth.
- Record the exact source commit and working-tree status before every deployment.
- Compare the generated route inventory and critical feature markers against the current production-readiness baseline before upload.
- Keep the automatic pre-deployment Xneelo backup and post-upload file-hash verification mandatory.
- Run authenticated role smoke tests for client, tipster, and administrator flows before closing any broad frontend release.

## Rollback

- If this restoration introduces a regression, restore the Xneelo backup above with the deployment restore procedure.
- Database rollback is not required because this corrective release changed frontend files only.
