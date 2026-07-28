# Tipster Meeting Cards Test Report

Date: 2026-07-28
Supabase project: MRCRacing

## Completed Checks

- Frontend lint passed.
- Next.js 16 production static export passed for 20 routes, including
  `/tipster/manage-tips/`.
- Anonymous, client, tipster, and administrator role gates were checked.
- Private test meetings are hidden from anonymous and unrelated clients.
- Explicitly enabled test clients, verified tipsters, and administrators can view
  private test meetings.
- Draft save, mandatory complete meeting bet, first-publication cutoff, and
  optimistic revision guards passed.
- Meeting publication and audited correction revision passed.
- Premium race selections returned zero rows before purchase and became visible
  after entitlement creation.
- Duplicate meeting-purchase idempotency retained the same wallet balance.
- Three-month subscription creation and immediate access passed.
- Full dispute refund restored the meeting purchase, reversed commission and
  tipster earnings exactly, and retained the non-refundable subscription charge.
- Notification outbox, in-app notification, and PgMQ queue insertion passed for
  an entitled client.
- Administrator user listing, role enforcement, test access, and immutable wallet
  adjustment passed.
- Anonymous execution was removed from all new public `SECURITY DEFINER` RPCs.
- The deployed notification Edge Function is active at version 2 with JWT
  verification enabled.

## Live Private Test Data

- One Greyville private test meeting.
- Ten races and 104 runners.
- Six structured meeting-bet options.
- One clearly marked published synthetic meeting card.
- Four clearly marked test subscription packages.
- Two test-enabled users with test wallets.

## Remaining Production Dependency

Real Resend delivery cannot be completed until `RESEND_API_KEY` is added to the
Supabase Edge Function secrets and the `mrcracing.co.za` sending domain is verified.
Queued delivery remains retryable and no secret is exposed to the Xneelo frontend.

Supabase also reports leaked-password protection as disabled. Enable it in the Auth
security settings before general public launch.
