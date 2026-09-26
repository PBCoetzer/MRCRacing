alter table public.profiles
  add column if not exists email_marketing_consent_confirmed_at timestamptz,
  add column if not exists email_marketing_consent_version text,
  add column if not exists email_marketing_consent_source text;

comment on column public.profiles.email_marketing_consent_confirmed_at is
  'When the account holder last made an explicit email-marketing choice.';

comment on column public.profiles.email_marketing_consent_version is
  'Version of the email-marketing notice accepted or declined by the account holder.';

comment on column public.profiles.email_marketing_consent_source is
  'Collection point for the latest email-marketing choice, including legacy_backfill, registration, privacy_consent_prompt, or client_dashboard.';

create or replace function app_private.current_email_marketing_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-09-16-email-announcements'::text;
$$;

revoke all on function app_private.current_email_marketing_consent_version()
from public, anon, authenticated;

with latest_consent_event as (
  select distinct on (logs.entity_id)
    logs.entity_id as profile_id,
    logs.action,
    logs.metadata,
    logs.created_at
  from public.audit_logs logs
  where logs.entity_type = 'profile'
    and logs.action in (
      'email_marketing_consent_backfilled',
      'email_marketing_consent_granted',
      'email_marketing_consent_withdrawn'
    )
  order by logs.entity_id, logs.created_at desc, logs.id desc
)
update public.profiles profiles
set
  email_marketing_consent_confirmed_at = case
    when events.action = 'email_marketing_consent_backfilled' then null
    else events.created_at
  end,
  email_marketing_consent_version = coalesce(
    nullif(events.metadata ->> 'consentVersion', ''),
    app_private.current_email_marketing_consent_version()
  ),
  email_marketing_consent_source = case
    when events.action = 'email_marketing_consent_backfilled' then 'legacy_backfill'
    else coalesce(nullif(events.metadata ->> 'source', ''), 'client_dashboard')
  end
from latest_consent_event events
where profiles.id = events.profile_id;

create or replace function public.get_email_marketing_consent_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled',
      profiles.email_marketing_consented_at is not null
      and (
        profiles.email_marketing_withdrawn_at is null
        or profiles.email_marketing_consented_at > profiles.email_marketing_withdrawn_at
      ),
    'confirmedAt', profiles.email_marketing_consent_confirmed_at,
    'consentVersion', profiles.email_marketing_consent_version,
    'consentSource', profiles.email_marketing_consent_source,
    'currentVersion', app_private.current_email_marketing_consent_version(),
    'requiresConfirmation',
      profiles.email_marketing_consent_confirmed_at is null
      or profiles.email_marketing_consent_version is distinct from
        app_private.current_email_marketing_consent_version()
  )
  from public.profiles profiles
  where profiles.id = (select auth.uid());
$$;

revoke all on function public.get_email_marketing_consent_status()
from public, anon, authenticated, service_role;
grant execute on function public.get_email_marketing_consent_status()
to authenticated;

comment on function public.get_email_marketing_consent_status() is
  'Returns the authenticated user''s current optional email-marketing choice and whether a versioned explicit response is required.';

create or replace function public.respond_to_email_marketing_consent_prompt(
  p_enabled boolean,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_at timestamptz := clock_timestamp();
  current_version text := app_private.current_email_marketing_consent_version();
  previous_source text;
begin
  if p_enabled is null then
    raise exception 'Choose whether you want optional email announcements.';
  end if;

  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is not active.';
  end if;

  if nullif(btrim(p_consent_version), '') is distinct from current_version then
    raise exception 'The email consent notice has changed. Refresh and choose again.';
  end if;

  select profiles.email_marketing_consent_source
  into previous_source
  from public.profiles profiles
  where profiles.id = current_user_id;

  update public.profiles
  set
    email_marketing_consented_at = case
      when p_enabled then changed_at
      else email_marketing_consented_at
    end,
    email_marketing_withdrawn_at = case
      when p_enabled then null
      else changed_at
    end,
    email_marketing_consent_confirmed_at = changed_at,
    email_marketing_consent_version = current_version,
    email_marketing_consent_source = 'privacy_consent_prompt'
  where id = current_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    case
      when p_enabled then 'email_marketing_consent_granted'
      else 'email_marketing_consent_withdrawn'
    end,
    'profile',
    current_user_id,
    jsonb_build_object(
      'enabled', p_enabled,
      'changedAt', changed_at,
      'source', 'privacy_consent_prompt',
      'consentVersion', current_version,
      'previousConsentWasAdministrativeBackfill', previous_source = 'legacy_backfill'
    )
  );

  return jsonb_build_object(
    'enabled', p_enabled,
    'changedAt', changed_at,
    'confirmedAt', changed_at,
    'consentVersion', current_version,
    'consentSource', 'privacy_consent_prompt',
    'requiresConfirmation', false
  );
