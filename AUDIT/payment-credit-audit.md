# Payment And Credit Audit

## End-To-End Trace

1. The authenticated browser requests a checkout from `create-credit-checkout`.
2. PostgreSQL resolves active package IDs and server-side prices and creates an idempotent pending payment/cart.
3. Ozow or PayFast receives a signed request generated only in the Edge Function.
4. Provider callbacks validate signatures, merchant/site identity, amount, reference, and provider-side status.
5. `complete_credit_payment` locks the payment, rejects replays, writes immutable Credit transactions, updates wallet components, and marks the payment paid in one transaction.
6. Purchases, entitlements, commissions, and approved refunds use unique idempotency keys and auditable ledger entries.

## Verified Invariants

- Zero negative wallets.
- Zero wallet component/total mismatches.
- Zero duplicate payment idempotency keys or provider references.
- Zero paid payments without matching Credit ledger entries.
- Zero non-paid payments with issued Credits.
- Zero payment/cart amount or Credit-total mismatches.
- Zero duplicate purchase idempotency keys.
- Zero active purchases without entitlements and zero orphan entitlements.
- Zero tipster-earnings mismatches in the tested aggregate checks.
- Refund execution is administrator-controlled; `process_due_meeting_refunds` is now an authorized no-op rather than an automatic refund mechanism.

## FIN-001 — Provider settlement evidence remains external

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Payment operations |
| Problem | Safe audit probes verified rejection paths and database invariants, but provider dashboards and real settlement reconciliation were not available. |
| Impact | Code-level correctness cannot prove that every production provider event, settlement, and bank receipt reconciles operationally. |
| Redacted evidence | No real charges or balance mutations were performed; dashboard access is outside the worktree. |
| Object | Ozow dashboard, PayFast dashboard, bank settlement records |
| Recommended fix | Perform a controlled low-value transaction per gateway, reconcile provider ID, payment row, Credit ledger, wallet, and settlement, then refund only through the admin workflow if required. |
| Verification | Signed reconciliation record with redacted IDs and timestamps. |
| Status | Manual acceptance test required |

## Release Assessment

The implemented financial model is strong and no live invariant breach was found. Payment release remains blocked by `SEC-001`, `DB-001`, and the external reconciliation in `FIN-001`, not by a discovered wallet or refund defect.
