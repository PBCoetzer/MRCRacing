# Production Operations Runbook

## Ownership And Escalation

- Primary owner: MRC platform owner
- Database/Auth/Edge: Supabase project owner
- Static hosting: Xneelo account owner
- Payments: gateway merchant-account owner
- Email: Supabase Auth and email-provider owner

Any payment, Credit, entitlement, refund, authorization, or customer-data incident is release-blocking until contained and reconciled. Preserve redacted timestamps, request IDs, provider IDs, and audit IDs; never paste tokens, passwords, raw provider payloads, or customer records into tickets.

## Monitoring Schedule

| Check | Frequency | Warning | Critical |
| --- | --- | --- | --- |
| Public homepage and login | 5 minutes | One failed probe | Two consecutive failures or invalid TLS |
| Supabase Auth sign-in endpoint | 5 minutes | Elevated latency | Repeated 5xx or confirmed sign-in failure |
| Payment/webhook functions | Continuous provider logs | Any signature or provider error spike | Credits issued without a verified paid payment |
| Notification outbox | 5 minutes | Oldest ready item over 15 minutes | Failed item or oldest ready item over 30 minutes |
| Auth email delivery | 5 minutes | Accepted but not delivered after 10 minutes | Bounce, complaint, suppression, or provider rejection |
| Race-feed jobs | Hourly | No successful run in 3 hours | No successful run in 6 hours before a meeting |
| Hermes race jobs | 5 minutes | Available job older than 10 minutes | Deadline missed or attempts exhausted |
| Site-build jobs | 5 minutes | Queued job older than 20 minutes | Failed build or deployed SHA mismatch |
| Supabase advisors | Weekly and after DDL | New warning | New exposed object or RLS/grant regression |
| Xneelo backup restore drill | Quarterly | Restore documentation drift | Backup cannot be restored and verified |

Use `Deployment/Production Health Queries.sql` from an administrator-only SQL session for redacted counts. The queries do not return recipient addresses, payload bodies, tokens, or error text.

## Incident Flow

1. Record the first observed time, affected surface, release SHA, and redacted correlation IDs.
2. Stop the smallest risky capability: disable checkout UI for payment uncertainty, pause a worker for duplicate delivery, or block a release for authorization uncertainty.
3. Preserve Xneelo, Supabase, gateway, and email-provider evidence before changing state.
4. Reproduce with non-mutating checks or a rollback-only transaction.
5. Reconcile authoritative provider state to database ledgers before repair.
6. Apply a versioned migration or committed function/frontend fix; never edit balances or grants ad hoc without an audit record.
7. Rerun focused tests, complete verification, advisors, and smoke tests.
8. Document root cause, affected records, repair IDs, verification, owner, and prevention action.

## Payment And Credit Incident

- Disable `NEXT_PUBLIC_PAYMENTS_ENABLED` in the next static release if checkout must be stopped.
- Do not mark a payment paid from a browser return.
- Compare provider transaction ID, signature/hash verification, payment idempotency key, Credit transaction, wallet components, purchase, entitlement, tipster earning, and approved refund audit.
- Never issue or remove Credits to make totals look correct before completing reconciliation.

## Authentication And Email Incident

- Use admin registration diagnostics and delivery timestamps without exposing confirmation links or tokens.
- A provider acceptance event is not proof of delivery; use delivered, bounced, complained, suppressed, and failed events.
- Manual verification requires independent ownership verification and an audit reason.
- If delivery tracking remains empty, verify the Supabase Send Email hook, provider API key, sender DNS, and webhook signing secret before claiming that messages were delivered.

## Queue Recovery

- Identify the oldest available item and recent failure count.
- Confirm the current cron target and deployed function version.
- Resolve configuration or provider failures before retrying.
- Preserve deduplication keys and attempt counters; never clone queue rows to force delivery.

## Public-Site Incident

- Use the Xneelo backup from the latest deployment for rollback.
- Confirm `index.html`, `_next`, images, RSC payload aliases, headers, and HTTPS.
- Test dynamic blog/tipster pages directly and by client-side navigation.
- If only stale content is affected, verify the site-build queue and deployed commit SHA before a full rollback.