end;
$$;

revoke all on function public.respond_to_email_marketing_consent_prompt(boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.respond_to_email_marketing_consent_prompt(boolean, text)
to authenticated;

comment on function public.respond_to_email_marketing_consent_prompt(boolean, text) is
  'Records the authenticated active user''s explicit response to the versioned POPIA-aligned optional email-announcement notice.';

create or replace function public.set_email_marketing_consent(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_at timestamptz := clock_timestamp();
  current_version text := app_private.current_email_marketing_consent_version();
begin
  if p_enabled is null then
    raise exception 'A consent choice is required.';
  end if;

  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is not active.';
  end if;

  update public.profiles
  set
    email_marketing_consented_at = case
      when p_enabled then changed_at
      else email_marketing_consented_at
    end,
    email_marketing_withdrawn_at = case
      when p_enabled then null
      else changed_at
    end,
    email_marketing_consent_confirmed_at = changed_at,
    email_marketing_consent_version = current_version,
    email_marketing_consent_source = 'client_dashboard'
  where id = current_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    case
      when p_enabled then 'email_marketing_consent_granted'
      else 'email_marketing_consent_withdrawn'
    end,
    'profile',
    current_user_id,
    jsonb_build_object(
      'enabled', p_enabled,
      'changedAt', changed_at,
      'source', 'client_dashboard',
      'consentVersion', current_version
    )
  );

  return jsonb_build_object(
    'enabled', p_enabled,
    'changedAt', changed_at,
    'confirmedAt', changed_at,
    'consentVersion', current_version
  );
end;
$$;

revoke all on function public.set_email_marketing_consent(boolean)
from public, anon, authenticated, service_role;
grant execute on function public.set_email_marketing_consent(boolean)
to authenticated;

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
  email_choice_supplied boolean := new.raw_user_meta_data ? 'email_marketing_consent';
  email_marketing_accepted boolean := lower(
    coalesce(new.raw_user_meta_data ->> 'email_marketing_consent', 'false')
  ) = 'true';
  supplied_email_consent_version text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'email_marketing_consent_version'), ''),
    app_private.current_email_marketing_consent_version()
  );
  current_terms_version text := app_private.current_premium_terms_version();
  accepted_at_value timestamptz := now();
begin
  insert into public.profiles (
    id, first_name, last_name, display_name, phone,
    accepted_terms_at, accepted_terms_version, premium_terms_accepted_at,
    confirmed_over_18_at, email_notifications_enabled,
    email_marketing_consented_at, email_marketing_withdrawn_at,
    email_marketing_consent_confirmed_at, email_marketing_consent_version,
    email_marketing_consent_source
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
    true,
    case when email_choice_supplied and email_marketing_accepted then accepted_at_value else null end,
    case when email_choice_supplied and not email_marketing_accepted then accepted_at_value else null end,
    case when email_choice_supplied then accepted_at_value else null end,
    case when email_choice_supplied then supplied_email_consent_version else null end,
    case when email_choice_supplied then 'registration' else null end
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

  if email_choice_supplied then
    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.id,
      case
        when email_marketing_accepted then 'email_marketing_consent_granted'
        else 'email_marketing_consent_withdrawn'
      end,
      'profile',
      new.id,
      jsonb_build_object(
        'enabled', email_marketing_accepted,
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

comment on function app_private.handle_new_user() is
  'Creates the registered account profile and records versioned affirmative or declined optional email-announcement choices.';
