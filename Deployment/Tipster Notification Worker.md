# Tipster Notification Worker

The production `process-tip-notifications` Supabase Edge Function drains the `tip_notifications`
queue and delivers meeting publication, correction, refund, and dispute emails through
the dedicated MRC Xneelo mailbox over implicit TLS on SMTP port 465.

The worker also sends administrator race-feed approval requests to Telegram only for
proposals below 90% confidence, plus quarantined or critical proposals that represent
serious issues. Add
`MRC_TELEGRAM_BOT_TOKEN` and `MRC_TELEGRAM_ADMIN_CHAT_ID` as server-only Edge
Function secrets. The bot must be a member of the target group or an administrator
of the target channel. Approval requests are deduplicated by immutable proposal
snapshot, contain no website preview, and provide approve/reject review shortcuts
to `/admin/racing/`. A shortcut records intent only: the administrator must still
review evidence, enter the required audit note, and confirm the authenticated action.

## Production Setup

1. Add `MRC_SMTP_HOST`, `MRC_SMTP_PORT`, `MRC_SMTP_USERNAME`,
   `MRC_SMTP_PASSWORD`, `MRC_SMTP_FROM_EMAIL`, and `MRC_SMTP_SENDER_NAME` to
   the Supabase project Edge Function secrets.
2. Deploy `supabase/functions/process-tip-notifications`.
3. Publish or revise a test meeting card while signed in as a verified tipster.
4. Confirm the notification outbox records a deterministic RFC Message-ID and
   `delivered` status.
5. Submit a sub-90% race proposal and confirm that one compact Telegram approval
   message is delivered, both review buttons open the intended proposal, and repeated
   worker executions do not create duplicates.

The static Xneelo frontend must never contain the SMTP password,
`SUPABASE_SERVICE_ROLE_KEY`, racing-provider keys, or worker credentials.

## Invocation

The database invokes the worker every two minutes with a dedicated rotating token.
Publishing and correction workflows still invoke the interactive worker after the
database transaction commits, and administrators can process queued work manually.
Failed jobs remain in Supabase Queues and use the existing exponential retry policy.
