# Decision Log

## 2026-07-24 - Use Next.js, Supabase, and PostgreSQL

Decision: Build MRC Website with Next.js, React, TypeScript, TailwindCSS, shadcn/ui, Supabase Auth, Supabase Storage, and PostgreSQL.

Reasoning:

- Next.js supports public SEO pages and authenticated dashboards in one app.
- Supabase provides managed PostgreSQL, auth, storage, and RLS.
- PostgreSQL is a strong fit for financial-style credit ledgers, audit logs, and relational horse-racing data.
- shadcn/ui gives accessible, owned UI components without locking the project into a black-box component library.

## 2026-07-24 - Use Credits As Ledger Transactions

Decision: Credits must be represented by a wallet and immutable transaction ledger.

Reasoning:

- Users need trust that purchases, unlocks, refunds, and admin adjustments are traceable.
- Payment webhooks can be retried, so idempotency is required.
- A ledger makes admin review and dispute handling easier.

## 2026-07-24 - Use Provider Adapters

Decision: Payment gateways and horse-racing data APIs must use adapter interfaces.

Reasoning:

- South African payment providers differ in API quality, webhook signatures, and refund support.
- Sports data pricing and licensing can change.
- Adapters keep business logic independent from any one provider.
