# Revenue split emergency rollback

Status: completed and verified on 26 September 2026.

## Trigger

The owner reported major Credit inconsistencies after the outstanding release and requested an immediate rollback.

## Backup position

- A complete Xneelo `public_html` backup existed immediately before the frontend deployment:
  - `Deployment/Xneelo Backups/public_html-before-20260926-105052.zip`
  - 14,276,684 bytes
  - SHA-256 `2026CDDCE51892DA5FD8145C5990C138D66F5CD5B8AFC65CFCAC9313C6ED596D`
- A second independently-created pre-release archive had the same size and SHA-256:
  - `Deployment/Xneelo Backups/public_html-before-20260926-104332.zip`
- The deployed release was backed up again before restoration:
  - `Deployment/Xneelo Backups/public_html-before-20260926-111253.zip`
  - 14,654,290 bytes
  - SHA-256 `FDCD7A180C39DCABC994AC30EBE8838B98A47D439F7FF5E48718FCAED4C7F4F4`
- No complete local pre-change SQL dump exists. The dump attempt failed before deployment because Docker/PostgreSQL dump tooling was unavailable.
- The Supabase project is on the Free plan, which does not provide scheduled dashboard backups or Point-in-Time Recovery.

## Database rollback

1. `20260926111000_emergency_freeze_content_spend.sql` temporarily revoked paid meeting-card and subscription purchase execution.
2. `20260926112500_compensate_content_spend_revenue_split.sql` restored the previous financial policy:
   - MRC platform: 10%.
   - Tipster: 90%.
   - Horse Care: 10% of the MRC platform commission.
   - Reward Credits remain excluded from cash-backed earnings.
3. `20260926114000_remove_failed_split_ledger_artifacts.sql` removed only deterministic rows created by the failed split and its compensation, then converted the single legitimate purchase made during deployment to the previous ledger format.

No wallets, purchases, entitlements, subscriptions, payment records, client balances, or original audit records were deleted.

## Verified result

- 88 active purchases retained.
- Purchased Credits allocated: 4,310.
- Platform Credits: 431.
- Tipster Credits: 3,879.
- Reward Credits excluded: 1,385.
- Purchase allocation mismatches: 0.
- Tipster earnings ledger mismatches: 0.
- Temporary failed-split earnings rows: 0.
- Temporary failed-split Horse Care rows: 0.
- Horse Care accrued balance restored to 4,160 cents using the previous per-purchase rounding method.
- Wallets checked: 241.
- Negative wallet balances: 0.
- Wallet component mismatches: 0.
- Total wallet balance: 5,115 Credits, comprising 1,830 Purchased Credits and 3,285 Reward Credits.

Paid meeting-card and subscription purchase execution was re-enabled only after these checks passed.

## Frontend rollback

- Restored `public_html-before-20260926-105052.zip` over production.
- 1,023 archived files were verified.
- 451 files were restored, 572 were already identical, and 34 release-only files were removed.
- The homepage and pricing page return HTTP 200.
- `/admin/revenue/` returns HTTP 404 and the revenue-split marker is absent from the live frontend.

## Scope note

Supabase does not provide an automatic source-version rollback for Edge Functions, and no independent copy of every immediately previous function bundle was captured. The credit allocation path is database-controlled and has been restored and verified. Unrelated race-feed, email, MFA, payment-security, and Telegram function improvements were not destructively replaced with an older Git baseline because that could reintroduce resolved production defects.
