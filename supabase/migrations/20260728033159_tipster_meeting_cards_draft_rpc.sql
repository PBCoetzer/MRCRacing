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

  if p_coin_price is null or p_coin_price <= 0 then
    raise exception 'Coin price must be greater than zero.';
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
        v_fixture_id,
        v_winner_entry_id,
        v_place_entry_id,
        comments
      )
      values (
        card_row.id,
        fixture_id,
        winner_entry_id,
        place_entry_id,
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
    jsonb_build_object('revision', card_row.revision, 'status', card_row.status)
  );

  return to_jsonb(card_row);
end;
$$;

;
