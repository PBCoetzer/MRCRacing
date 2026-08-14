create or replace function public.revise_tip_card(
  p_card_id uuid,
  p_expected_revision integer,
  p_revision_summary text,
  p_race_changes jsonb default '[]'::jsonb,
  p_multiple_changes jsonb default '[]'::jsonb
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
  fixture_row public.fixtures%rowtype;
  v_winner_entry_id uuid;
  v_place_entry_id uuid;
  bet_option_row public.meeting_bet_options%rowtype;
  v_multiple_id uuid;
  v_leg_number integer;
  v_leg_fixture_id uuid;
begin
  if nullif(btrim(coalesce(p_revision_summary, '')), '') is null then
    raise exception 'A correction summary is required.';
  end if;

  select *
  into card_row
  from public.tip_cards
  where id = p_card_id
  for update;

  if current_tipster_id is null
    or card_row.id is null
    or card_row.tipster_id <> current_tipster_id
  then
    raise exception 'Tip card not found.';
  end if;

  if card_row.status <> 'published' then
    raise exception 'Only published cards can use the correction workflow.';
  end if;

  if card_row.revision <> p_expected_revision then
    raise exception 'Tip card changed in another session. Reload before publishing the correction.';
  end if;

  for race_item in
    select value
    from jsonb_array_elements(coalesce(p_race_changes, '[]'::jsonb))
  loop
    select *
    into fixture_row
    from public.fixtures
    where id = (race_item ->> 'fixtureId')::uuid
      and meeting_id = card_row.meeting_id;

    if fixture_row.id is null then
      raise exception 'Race correction is not part of this meeting.';
    end if;

    if fixture_row.starts_at <= now() then
      raise exception 'Race % is locked because it has started.', fixture_row.race_number;
    end if;

    if coalesce((race_item ->> 'remove')::boolean, false) then
      delete from public.race_tip_selections
      where tip_card_id = card_row.id
        and fixture_id = fixture_row.id;
    else
      v_winner_entry_id := nullif(race_item ->> 'winnerEntryId', '')::uuid;
      v_place_entry_id := nullif(race_item ->> 'placeEntryId', '')::uuid;

      perform app_private.validate_entry_for_fixture(v_winner_entry_id, fixture_row.id);
      perform app_private.validate_entry_for_fixture(v_place_entry_id, fixture_row.id);

      insert into public.race_tip_selections (
        tip_card_id,
        fixture_id,
        v_winner_entry_id,
        v_place_entry_id,
        comments
      )
      values (
        card_row.id,
        fixture_row.id,
        winner_entry_id,
        place_entry_id,
        nullif(btrim(coalesce(race_item ->> 'comments', '')), '')
      )
      on conflict (tip_card_id, fixture_id) do update
      set
        winner_entry_id = excluded.winner_entry_id,
        place_entry_id = excluded.place_entry_id,
        comments = excluded.comments;
    end if;
  end loop;

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiple_changes, '[]'::jsonb))
  loop
    select *
    into bet_option_row
    from public.meeting_bet_options
    where id = (multiple_item ->> 'betOptionId')::uuid
      and meeting_id = card_row.meeting_id;

    if bet_option_row.id is null then
      raise exception 'Meeting bet correction is invalid.';
    end if;

    if bet_option_row.cutoff_at <= now() then
      raise exception '% is locked because its betting cutoff has passed.', bet_option_row.display_name;
    end if;

    select id
    into v_multiple_id
    from public.tip_card_multiples
    where tip_card_id = card_row.id
      and bet_option_id = bet_option_row.id;

    if coalesce((multiple_item ->> 'remove')::boolean, false) then
      delete from public.tip_card_multiples
      where id = v_multiple_id;
      continue;
    end if;

    if v_multiple_id is null then
      insert into public.tip_card_multiples (
        tip_card_id,
        bet_option_id,
        custom_name,
        comments
      )
      values (
        card_row.id,
        bet_option_row.id,
        nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
        nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
      )
      returning id into v_multiple_id;
    else
      update public.tip_card_multiples
      set
        custom_name = nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
        comments = nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
      where id = v_multiple_id;

      delete from public.tip_card_multiple_selections s
      where s.multiple_id = v_multiple_id;
    end if;

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
          and starts_at > now()
      ) then
        raise exception 'Meeting bet contains a locked or invalid race.';
      end if;

      if bet_option_row.bet_type <> 'other' and not exists (
        select 1
        from public.meeting_bet_legs l
        where l.bet_option_id = bet_option_row.id
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

  if not exists (
    select 1
    from public.tip_card_multiples m
    where m.tip_card_id = card_row.id
      and app_private.multiple_is_complete(m.id)
  ) then
    raise exception 'A published card must retain at least one complete meeting bet.';
  end if;

  update public.tip_cards
  set revision = revision + 1
  where id = card_row.id
  returning * into card_row;

  insert into public.tip_card_revisions (
    tip_card_id,
    revision,
    revision_type,
    actor_id,
    summary,
    snapshot
  )
  values (
    card_row.id,
    card_row.revision,
    'correction',
    (select auth.uid()),
    btrim(p_revision_summary),
    app_private.tip_card_snapshot(card_row.id)
  );

  perform app_private.queue_tip_card_notifications(
    card_row.id,
    card_row.revision,
    'tip_card_corrected'
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    (select auth.uid()),
    'tip_card_corrected',
    'tip_card',
    card_row.id,
    jsonb_build_object(
      'revision', card_row.revision,
      'summary', btrim(p_revision_summary)
    )
  );

  return to_jsonb(card_row);
end;
$$;

;
