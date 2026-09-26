# Telegram change-only race feedback

Status: deployed to production on 26 September 2026.

Production completion: the server-only webhook secret was generated and stored in Supabase, and Telegram accepted the webhook registration for `telegram-race-feedback`.

## Changes

- Race-feed proposal alerts are compared with the current production race meeting before Telegram delivery.
- Unchanged proposals are completed without sending a Telegram message.
- Telegram receives one concise list of factual changes instead of a full meeting-card PDF.
- Critical source conflicts still alert even when no direct database difference is found.
- Telegram replies are authenticated with the Bot API webhook secret and restricted to the configured administrator chat.
- Replies are stored as audited review feedback and never update race data automatically.
- New feedback appears in the administrator race-feed workspace for review or dismissal.
- Existing secondary-source consensus alerts use the same reply workflow.

## Required secret

Create a strong random value and store it as the Supabase Edge Function secret:

`MRC_TELEGRAM_WEBHOOK_SECRET`

Use only letters, numbers, underscores, and hyphens so Telegram accepts the value as a webhook secret token.

Do not place its value in Git or this release record.

## Deployment order

1. Apply `20260921080521_formgrids_primary_secondary_consensus.sql` if it is not already in production.
2. Apply `20260921093726_telegram_change_only_feedback.sql`.
3. Deploy `process-tip-notifications`.
4. Deploy `telegram-race-feedback` with JWT verification disabled because Telegram authenticates through the webhook secret header.
5. Deploy the static frontend.
6. Register the Telegram webhook:

   - URL: `https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/telegram-race-feedback`
   - Allowed updates: `message`
   - Secret token: the same value stored in `MRC_TELEGRAM_WEBHOOK_SECRET`

7. Reply to a test race-change alert and confirm:

   - Telegram acknowledges the feedback.
   - The admin race-feed page shows the feedback.
   - No race meeting, fixture, or entry changes automatically.

## Rollback

- Remove the Telegram webhook before rolling back the Edge Function.
- Restore the previous `process-tip-notifications` function if required.
- Keep the feedback table for audit history; do not delete captured replies during an application rollback.
