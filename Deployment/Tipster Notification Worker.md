# Tipster Notification Worker

The production `deliver-tip-notifications` Supabase Edge Function, maintained from
`supabase/functions/process-tip-notifications`, drains the `tip_notifications`
queue and delivers meeting publication, correction, refund, and dispute emails through
the dedicated MRC Xneelo mailbox over implicit TLS on SMTP port 465.

## Production Setup

1. Add `MRC_SMTP_HOST`, `MRC_SMTP_PORT`, `MRC_SMTP_USERNAME`,
   `MRC_SMTP_PASSWORD`, `MRC_SMTP_FROM_EMAIL`, and `MRC_SMTP_SENDER_NAME` to
   the Supabase project Edge Function secrets.
2. Deploy `supabase/functions/process-tip-notifications` as `deliver-tip-notifications`.
3. Publish or revise a test meeting card while signed in as a verified tipster.
4. Confirm the notification outbox records a deterministic RFC Message-ID and
   `delivered` status.

The static Xneelo frontend must never contain the SMTP password,
`SUPABASE_SERVICE_ROLE_KEY`, racing-provider keys, or worker credentials.

## Invocation

The database invokes the worker every two minutes with a dedicated rotating token.
Publishing and correction workflows still invoke the interactive worker after the
database transaction commits, and administrators can process queued work manually.
Failed jobs remain in Supabase Queues and use the existing exponential retry policy.
