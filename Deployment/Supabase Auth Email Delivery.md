# Supabase Auth Email Delivery Tracking

Date: 2026-09-07

## Current Rollout Status

- The delivery-tracking database schema is deployed to project `cjgfvqgiqrphmakruqnk`.
- Edge Functions `auth-send-email` and `auth-email-webhook` are deployed and responding.
- The Supabase Send Email Hook is intentionally not enabled yet because the Resend domain, API key, and both signing secrets still need to be configured.
- Existing Xneelo SMTP therefore remains the active production Auth sender until the controlled acceptance test passes.

## Architecture

The production Auth email path is:

1. Supabase Auth creates the confirmation, recovery, invitation, sign-in, email-change, or security-notification payload.
2. The Supabase Send Email Hook calls `auth-send-email` with a signed Standard Webhooks payload.
3. `auth-send-email` verifies the hook signature, records an internal message attempt, and sends through the Resend API with a deterministic idempotency key.
4. Resend calls `auth-email-webhook` for delivery, delay, bounce, complaint, suppression, and failure events.
5. `auth-email-webhook` verifies the Svix signature and records the event idempotently.
6. Administrators see the provider message ID, current status, timestamps, provider errors, and immutable event history in the registration diagnostics panels.

The provider `delivered` event confirms acceptance by the recipient mail server. No provider can guarantee that a message appears in the inbox instead of spam or another filtered folder.

## Required Resend Setup

1. Create or open the MRC Racing Tips Resend account.
2. Add and verify `mrcracing.co.za` under Resend Domains.
3. Add the DNS records supplied by Resend without removing the existing Xneelo website or mailbox records.
4. Add a DMARC TXT record for `_dmarc.mrcracing.co.za`. Start with the monitoring policy recommended by the domain administrator, review reports, and only then tighten enforcement.
5. Create a sending-only Resend API key.

## Supabase Function Secrets

Set these hosted Edge Function secrets without committing their values:

```text
RESEND_API_KEY=re_...
SEND_EMAIL_HOOK_SECRET=v1,whsec_...
RESEND_WEBHOOK_SECRET=whsec_...
AUTH_EMAIL_FROM=MRC Racing Tips <no-reply@mrcracing.co.za>
AUTH_EMAIL_REPLY_TO=support@mrcracing.co.za
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to hosted Supabase Edge Functions automatically.

## Deploy in Safe Order

1. Apply `supabase/migrations/20260907140000_auth_email_delivery_tracking.sql`.
2. Deploy `auth-send-email` with JWT verification disabled. The function verifies the Supabase Auth hook signature itself.
3. Deploy `auth-email-webhook` with JWT verification disabled. The function verifies the Resend/Svix signature itself.
4. In Resend, add this production webhook URL:

   `https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/auth-email-webhook`

5. Subscribe to at least:

   - `email.sent`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.bounced`
   - `email.complained`
   - `email.suppressed`
   - `email.failed`

6. Copy the webhook signing secret to `RESEND_WEBHOOK_SECRET`.
7. In Supabase Dashboard, open Authentication > Hooks and create a Send Email hook pointing to:

   `https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/auth-send-email`

8. Generate the Supabase hook secret and store the same value in `SEND_EMAIL_HOOK_SECRET`.
9. Test with a controlled address before enabling the hook for client registrations.

## Acceptance Test

For a new controlled registration, confirm all of the following:

1. Registration succeeds and `auth.users.confirmation_sent_at` is populated.
2. `auth_email_messages` contains one `signup` row with a Resend provider message ID.
3. The admin registration list first shows `Accepted` or `Sent` and later `Delivered`.
4. Clicking the confirmation link populates `auth.users.email_confirmed_at`.
5. A Resend test bounce address records `Bounced` and exposes the sanitized bounce reason in the admin user workspace.
6. Replaying the same webhook does not create another event because `provider_event_id` is the immutable primary key.

## Rollback

Disable the Send Email hook in Supabase Authentication. Supabase will immediately return to its configured SMTP provider while the tracking tables and historical events remain available for diagnostics.
