alter table public.tip_cards
drop constraint if exists tip_cards_coin_price_check;

alter table public.tip_cards
add constraint tip_cards_coin_price_check
check (coin_price >= 0);

create or replace function public.save_tip_card_draft(
  p_card_id uuid,
  p_meeting_id uuid,
  p_title text,
  p_summary text,
  p_coin_price integer,
  p_expected_revision integer,
  p_listing_status public.tip_card_status,
  p_race_selections jsonb default '[]'::jsonb,
  p_multiples jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  race_item jsonb;
  multiple_item jsonb;
  leg_item jsonb;
  entry_value jsonb;
  v_fixture_id uuid;
  v_winner_entry_id uuid;
  v_place_entry_id uuid;
  v_bet_option_id uuid;
  v_multiple_id uuid;
  v_leg_number integer;
  v_leg_fixture_id uuid;
begin
  if current_tipster_id is null then
    raise exception 'A verified tipster profile is required.';
  end if;

  if p_listing_status not in ('draft', 'coming_soon') then
    raise exception 'Draft cards may only be saved as draft or coming soon.';
  end if;

  if p_coin_price is null or p_coin_price < 0 then
    raise exception 'Meeting price must be zero or a positive whole-Credit amount.';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'A meeting card title is required.';
  end if;

  if not exists (
    select 1
    from public.race_meetings
    where id = p_meeting_id
      and status = 'scheduled'
  ) then
    raise exception 'The selected meeting is unavailable.';
  end if;

  if p_card_id is null then
    insert into public.tip_cards (
      tipster_id,
      meeting_id,
      title,
      summary,
      coin_price,
      status,
      revision,
      listed_at
    )
    values (
      current_tipster_id,
      p_meeting_id,
      btrim(p_title),
      nullif(btrim(coalesce(p_summary, '')), ''),
      p_coin_price,
      p_listing_status,
      1,
      case when p_listing_status = 'coming_soon' then now() else null end
    )
    returning * into card_row;
  else
    select *
    into card_row
    from public.tip_cards
    where id = p_card_id
    for update;

    if card_row.id is null or card_row.tipster_id <> current_tipster_id then
      raise exception 'Tip card not found.';
    end if;

    if card_row.status not in ('draft', 'coming_soon') then
      raise exception 'Published cards must use the correction workflow.';
    end if;

    if card_row.meeting_id <> p_meeting_id then
      raise exception 'A tip card cannot be moved to another meeting.';
    end if;

    if card_row.revision <> p_expected_revision then
      raise exception 'Tip card changed in another session. Reload before saving.';
    end if;

    update public.tip_cards
    set
      title = btrim(p_title),
      summary = nullif(btrim(coalesce(p_summary, '')), ''),
      coin_price = p_coin_price,
      status = p_listing_status,
      revision = revision + 1,
      listed_at = case
        when p_listing_status = 'coming_soon' then coalesce(listed_at, now())
        else null
      end
    where id = card_row.id
    returning * into card_row;
  end if;

  delete from public.race_tip_selections
  where tip_card_id = card_row.id;

  delete from public.tip_card_multiples
  where tip_card_id = card_row.id;

  for race_item in
    select value
    from jsonb_array_elements(coalesce(p_race_selections, '[]'::jsonb))
  loop
    v_fixture_id := (race_item ->> 'fixtureId')::uuid;
    v_winner_entry_id := nullif(race_item ->> 'winnerEntryId', '')::uuid;
    v_place_entry_id := nullif(race_item ->> 'placeEntryId', '')::uuid;

    if not exists (
      select 1
      from public.fixtures
      where id = v_fixture_id
        and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Race selection is not part of this meeting.';
    end if;

    perform app_private.validate_entry_for_fixture(v_winner_entry_id, v_fixture_id);
    perform app_private.validate_entry_for_fixture(v_place_entry_id, v_fixture_id);

    if v_winner_entry_id is not null
      or v_place_entry_id is not null
      or nullif(btrim(coalesce(race_item ->> 'comments', '')), '') is not null
    then
      insert into public.race_tip_selections (
        tip_card_id,
        fixture_id,
        winner_entry_id,
        place_entry_id,
        comments
      )
      values (
        card_row.id,
        v_fixture_id,
        v_winner_entry_id,
        v_place_entry_id,
        nullif(btrim(coalesce(race_item ->> 'comments', '')), '')
      );
    end if;
  end loop;

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiples, '[]'::jsonb))
  loop
    v_bet_option_id := (multiple_item ->> 'betOptionId')::uuid;

    if not exists (
      select 1
      from public.meeting_bet_options
      where id = v_bet_option_id
        and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Meeting bet option is invalid.';
    end if;

    insert into public.tip_card_multiples (
      tip_card_id,
      bet_option_id,
      custom_name,
      comments
    )
    values (
      card_row.id,
      v_bet_option_id,
      nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
      nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
    )
    returning id into v_multiple_id;

    for leg_item in
      select value
      from jsonb_array_elements(coalesce(multiple_item -> 'legs', '[]'::jsonb))
    loop
      v_leg_number := (leg_item ->> 'legNumber')::integer;
      v_leg_fixture_id := (leg_item ->> 'fixtureId')::uuid;

      if not exists (
        select 1
        from public.fixtures
        where id = v_leg_fixture_id
          and meeting_id = card_row.meeting_id
      ) then
        raise exception 'Meeting bet leg is not part of this meeting.';
      end if;

      if exists (
        select 1
        from public.meeting_bet_options o
        where o.id = v_bet_option_id
          and o.bet_type <> 'other'
      ) and not exists (
        select 1
        from public.meeting_bet_legs l
        where l.bet_option_id = v_bet_option_id
          and l.leg_number = v_leg_number
          and l.fixture_id = v_leg_fixture_id
      ) then
        raise exception 'Meeting bet leg does not match the official leg mapping.';
      end if;

      for entry_value in
        select value
        from jsonb_array_elements(coalesce(leg_item -> 'entryIds', '[]'::jsonb))
      loop
        perform app_private.validate_entry_for_fixture(
          trim(both '"' from entry_value::text)::uuid,
          v_leg_fixture_id
        );

        insert into public.tip_card_multiple_selections (
          multiple_id,
          leg_number,
          fixture_id,
          entry_id
        )
        values (
          v_multiple_id,
          v_leg_number,
          v_leg_fixture_id,
          trim(both '"' from entry_value::text)::uuid
        )
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    (select auth.uid()),
    'tip_card_draft_saved',
    'tip_card',
    card_row.id,
    jsonb_build_object(
      'revision', card_row.revision,
      'status', card_row.status,
      'accessType', case when card_row.coin_price = 0 then 'free' else 'paid' end
    )
  );

  return to_jsonb(card_row);
