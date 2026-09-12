# Data Retention And Rights Runbook

Status: operational baseline requiring final legal-owner approval before automated deletion

## Principles

- Keep personal information only for a documented purpose and approved period.
- Preserve financial, tax, dispute, fraud, security, and legal-hold records when deletion would conflict with an obligation.
- Minimize online access before deleting: restrict grants, redact payloads, and archive only when the archive has an owner and deletion date.
- Never delete or anonymize production records with ad hoc SQL. Use a reviewed, versioned migration or controlled administrator workflow with dry-run counts and an audit record.

## Proposed Retention Matrix

| Data category | Operational period | End-of-period action | Required exception |
| --- | --- | --- | --- |
| Auth identity and profile | Account lifetime | Delete or anonymize after verified closure | Fraud, dispute, legal hold |
| Terms, age, licence, and administrator verification audit | Account lifetime plus approved legal period | Archive or retain minimal evidence | Active dispute or legal hold |
| Paid payment, Credit, purchase, commission, refund, charity, and entitlement ledgers | Legal owner to confirm statutory period | Retain immutable financial record; minimize attached personal data | Statutory/tax/dispute hold |
| Failed or expired checkout provider payloads | 90 days proposed | Delete raw payload; keep aggregate operational counts | Fraud investigation |
| Notification outbox and provider message events | 12 months proposed | Delete payload/error detail; retain aggregate metrics | Delivery dispute or security hold |
| Auth email delivery diagnostics | 12 months proposed | Delete recipient-level events; retain aggregate delivery metrics | Account ownership dispute |
| Rejected/withdrawn tipster applications and identity media | 12 months proposed | Delete identity media and application PII | Appeal, dispute, legal hold |
| Race-feed, Hermes, and search-lab diagnostic payloads | 12 months proposed | Delete verbose payloads; retain source/evidence hashes and aggregate run metrics | Accuracy investigation |
| Site-build jobs and deployment manifests | 24 months proposed | Retain release SHA, hashes, result, and timestamps; delete verbose snapshots | Incident or legal hold |
| Security and administrator audit logs | 24 months online proposed | Archive minimal immutable events under restricted access | Fraud, dispute, legal hold |

The platform owner and legal adviser must replace every “proposed” period with an approved period before a purge job is enabled.

## Data-Subject Request Workflow

1. Record request receipt time, request type, communication channel, and case ID without copying unnecessary personal data.
2. Independently verify identity before disclosing, correcting, exporting, or deleting data.
3. Search Auth, profile, roles, applications, content, comments, media, purchases, payment references, Credits, entitlements, subscriptions, disputes, notifications, and audit records by internal user ID.
4. Separate exportable personal information from privileged security data, third-party data, provider secrets, and records under legal retention.
5. Obtain administrator and legal approval for exceptions.
6. Produce the response through an approved secure channel.
7. Apply corrections or deletion through an auditable workflow and verify downstream storage objects.
8. Record completion time, scope, exceptions, approver, and verification result.

## Account Deletion Order

1. Revoke active sessions and privileged access.
2. Disable notifications and marketing consent.
3. Resolve open payments, disputes, refunds, subscriptions, and entitlements.
4. Remove public profile, biography, comments, and media where deletion is approved.
5. Preserve or anonymize immutable financial/audit records according to the approved matrix.
6. Delete the Auth user only after dependent records and storage objects have been handled.
7. Verify that no public route, search index, notification queue, or storage URL still exposes deleted personal information.

## Automation Gate

Before adding a purge cron job:

- approve the retention matrix;
- add dry-run counts and maximum-row limits;
- exclude active disputes and legal holds;
- back up affected records;
- use idempotent batches;
- log only aggregate counts and internal job IDs;
- test in an isolated Supabase environment;
- monitor failures and stop on unexpected row counts.
