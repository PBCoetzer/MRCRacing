# Security Assessment

Status: first review cycle

## Implemented Security Foundations

- Supabase client utilities use publishable environment variables only.
- Service role key is kept as a server-only placeholder in `.env.example`.
- Database baseline enables RLS on exposed tables.
- Role checks are designed around client, tipster, and administrator roles.
- Credit movements are modeled as immutable ledger transactions.
- Payment crediting is planned to happen through verified server-side webhooks, not browser redirects.

## Known Open Items

- Supabase project credentials are not configured yet.
- RLS policies have not been applied to a live Supabase database.
- Payment webhook signature verification is not implemented yet.
- Auth forms are UI-ready but not connected to Supabase actions yet.
- Rate limiting and CSRF strategy still need implementation.
- POPIA and legal copy require legal review before production.

## npm Audit Notes

`npm audit` currently reports three high-severity findings through the generated `next@16.2.11` dependency tree:

- `next` via bundled `postcss`
- `postcss` advisories in Next's nested dependency
- `sharp` inherited libvips advisories

npm suggests a major downgrade to `next@9.3.3`, which is not an acceptable fix for this App Router project. The correct follow-up is to monitor Next.js patch releases and upgrade within the current major line when a safe fix is available.
