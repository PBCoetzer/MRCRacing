# Blog Post Email Announcements

- Deployment approval: `user-approved-blog-email-deployment-20260915-084745`
- Deployment date: 15 September 2026
- Supabase project: `MRCRacing` (`cjgfvqgiqrphmakruqnk`)
- Database migration: `20260915064707_blog_post_registered_user_email_notifications.sql`
- Edge Function: `process-tip-notifications` version 37
- Edge Function SHA-256: `756166120fae6fe2f40e71c73c0cbc3059b26a1f389b8aec0162ffbe78d002f7`

## Scope

- Queue one deduplicated email announcement for each eligible registered account when a blog post is published for the first time.
- Preserve explicit email-announcement consent, account status, confirmed-email, and email-notification preference checks.
- Add a direct article link, escaped author content, and an email-preference link to the notification template.
- Show the author how many eligible accounts and newly queued messages were included.
- Expand the client email-announcement preference wording to include blog posts and meeting cards.

## Verification

- Full local verification passed: ESLint, TypeScript, 13 frontend tests, 46 Edge Function tests, terminology validation, 71-route static build, and static-export verification.
- Database function permissions, consent guard, and first-publication guard verified after migration.
- A transaction-rollback queue test returned one eligible recipient and created no durable notification rows.
- Live `process-tip-notifications` version 37 is active.
- Live frontend chunk returned HTTP 200 and contains the new preference and publication-feedback text.
- No existing blog post was broadcast during deployment.

## Xneelo Backup

- Backup: `Deployment/Xneelo Backups/public_html-before-20260915-084747.zip`
- Size: 13,409,848 bytes
- Entries backed up: 923
- SHA-256: `25057CF2DCEB5A7DAA2026D48B7292FDADDB5871C384667FE38F8E0C0C13F2BD`

## Rollback

- Frontend: restore the recorded Xneelo backup.
- Edge Function: redeploy the previous `process-tip-notifications` source/version 36.
- Database: use a forward-only compensating migration to restore the previous `publish_blog_post` function and remove the private blog-email queue helper.
