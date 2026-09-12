alter table public.platform_settings
  add column if not exists premium_terms_version text not null
    default '2026-09-03-premium-content'
    check (btrim(premium_terms_version) <> '');

update public.platform_settings
set premium_terms_version = '2026-09-03-premium-content'
where singleton
  and btrim(premium_terms_version) = '';

create table if not exists public.user_terms_acceptances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  terms_version text not null check (btrim(terms_version) <> ''),
  accepted_at timestamptz not null default now(),
  accepted_via text not null default 'card_prompt'
    check (accepted_via in ('registration', 'card_prompt', 'legacy_card_prompt', 'migration')),
  client_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(client_context) = 'object' and octet_length(client_context::text) <= 2048),
  primary key (user_id, terms_version)
);

alter table public.user_terms_acceptances enable row level security;

drop policy if exists "user_terms_acceptances_select_own" on public.user_terms_acceptances;
create policy "user_terms_acceptances_select_own"
on public.user_terms_acceptances for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "user_terms_acceptances_admin_read" on public.user_terms_acceptances;
create policy "user_terms_acceptances_admin_read"
on public.user_terms_acceptances for select
to authenticated
using (app_private.current_user_has_role('administrator'));

revoke all on table public.user_terms_acceptances from public, anon, authenticated;
grant select on table public.user_terms_acceptances to authenticated;

create or replace function app_private.current_premium_terms_version()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select settings.premium_terms_version
      from public.platform_settings settings
      where settings.singleton
      limit 1
    ),
    '2026-09-03-premium-content'
  );
$$;

revoke all on function app_private.current_premium_terms_version()
from public, anon, authenticated;

insert into public.user_terms_acceptances (
  user_id,
  terms_version,
  accepted_at,
  accepted_via,
  client_context
)
select
  profiles.id,
  profiles.accepted_terms_version,
  coalesce(profiles.premium_terms_accepted_at, profiles.accepted_terms_at, now()),
  'migration',
  jsonb_build_object('source', 'profiles_backfill')
from public.profiles profiles
where profiles.accepted_terms_version is not null
  and profiles.accepted_terms_at is not null
on conflict (user_id, terms_version) do nothing;

create or replace function public.get_current_premium_terms_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.current_premium_terms_version();
$$;

revoke all on function public.get_current_premium_terms_version()
from public;
grant execute on function public.get_current_premium_terms_version()
to anon, authenticated;

create or replace function public.get_premium_terms_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_terms_version text := app_private.current_premium_terms_version();
  acceptance_row public.user_terms_acceptances%rowtype;
begin
  if current_user_id is null or not app_private.current_user_account_active() then
    raise exception 'An active client account is required.';
  end if;

  select * into acceptance_row
  from public.user_terms_acceptances
  where user_id = current_user_id
    and terms_version = current_terms_version;

  return jsonb_build_object(
    'currentVersion', current_terms_version,
    'hasAcceptedCurrent', acceptance_row.user_id is not null,
    'acceptedAt', acceptance_row.accepted_at,
    'acceptedVia', acceptance_row.accepted_via
  );
end;
$$;

revoke all on function public.get_premium_terms_status()
from public, anon;
grant execute on function public.get_premium_terms_status()
to authenticated;

create or replace function public.accept_current_premium_terms(
  p_client_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_terms_version text := app_private.current_premium_terms_version();
  accepted_at_value timestamptz;
  inserted_acceptance boolean := false;
begin
  if current_user_id is null or not app_private.current_user_account_active() then
    raise exception 'An active client account is required.';
  end if;

  if p_client_context is null or jsonb_typeof(p_client_context) <> 'object'
    or octet_length(p_client_context::text) > 2048 then
    raise exception 'Invalid client acceptance context.';
  end if;

  insert into public.user_terms_acceptances (
    user_id,
    terms_version,
    accepted_via,
    client_context
  ) values (
    current_user_id,
    current_terms_version,
    'card_prompt',
    p_client_context
  )
  on conflict (user_id, terms_version) do nothing
  returning accepted_at into accepted_at_value;

  if accepted_at_value is not null then
    inserted_acceptance := true;
  else
    select accepted_at into accepted_at_value
    from public.user_terms_acceptances
    where user_id = current_user_id
      and terms_version = current_terms_version;
  end if;

  update public.profiles
  set
    accepted_terms_at = accepted_at_value,
    accepted_terms_version = current_terms_version,
    premium_terms_accepted_at = accepted_at_value,
    updated_at = now()
  where id = current_user_id
    and (
      accepted_terms_version is distinct from current_terms_version
      or accepted_terms_at is distinct from accepted_at_value
      or premium_terms_accepted_at is distinct from accepted_at_value
    );

  if inserted_acceptance then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      current_user_id,
      'premium_terms_accepted',
      'profile',
      current_user_id,
      jsonb_build_object(
        'termsVersion', current_terms_version,
        'acceptedVia', 'card_prompt'
      )
    );
  end if;

  return jsonb_build_object(
    'currentVersion', current_terms_version,
    'hasAcceptedCurrent', true,
    'acceptedAt', accepted_at_value,
    'acceptedVia', case when inserted_acceptance then 'card_prompt' else 'existing' end
  );
