# Tipster Card Publishing Workflow

## Status

- Production frontend deployment completed on 16 September 2026 after owner approval.
- No database migration or Edge Function deployment was required for this release.
- Live static assets expose only `Private Draft` and `Publish Card` in the meeting-card action dropdown.

## Changes

- Replaced the legacy `Coming Soon / preview only` action with `Publish Card`.
- Kept private drafts editable and visible from the tipster dashboard without notifying clients.
- Publishing remains a separate explicit action after the private draft is saved.
- Showed `Notify all clients` only for a public card publication.
- Added a dashboard section for continuing existing private or legacy pre-publication cards.

## Verification

- ESLint passed.
- TypeScript passed.
- Authentication and blog tests passed: 13/13.
- Edge Function tests passed: 48/48.
- Public terminology validation passed across 42 files.
- Static build passed for 76 generated pages.
- Static export verification passed for 73 HTML files, 49 sitemap routes, 6 dynamic pages, and 70 payload aliases.
- Live `/`, `/tipster/`, `/tipster/manage-tips/`, `/login/`, and `/pricing/` returned HTTP 200.
- The live tipster bundle contains `Private Draft`, `Publish Card`, and `Save private draft`; it does not contain `Coming Soon / preview only`.

## Deployment

- Approval reference: `approved-by-owner-20260916-tipster-card-publishing-flow`
- Source commit: `5a0afbcbfce300ffaf770130542733e0402918f8`
- Static artifact manifest SHA-256: `1C40B760CE9AC3943D17A47BA2166CCB90CA2F52EB9C3C926921C84A47D2ACD9`
- Files verified: 516
- Files uploaded: 433
- Files already current: 83
- Stale managed files removed: 3
- Legacy or system files preserved: 442

## Rollback

- Backup: `Deployment/Xneelo Backups/public_html-before-20260916-121208.zip`
- Backup size: 13,467,829 bytes
- Backup SHA-256: `AFBBCF642F43C376BA78732DDA9F881DB7BE9C13EC2749119745BCFD16F6D183`
- Restore this archive over Xneelo `public_html`, verify hashes, and repeat the public smoke tests.
