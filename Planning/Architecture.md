# System Architecture

## Architecture Decision

MRC Website will use a Next.js application in `Frontend` with Supabase as the backend platform. Supabase provides PostgreSQL, authentication, storage, row-level security, and realtime-ready data access. Payment gateways and sports data providers will be integrated through internal adapter modules so providers can be swapped or added without rewriting the product.

## Application Layers

- Public website: SEO-ready pages for the homepage, pricing, legal, FAQ, and educational content.
- Auth layer: Supabase Auth for registration, login, email verification, password reset, and sessions.
- Client dashboard: credits, unlocked tips, upcoming tips, history, payments, notifications, profile, and settings.
- Tipster dashboard: tip creation, result updates, performance, followers, earnings, and profile management.
- Admin dashboard: user management, tipsters, sports, fixtures, results, credits, transactions, payments, subscriptions, announcements, reports, audit logs, settings, and API configuration.
- Data layer: PostgreSQL tables with foreign keys, indexes, constraints, and RLS policies.
- Integration layer: payment adapters and sports data adapters.

## State Management

Initial state management will use React Server Components for server-derived data, URL/search params for shareable filters, and local Client Component state for isolated controls such as tabs, mobile navigation, forms, and dialogs. A global client store should only be added when repeated cross-page client state appears, such as live notification state or complex admin filters.

## Main Flows

### Registration Flow

1. User registers with email, password, required profile fields, and 18+ confirmation.
2. Supabase sends email verification.
3. A profile row is created and assigned the `client` role by default.
4. Admin can promote a user to tipster or administrator.

### Credit Purchase Flow

1. User selects a credit package.
2. App creates a pending payment row.
3. User is redirected to the chosen payment gateway.
4. Payment gateway sends a webhook to a secure route.
5. Server verifies the webhook signature and amount.
6. Wallet transaction is created once using idempotency keys.
7. Wallet balance becomes available to unlock premium tips.

### Tip Unlock Flow

1. User views locked premium tip preview.
2. Server checks authenticated user, credit balance, tip status, and previous unlocks.
3. If eligible, a credit transaction deducts the required credits.
4. A tip unlock row records permanent access.
5. Full tip analysis is returned to the user.

### Tipster Flow

1. Tipster drafts a tip with sport, fixture, odds, confidence, bookmaker, analysis, prediction, and credit cost.
2. Tipster publishes or schedules the tip.
3. Result is recorded after fixture completion.
4. Statistics update from official result records, not manual marketing numbers.

### Admin Flow

1. Admin views operational dashboard.
2. Admin manages users, roles, fixtures, results, payments, credits, and announcements.
3. Sensitive actions create audit log entries.

## Security Model

- Supabase Auth issues sessions and JWTs.
- RLS protects all exposed public schema tables.
- Role checks use server-side validation and database policies.
- Service role keys are server-only and never exposed to browsers.
- Payment webhooks require signature verification and idempotent processing.
- Premium tips are never unlocked by client-side state alone.

## Deployment Direction

- Local development uses Next.js dev server and local environment variables.
- Production should use Vercel or any Node.js-compatible host.
- Supabase remains the managed backend.
- Use `output: "standalone"` later if deploying to a VPS or Node host outside Vercel.
