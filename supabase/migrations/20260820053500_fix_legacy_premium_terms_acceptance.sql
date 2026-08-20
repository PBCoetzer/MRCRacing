-- Allow legacy accounts to accept the current full terms from the premium-card
-- dialog, while continuing to require an explicit current-version acceptance.

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
  current_terms_version constant text := '2026-08-20-premium-content';
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
    or profile_row.accepted_terms_version is distinct from current_terms_version then
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
