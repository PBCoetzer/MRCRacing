create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_first_name text := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  supplied_last_name text := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  supplied_display_name text := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  terms_accepted boolean := lower(coalesce(new.raw_user_meta_data ->> 'accepted_terms', 'false')) = 'true';
  supplied_terms_version text := nullif(btrim(new.raw_user_meta_data ->> 'accepted_terms_version'), '');
  email_marketing_accepted boolean := lower(
    coalesce(new.raw_user_meta_data ->> 'email_marketing_consent', 'false')
  ) = 'true';
  supplied_email_consent_version text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'email_marketing_consent_version'), ''),
    '2026-09-16-email-announcements'
  );
  current_terms_version text := app_private.current_premium_terms_version();
  accepted_at_value timestamptz := now();
begin
  insert into public.profiles (
    id, first_name, last_name, display_name, phone,
    accepted_terms_at, accepted_terms_version, premium_terms_accepted_at,
    confirmed_over_18_at, email_notifications_enabled,
    email_marketing_consented_at, email_marketing_withdrawn_at
  ) values (
    new.id,
    supplied_first_name,
    supplied_last_name,
    coalesce(
      supplied_display_name,
      nullif(btrim(concat_ws(' ', supplied_first_name, supplied_last_name)), '')
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    case when terms_accepted then accepted_at_value else null end,
    case when terms_accepted then supplied_terms_version else null end,
    case when terms_accepted
      and supplied_terms_version = current_terms_version
      then accepted_at_value else null end,
    case
      when lower(coalesce(new.raw_user_meta_data ->> 'confirmed_over_18', 'false')) = 'true'
      then accepted_at_value else null end,
    email_marketing_accepted,
    case when email_marketing_accepted then accepted_at_value else null end,
    null
  )
  on conflict (id) do nothing;

  if terms_accepted and supplied_terms_version is not null then
    insert into public.user_terms_acceptances (
      user_id,
      terms_version,
      accepted_at,
      accepted_via,
      client_context
    ) values (
      new.id,
      supplied_terms_version,
      accepted_at_value,
      'registration',
      jsonb_build_object('source', 'registration')
    )
    on conflict (user_id, terms_version) do nothing;
  end if;

  if email_marketing_accepted then
    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.id,
      'email_marketing_consent_granted',
      'profile',
      new.id,
      jsonb_build_object(
        'source', 'registration',
        'consentVersion', supplied_email_consent_version
      )
    );
  end if;

  insert into public.user_account_controls (user_id)
  values (new.id) on conflict (user_id) do nothing;
  insert into public.wallets (user_id)
  values (new.id) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'client') on conflict (user_id, role) do nothing;
  return new;
end;
$$;

revoke all on function app_private.handle_new_user()
from public, anon, authenticated;

with updated_profiles as (
  update public.profiles profiles
  set email_marketing_consented_at = now()
  where profiles.email_marketing_consented_at is null
    and profiles.email_marketing_withdrawn_at is null
    and profiles.email_notifications_enabled = true
    and exists (
      select 1
      from public.user_roles roles
      where roles.user_id = profiles.id
        and roles.role = 'client'
    )
    and app_private.account_is_active(profiles.id)
  returning profiles.id, profiles.email_marketing_consented_at
)
insert into public.audit_logs (
  actor_id,
  action,
  entity_type,
  entity_id,
  metadata,
  created_at
)
select
  null,
  'email_marketing_consent_backfilled',
  'profile',
  updated_profiles.id,
  jsonb_build_object(
    'source', 'existing_registered_client_backfill',
    'consentVersion', '2026-09-16-email-announcements',
    'preservedPriorWithdrawals', true
  ),
  updated_profiles.email_marketing_consented_at
from updated_profiles;

comment on function app_private.handle_new_user() is
  'Creates the registered account profile and records registration declarations, including versioned email-announcement consent.';
