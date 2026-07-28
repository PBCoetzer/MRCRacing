# Tipster Notification Worker

The `process-tip-notifications` Supabase Edge Function drains the `tip_notifications`
queue and delivers meeting publication, correction, refund, and dispute emails through
Resend.

## Production Setup

1. Verify `mrcracing.co.za` in Resend.
2. Add `RESEND_API_KEY` to the Supabase project Edge Function secrets.
3. Deploy `supabase/functions/process-tip-notifications`.
4. Publish or revise a test meeting card while signed in as a verified tipster.
5. Confirm the notification outbox records a provider message ID and `delivered` status.

The static Xneelo frontend must never contain `RESEND_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, racing-provider keys, or worker credentials.

## Invocation

Publishing and correction workflows invoke the worker after the database transaction
commits. Administrators can also process queued work from the admin dashboard.

Until an authenticated scheduled invocation is configured, failed jobs remain in
Supabase Queues and are retried on the next tipster or administrator invocation.
