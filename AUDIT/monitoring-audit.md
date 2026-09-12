# Monitoring Audit

## Existing Signals

- Edge Functions emit platform logs and return sanitized errors.
- Payment, Auth email, notification, race-feed, card, and administrator actions have database audit records.
- Hermes and site-build bridges expose bounded health endpoints.
- Admin pages surface registration, confirmation, payment, refund, and race-feed diagnostics.

## MON-001 — No centralized error and availability alerting

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Observability |
| Problem | No centralized frontend error collector, uptime monitor, alert routing, or trace correlation was found. |
| Impact | Registration, Auth, payment, race-feed, or client-render failures may be discovered first through customer reports. |
| Redacted evidence | No Sentry/OpenTelemetry equivalent, no uptime configuration, and no alert definitions in the active worktree. |
| Object | Frontend, Supabase Edge Functions, Xneelo availability |
| Recommended fix | Add privacy-safe error reporting, synthetic health/registration probes, queue-failure thresholds, and owner escalation with runbooks. |
| Verification | Controlled test errors and downtime trigger alerts with correlation IDs and no sensitive payloads. |
| Status | Open |

## MON-002 — Auth delivery tracking is deployed but inactive

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Authentication email delivery |
| Problem | Delivery/bounce tracking schema and Edge Functions are deployed, but the Send Email hook/Resend rollout is intentionally not enabled. Both tracking tables currently contain zero rows. |
| Impact | Operators can see Supabase `confirmation_sent_at` but cannot prove mailbox-provider acceptance, delivery, delay, bounce, complaint, or suppression for current registrations. |
| Redacted evidence | `Deployment/Supabase Auth Email Delivery.md` marks rollout incomplete; live message/event counts are zero. |
| Object | Supabase Auth hook, `auth-send-email`, `auth-email-webhook`, provider DNS/secrets |
| Recommended fix | Complete domain/DNS/provider setup, enable the signed Auth hook, register the signed delivery webhook, and run accepted/delivered/bounce tests. |
| Verification | Admin diagnostics show provider message IDs and immutable delivery/bounce timestamps for controlled addresses. |
| Status | External configuration release blocker |

## MON-003 — Queue health has no explicit service-level thresholds

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Background jobs |
| Problem | Cron schedules and outbox retry state exist, but no documented thresholds alert on queue age, repeated failures, missing race results, or stale builds. |
| Impact | A worker can remain partially degraded while successful historical data keeps the UI looking healthy. |
| Redacted evidence | Four active cron jobs were inventoried; no alert policy configuration was found. |
| Object | Notification outbox, race-feed jobs, lifecycle worker, site-build jobs |
| Recommended fix | Define maximum queue age/failure counts and stale-data windows; expose redacted health summaries and alert when breached. |
| Verification | Seeded non-production failures cross thresholds and resolve cleanly after recovery. |
| Status | Open |