end;
$$;

revoke all on function public.accept_current_premium_terms(jsonb)
from public, anon;
grant execute on function public.accept_current_premium_terms(jsonb)
to authenticated;

create or replace function public.record_tip_card_access(
  p_tip_card_id uuid,
  p_terms_version text default null,
  p_client_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_terms_version text := app_private.current_premium_terms_version();
  profile_row public.profiles%rowtype;
  entitlement_row public.tip_card_entitlements%rowtype;
  card_row public.tip_cards%rowtype;
  log_id uuid := gen_random_uuid();
  access_code_value text;
  accessed_at_value timestamptz := now();
begin
  if current_user_id is null or not app_private.current_user_account_active() then
    raise exception 'An active client account is required.';
  end if;

  if p_client_context is null or jsonb_typeof(p_client_context) <> 'object'
    or octet_length(p_client_context::text) > 2048 then
    raise exception 'Invalid client access context.';
  end if;

  if not exists (
    select 1
    from public.user_terms_acceptances acceptance
    where acceptance.user_id = current_user_id
      and acceptance.terms_version = current_terms_version
  ) then
    if p_terms_version is distinct from current_terms_version then
      raise exception 'Please accept the current terms before opening this meeting card.';
    end if;

    perform public.accept_current_premium_terms(p_client_context);

    update public.user_terms_acceptances
    set accepted_via = 'legacy_card_prompt'
    where user_id = current_user_id
      and terms_version = current_terms_version
      and accepted_via = 'card_prompt';
  end if;

  select * into profile_row
  from public.profiles
  where id = current_user_id;

  select * into card_row
  from public.tip_cards
  where id = p_tip_card_id
    and status in ('published', 'settled');

  if card_row.id is null then
    raise exception 'Published meeting card not found.';
  end if;

  perform app_private.sync_tip_card_subscription_entitlements(p_tip_card_id);

  select * into entitlement_row
  from public.tip_card_entitlements
  where user_id = current_user_id
    and tip_card_id = p_tip_card_id
    and revoked_at is null
  order by granted_at
  limit 1;

  if entitlement_row.id is null then
    raise exception 'You do not have access to this meeting card.';
  end if;

  access_code_value := 'MRC-' || upper(substr(replace(log_id::text, '-', ''), 1, 12));

  insert into public.tip_card_access_logs (
    id, access_code, user_id, tip_card_id, entitlement_id,
    terms_version, client_context, accessed_at
  ) values (
    log_id, access_code_value, current_user_id, p_tip_card_id,
    entitlement_row.id, current_terms_version, p_client_context, accessed_at_value
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id, 'premium_tip_card_opened', 'tip_card', p_tip_card_id,
    jsonb_build_object(
      'accessCode', access_code_value,
      'accessLogId', log_id,
      'entitlementId', entitlement_row.id,
      'termsVersion', current_terms_version
    )
  );

  return jsonb_build_object(
    'accessCode', access_code_value,
    'displayName', coalesce(profile_row.display_name, 'MRC Client'),
    'accessedAt', accessed_at_value,
    'termsVersion', current_terms_version
  );
end;
$$;

revoke all on function public.record_tip_card_access(uuid, text, jsonb)
from public, anon;
grant execute on function public.record_tip_card_access(uuid, text, jsonb)
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
  current_terms_version text := app_private.current_premium_terms_version();
  accepted_at_value timestamptz := now();
begin
  insert into public.profiles (
    id, first_name, last_name, display_name, phone,
    accepted_terms_at, accepted_terms_version, premium_terms_accepted_at,
    confirmed_over_18_at
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
      then now() else null end
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

comment on column public.platform_settings.premium_terms_version is
  'Current platform and premium-content terms version. Changing it requires each client to accept the new version once.';
comment on table public.user_terms_acceptances is
  'Immutable per-account acceptance history keyed by terms version.';
comment on function public.get_current_premium_terms_version() is
  'Returns the server-configured current terms version for registration.';
comment on function public.get_premium_terms_status() is
  'Returns whether the signed-in account has accepted the current terms version.';
comment on function public.accept_current_premium_terms(jsonb) is
  'Idempotently records the signed-in account acceptance for the current terms version.';
comment on function public.record_tip_card_access(uuid, text, jsonb) is
  'Records entitled card access after versioned terms acceptance. The terms parameter remains for legacy-client compatibility.';
