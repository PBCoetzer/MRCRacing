# Tipster Notification Worker

The production `deliver-tip-notifications` Supabase Edge Function, maintained from
`supabase/functions/process-tip-notifications`, drains the `tip_notifications`
queue and delivers meeting publication, correction, refund, and dispute emails through
Resend.

## Production Setup

1. Verify `mrcracing.co.za` in Resend.
2. Add `RESEND_API_KEY` to the Supabase project Edge Function secrets.
3. Deploy `supabase/functions/process-tip-notifications` as `deliver-tip-notifications`.
4. Publish or revise a test meeting card while signed in as a verified tipster.
5. Confirm the notification outbox records a provider message ID and `delivered` status.

The static Xneelo frontend must never contain `RESEND_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, racing-provider keys, or worker credentials.

## Invocation

The database invokes the worker every two minutes with a dedicated rotating token.
Publishing and correction workflows still invoke the interactive worker after the
database transaction commits, and administrators can process queued work manually.
Failed jobs remain in Supabase Queues and use the existing exponential retry policy.
