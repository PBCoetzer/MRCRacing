begin;

with backfilled_profiles as (
  select logs.entity_id as user_id, logs.created_at as backfilled_at
  from public.audit_logs logs
  where logs.action = 'email_marketing_consent_backfilled'
    and logs.entity_type = 'profile'
    and logs.metadata ->> 'consentVersion' = '2026-09-16-email-announcements'
), reverted_profiles as (
  update public.profiles profiles
  set email_marketing_consented_at = null
  from backfilled_profiles backfill
  where profiles.id = backfill.user_id
    and profiles.email_marketing_consented_at = backfill.backfilled_at
    and profiles.email_marketing_withdrawn_at is null
  returning profiles.id
)
insert into public.audit_logs (
  actor_id,
  action,
  entity_type,
  entity_id,
  metadata
)
select
  null,
  'email_marketing_consent_backfill_reverted',
  'profile',
  reverted_profiles.id,
  jsonb_build_object(
    'source', 'approved_compensating_repair',
    'consentVersion', '2026-09-16-email-announcements'
  )
from reverted_profiles;

commit;