end;
$$;

create or replace function app_private.user_can_access_tip_card(
  target_tip_card_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user_id is not null
    and app_private.account_is_active(target_user_id)
    and exists (
      select 1
      from public.tip_cards cards
      where cards.id = target_tip_card_id
        and cards.status in ('published', 'settled')
        and (
          cards.coin_price = 0
          or exists (
            select 1
            from public.tip_card_entitlements entitlements
            where entitlements.tip_card_id = cards.id
              and entitlements.user_id = target_user_id
              and entitlements.revoked_at is null
          )
        )
    );
$$;

alter table public.tip_card_access_logs
alter column entitlement_id drop not null;

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
  access_type_value text;
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

  if card_row.coin_price = 0 then
    access_type_value := 'free';
  else
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

    access_type_value := entitlement_row.source_type::text;
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
      'accessType', access_type_value,
      'entitlementId', entitlement_row.id,
      'termsVersion', current_terms_version
    )
  );

  return jsonb_build_object(
    'accessCode', access_code_value,
    'accessType', access_type_value,
    'displayName', coalesce(profile_row.display_name, 'MRC Client'),
    'accessedAt', accessed_at_value,
    'termsVersion', current_terms_version
  );
end;
$$;

create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text,
  p_purchase_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_meeting_card_confirmed$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase_id uuid;
  card_row record;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select purchases.id into existing_purchase_id
  from public.content_purchases purchases
  where purchases.user_id = current_user_id
    and purchases.idempotency_key = p_idempotency_key;

  if existing_purchase_id is not null then
    return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
  end if;

  if not coalesce(p_purchase_confirmed, false) then
    raise exception 'Confirm this meeting-card purchase before Credits are deducted.';
  end if;

  select
    cards.tipster_id,
    cards.status,
    cards.published_at,
    cards.coin_price,
    meetings.first_race_at
  into card_row
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  join public.tipsters tipsters
    on tipsters.id = cards.tipster_id
   and tipsters.is_verified = true
   and tipsters.is_public = true
  where cards.id = p_tip_card_id;

  if card_row.tipster_id is null
    or card_row.status <> 'published'
    or card_row.published_at is null
  then
    raise exception 'This meeting card is unavailable.';
  end if;

  if card_row.coin_price = 0 then
    raise exception 'This meeting card is free. Open it directly without a purchase.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meeting-purchase:' || current_user_id::text || ':' || p_tip_card_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.tipster_subscriptions subscriptions
    join public.content_purchases subscription_purchases
      on subscription_purchases.id = subscriptions.purchase_id
     and subscription_purchases.purchase_type = 'subscription'
     and subscription_purchases.status = 'active'
     and subscription_purchases.refunded_at is null
    where subscriptions.user_id = current_user_id
      and subscriptions.tipster_id = card_row.tipster_id
      and subscriptions.status = 'active'
      and card_row.first_race_at >= subscriptions.starts_at
      and card_row.first_race_at < subscriptions.ends_at
  ) then
    raise exception 'This meeting card is already included in your active subscription.';
  end if;

  if exists (
    select 1
    from public.content_purchases purchases
    where purchases.user_id = current_user_id
      and purchases.tip_card_id = p_tip_card_id
      and purchases.status in ('active', 'disputed')
  ) then
    raise exception 'You already own this meeting card and cannot purchase it twice.';
  end if;

  return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
end;
$purchase_meeting_card_confirmed$;

revoke all on function app_private.user_can_access_tip_card(uuid, uuid)
from public, anon, service_role;
grant execute on function app_private.user_can_access_tip_card(uuid, uuid)
to authenticated;

revoke all on function public.record_tip_card_access(uuid, text, jsonb)
from public, anon;
grant execute on function public.record_tip_card_access(uuid, text, jsonb)
to authenticated;

comment on constraint tip_cards_coin_price_check on public.tip_cards is
  'Meeting cards may be free (zero Credits) or use a positive whole-Credit price.';

comment on column public.tip_card_access_logs.entitlement_id is
  'Paid and subscription views reference their entitlement; free-card views intentionally have no financial entitlement.';

comment on function app_private.user_can_access_tip_card(uuid, uuid) is
  'Allows active users to view published free cards or cards covered by an active entitlement.';

comment on function public.record_tip_card_access(uuid, text, jsonb) is
  'Records watermarked access after versioned terms acceptance, including free cards without creating a purchase or entitlement.';
