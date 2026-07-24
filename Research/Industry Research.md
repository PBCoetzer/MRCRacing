# Industry Research

Research status: initial planning baseline

## Sports Tipping Platform Standards

- Separate informational content from gambling operations. The platform should not accept bets, hold betting deposits, place bets for users, or pay winnings.
- Show clear risk language on public pages, checkout, tip unlock screens, and footer.
- Display 18+ messaging and responsible gambling links consistently.
- Use transparent historical performance metrics. Every statistic should be traceable to results data.
- Show tipster performance with enough context to avoid misleading users: sample size, time period, ROI formula, strike rate, average odds, and recent form.
- Keep premium tips locked until payment or credit entitlement is confirmed server-side.

## Credit System Standards

- Treat credits as an internal access entitlement, not cash.
- Store wallet balance as a derived or carefully controlled value backed by an immutable transaction ledger.
- Log every purchase, unlock, refund, admin adjustment, and reversal.
- Use idempotency keys for payment webhooks and unlock actions.
- Prevent negative balances with database constraints and server-side checks.

## Payments

- Use a provider adapter layer so PayFast, Ozow, PayGate, Peach Payments, Yoco, and other gateways can be added without changing core wallet logic.
- Never credit a wallet from a browser redirect alone.
- Credit the wallet only after a verified server-side webhook or manually verified admin action.
- Store payment provider references, raw webhook event IDs, verification status, and reconciliation status.

## Responsible Gambling And POPIA

- State that the service provides information and analysis only.
- Add 18+ age gate language during registration.
- Provide responsible gambling guidance and support resources.
- Collect only necessary personal information.
- Document why each personal data field is collected.
- Allow users to request correction or deletion where legally appropriate.
- Protect payment, identity, and account activity data with strict permissions.

## Dashboard UX

- Prioritize fast scanning: balances, unlocked tips, upcoming fixtures, recent results, and alerts.
- Give clients a simple path from credits to unlock to tip view.
- Give tipsters a focused workflow for publishing tips, recording outcomes, and understanding earnings.
- Give admins dense operational tables with filters, status badges, and audit history.
