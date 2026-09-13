# Privacy And Compliance Audit

Technical review only; this is not legal advice.

## Controls Verified

- Registration records terms acceptance and `confirmed_over_18` timestamps.
- Analytics waits for explicit local consent.
- SMS service consent and marketing consent are stored separately.
- Public pages disclose purposes, retention, rights, contact routes, payment handling, and content-access logging.
- Tipster identity documents are stored in a private bucket with applicant/admin access.
- Audit reports and logs reviewed here do not include secret values or private customer details.

## PRIV-001 — All-client card announcements lack separate marketing consent

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Direct marketing preference |
| Problem | A tipster can announce a new card to every active client whose general email-notification flag is true. The flag defaults true and no separate email-marketing consent timestamp exists. |
| Impact | Promotional messages may be sent without a clear, specific opt-in or durable evidence of that opt-in. |
| Redacted evidence | `queue_tip_card_all_client_emails` targets all active client roles with `email_notifications_enabled = true`; profile default is true. |
| Object | Notification preference schema, all-client announcement RPC, client settings UI |
| Recommended fix | Add a distinct email-marketing consent field, default it off, provide explicit opt-in/withdrawal, and require consent for all-client promotional announcements while leaving transactional mail unaffected. |
| Verification | Non-consenting users are excluded; consent timestamp and withdrawal are auditable; transactional messages still deliver. |
| Status | Fixed and deployed from `427082e`; explicit email-marketing consent defaults off, records opt-in/withdrawal timestamps through a self-only audited RPC, and gates all-client announcements without changing transactional mail. Live checks confirm anonymous execution is denied and existing accounts remain opted out by default. |

## PRIV-002 — Data-subject requests are manual only

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Access, correction, deletion, export |
| Problem | The site directs users to email/telephone support for data access, correction, export, and eligible deletion; there is no tracked self-service request workflow. |
| Impact | Requests can be lost, deadlines are harder to evidence, and operators must manually verify identity and scope retention exceptions. |
| Redacted evidence | Privacy and contact pages describe manual support routes only. |
| Object | Privacy operations |
| Recommended fix | Add an authenticated privacy-request intake with immutable status/audit history, or adopt a documented ticket workflow with owners and deadlines. |
| Verification | Controlled request can be submitted, acknowledged, exported/redacted, and closed with an audit trail. |
| Status | Mitigated operationally in `d87316d`; a documented, auditable intake/identity/export/deletion workflow now defines owners and evidence. A self-service product workflow remains future work. |

## PRIV-003 — Retention periods are purpose-based but not operationally scheduled

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Data minimization and retention |
| Problem | Policy wording describes purpose-based retention, but no retention matrix or automated purge/anonymization schedule was found for logs, rejected applications, notification events, or abandoned checkouts. |
| Impact | Personal and operational data may be retained longer than necessary. |
| Redacted evidence | Schema includes growing audit, notification, race-feed, and application records; no retention job was found. |
| Object | Audit logs, notifications, Auth email events, application documents, payment attempts |
| Recommended fix | Approve a legal/operational retention matrix, then add safe archival or anonymization jobs with financial/audit holds. |
| Verification | Documented schedule, dry-run counts, approved exclusions, and monitored purge jobs. |
| Status | Proposed retention matrix and safe dry-run procedure documented in `d87316d`; legal/operational approval remains required before any purge automation. |
