# Database Audit

## Live Inventory

- Approximately 70 public tables; all have RLS enabled.
- 104 live migration history entries versus 106 local migration files.
- 15 deployed Edge Functions versus 14 local function directories.
- Core referential checks found no orphan profiles, roles, cards, card selections, Credit transactions, or purchase-backed entitlements.
- Published cards sampled have revision records; duplicate role assignments were not found.

## DB-001 — Migration history drift blocks deterministic release

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Schema change management |
| Problem | Twenty-three migrations have matching names but different local/live timestamps, and two local files are absent from live history: `fix_tipster_skipped_race_revision_order` and `apply_fairview_20260909_late_changes`. |
| Impact | Blind migration deployment can reapply production changes, fail on duplicate objects, or apply data-specific corrections unexpectedly. |
| Redacted evidence | Local count 106; live count 104; names reconcile but versions do not. |
| Object | `supabase/migrations`, `supabase_migrations.schema_migrations` |
| Recommended fix | Create a reconciliation manifest, classify the two local-only files as schema or environment-specific data repair, and establish one canonical version history before new DDL. |
| Verification | Local and live migration manifests match exactly by version/name/checksum or an approved baseline marker explains every exception. |
| Status | Open; release blocker |

## DB-002 — Foreign-key index gaps

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Query and delete/update performance |
| Problem | Supabase performance advisor reports 54 unindexed foreign keys. |
| Impact | Joins and parent-row updates/deletes can degrade as operational tables grow. |
| Redacted evidence | Live advisor count 54. |
| Object | Public and private table foreign keys |
| Recommended fix | Add indexes only for demonstrated join/filter/delete paths, prioritizing high-growth payments, notifications, race events, cards, purchases, and audit data. |
| Verification | Advisor diff plus `EXPLAIN (ANALYZE, BUFFERS)` on representative queries. |
| Status | Open; requires selective remediation |

## DB-003 — Multiple permissive RLS policies add overhead

| Field | Value |
| --- | --- |
| Severity | Low |
| Area | RLS performance and maintainability |
| Problem | Supabase reports 39 role/action combinations with multiple permissive policies. |
| Impact | PostgreSQL evaluates more policy expressions per query and reviewers must reason about several OR-combined grants. |
| Redacted evidence | Live advisor count 39; examples include cards, packages, payments, notifications, and roles. |
| Object | Public RLS policies |
| Recommended fix | Consolidate equivalent policies only after role-matrix regression tests exist; do not trade clarity for premature optimization. |
| Verification | Advisor count falls and role simulations remain identical. |
| Status | Open, low priority |

## DB-004 — Server-only tables rely on revoked grants

| Field | Value |
| --- | --- |
| Severity | Low |
| Area | Defense in depth |
| Problem | Six RLS-enabled tables have no policies. Five are in `app_private`; `public.site_build_jobs` is also server-only. |
| Impact | This is secure while API-role table grants stay revoked, but an accidental future grant would create confusing access behavior. |
| Redacted evidence | Supabase security advisor count 6 and grant inspection. |
| Object | Hermes queue/rate-limit/audit tables, notification worker tokens, site build jobs |
| Recommended fix | Add a grant regression query and document the intentional no-policy posture. |
| Verification | `anon` and `authenticated` have no table privileges and direct probes fail. |
| Status | Accepted with regression check pending |
