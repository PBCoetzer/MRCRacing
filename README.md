# MRC Website

MRC Website is a South African horse-racing tipping platform. The static frontend is hosted on Xneelo and uses Supabase for PostgreSQL, Auth, row-level security, queues, cron, and Edge Functions.

## Current Status

- Workspace folders are created.
- A living project TODO exists in `TODO.md`.
- Initial competitor research and architecture documents are underway.
- The frontend app will live in `Frontend`.
- Supabase planning and schema files will live in `Database`.
- GitHub repository confirmed as `PBCoetzer/MRCRacing`.
- Supabase project confirmed as `MRCRacing`.
- Xneelo Volume Plan live-testing deployment is documented in `Deployment/GitHub Supabase Xneelo Plan.md`.
- Production meeting-card tables, commerce RPCs, private test data, and the notification outbox are live.
- Verified tipsters can publish race selections and free-text Exotic's and Multiples with audited revisions and verified result displays.
- Clients can favourite tipsters, compare settled winner strike rates, open tipster-specific profiles, and buy whole meeting cards or non-renewing subscriptions.
- Credit packages are database-backed at the fixed public rate of R1 = 1 Credit.
- PayFast and Ozow checkout, webhook verification, and atomic Credit issuance are deployed but remain disabled until merchant credentials are configured.

## Project Principles

- Document decisions before implementation.
- Keep local development safe, reproducible, and free from hard-coded secrets.
- Use a provider-neutral architecture for horse-racing feeds, tipsters, payment gateways, and future delivery channels.
- Treat credits as a wallet ledger, not as editable numbers without history.
- Keep premium betting tips behind role, credit, and audit controls.

## Main Stack

- Next.js
- React
- TypeScript
- TailwindCSS
- shadcn/ui
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage

## Source Of Truth

All project files, reports, decisions, schemas, screenshots, and guides must stay inside this root workspace:

`C:\Users\coetz\OneDrive\MRC Website`
