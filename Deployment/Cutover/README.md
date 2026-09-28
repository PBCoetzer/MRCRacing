# Production financial cutover

These scripts are operator-run controls for the forward-only 10/20/70 production promotion. They are not automatic migrations.

Run them in numeric order against the production Supabase project. Save every result with the release record.

1. Run `10-freeze-checkouts.sql` at T-30 minutes.
2. Wait until `payments.status = 'pending'` has no unexpired checkout.
3. Capture Xneelo, Edge Function, schema, public-data, and financial-manifest backups.
4. Run `11-freeze-all-financial-mutations.sql` at T-0.
5. Capture the authoritative T-0 result from `financial-manifest.sql`.
6. Apply `20260926230353_activate_forward_only_10_20_70_revenue_period.sql` transactionally.
7. Run `12-verify-activation.sql`; do not continue unless `passed` is true and the T-0 fingerprints match.
8. Deploy and smoke-test the approved Edge Functions and static export.
9. Run `13-unfreeze-financial-mutations.sql`, then verify the exact grants.

If activation fails before unfreezing, keep the freeze in place and run `20-compensate-legacy-10-0-90.sql`. It creates a new correction period and never rewrites a historical purchase or ledger row.
