-- Keep registration, client prompts, and secure card access on one terms version.
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
  current_terms_version constant text := '2026-09-03-premium-content';
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

  select * into profile_row
  from public.profiles
  where id = current_user_id
  for update;

  if profile_row.accepted_terms_at is null
    or profile_row.accepted_terms_version is distinct from current_terms_version
    or profile_row.premium_terms_accepted_at is null
  then
    if p_terms_version is distinct from current_terms_version then
      raise exception 'Please accept the current terms before opening this meeting card.';
    end if;

    update public.profiles
    set
      accepted_terms_at = coalesce(accepted_terms_at, now()),
      accepted_terms_version = current_terms_version,
      premium_terms_accepted_at = now(),
      updated_at = now()
    where id = current_user_id
    returning * into profile_row;
  end if;

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

  if p_client_context is null or jsonb_typeof(p_client_context) <> 'object'
    or octet_length(p_client_context::text) > 2048 then
    raise exception 'Invalid client access context.';
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
    case when terms_accepted then now() else null end,
    case when terms_accepted then supplied_terms_version else null end,
    case when terms_accepted
      and supplied_terms_version = '2026-09-03-premium-content'
      then now() else null end,
    case
      when lower(coalesce(new.raw_user_meta_data ->> 'confirmed_over_18', 'false')) = 'true'
      then now() else null end
  )
  on conflict (id) do nothing;

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

update public.profiles
set
  premium_terms_accepted_at = accepted_terms_at,
  updated_at = now()
where accepted_terms_at is not null
  and accepted_terms_version = '2026-09-03-premium-content'
  and premium_terms_accepted_at is null;

comment on function public.record_tip_card_access(uuid, text, jsonb) is
  'Records entitled card access and accepts the current premium-content terms when explicitly supplied.';
