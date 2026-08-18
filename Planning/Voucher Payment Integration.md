# Voucher Payment Integration

## Current decision

Voucher information may be shown publicly, but voucher redemption remains disabled until MRC has an approved merchant agreement, production API documentation, credentials, settlement terms, and refund rules from the provider.

The website must never accept a voucher PIN through email, Telegram, comments, a generic contact form, or a browser-only integration.

## Provider readiness

| Provider | Customer reach | MRC status | Required before activation |
| --- | --- | --- | --- |
| PayFast | Cards, Instant EFT, bank-app payments, wallets, QR, and eligible cash-assisted methods | Checkout implemented; merchant methods controlled in PayFast | Approved merchant account and production signing credentials |
| Ozow | Pay-by-bank | Checkout implemented | Approved merchant account and production credentials |
| 1Voucher | Banking apps and participating retailers, including major retail groups | Discovery/onboarding | Flash API merchant approval, server credentials, fees, settlement, reversals, and test environment |
| OTT Voucher | Banking apps and broad South African retail/airtime network | Discovery/onboarding | Approved OTT merchant integration, API documentation, server credentials, settlement, and refund rules |
| Blu Voucher | Approved third-party online partners and retail distribution | Discovery/onboarding | Blue Label commercial agreement, API documentation, credentials, settlement, and test environment |

## Required server boundary

1. An authenticated client starts a purchase for a server-selected Credit package.
2. The Edge Function creates a pending payment with an idempotency key and server-known amount.
3. The voucher PIN is sent over TLS to the Edge Function and is never written to browser storage, logs, analytics, Supabase tables, Telegram, or email.
4. The Edge Function submits the PIN directly to the approved provider API.
5. Credits are issued exactly once only after a signed or server-verified provider success.
6. Only a provider reference, amount, status, timestamps, and a one-way audit fingerprint are retained.
7. Replays, duplicate provider references, amount mismatches, partial redemption, and provider timeouts fail closed.
8. Refunds and residual balances follow the provider contract and the published MRC policies.

## Activation gate

No provider can be marked live until sandbox redemption, invalid PIN handling, duplicate submission, timeout recovery, reconciliation, refund handling, rate limiting, log redaction, and production monitoring all pass.
