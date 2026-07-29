# Review Cycle 16 - Credits, Profiles, Payments And Tipster UX

Date: 2026-07-29

## Delivered

- Full-width MRC home hero and horizontal public meeting rail.
- Full-bleed affiliate partner blocks.
- Database-backed Credit packages at R1 = 1 Credit.
- PayFast and Ozow checkout, callback verification, and redirect-only return handling.
- Client subscribed-tipster, meeting-card, discovery, marketplace, and dispute ordering.
- Public tipster directory, favourites, truthful performance stats, and static profile routes.
- Tipster results states and free-text Exotic's and Multiples.
- Fixed admin Credit conversion with configurable commission only.

## Verification

- `npm run lint`: passed.
- `npm run build:static`: passed; all 23 routes statically exported.
- Local browser: home, pricing, tipsters, tipster profile, client guard, and tipster guard loaded without an error overlay.
- Affiliate images and MRC logo loaded with non-zero natural dimensions.
- Anonymous RLS: five public Credit packages visible and private test meetings hidden.
- Favourite RLS: simulated authenticated user saw only their own favourite row.
- Payment finalization: duplicate completion produced one 50-Credit wallet increase and one ledger entry.
- Free-text draft, publication, and revision RPCs passed inside rollback-only production verification transactions.
- PayFast and Ozow webhook endpoints returned `503 Payments disabled` without merchant enablement.
- Unauthenticated checkout returned `401` before function execution.
- Supabase security advisors reported no warnings for the new Credit, favourite, performance, payment completion, or free-text schema.
- Added covering indexes for the new favourite-tipster and payment-package foreign keys.

## Payment Safety

- `PAYMENTS_ENABLED` and `NEXT_PUBLIC_PAYMENTS_ENABLED` remain false.
- Provider secrets stay in Supabase Edge Function secrets only.
- Xneelo receives static public environment values and no gateway signing credentials.
- Return URLs never issue Credits.
