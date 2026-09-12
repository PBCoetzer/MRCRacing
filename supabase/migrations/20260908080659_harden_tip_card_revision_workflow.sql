create or replace function public.revise_tip_card_v2(
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
  current_user_id uuid := (select auth.uid());
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  fixture_row public.fixtures%rowtype;
  bet_option_row public.meeting_bet_options%rowtype;
  race_item jsonb;
  multiple_item jsonb;
  leg_item jsonb;
  entry_value jsonb;
  target_status text;
  winner_entry_id_value uuid;
  place_entry_id_value uuid;
  comments_value text;
  multiple_id_value uuid;
  tip_text_value text;
  leg_number_value integer;
  leg_fixture_id_value uuid;
begin
  if current_user_id is null or current_tipster_id is null
    or not app_private.current_user_account_active() then
    raise exception 'An active Tipster account is required.';
  end if;

  if char_length(btrim(coalesce(p_revision_summary, ''))) < 5 then
    raise exception 'Describe the correction in at least five characters.';
  end if;

  if jsonb_typeof(coalesce(p_race_changes, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_multiple_changes, '[]'::jsonb)) <> 'array' then
    raise exception 'Correction changes must be supplied as lists.';
  end if;

  if jsonb_array_length(coalesce(p_race_changes, '[]'::jsonb)) > 100
    or jsonb_array_length(coalesce(p_multiple_changes, '[]'::jsonb)) > 50
    or octet_length(coalesce(p_race_changes, '[]'::jsonb)::text) > 1048576
    or octet_length(coalesce(p_multiple_changes, '[]'::jsonb)::text) > 1048576 then
    raise exception 'The correction payload is too large.';
  end if;

  if jsonb_array_length(coalesce(p_race_changes, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(p_multiple_changes, '[]'::jsonb)) = 0 then
    raise exception 'Make at least one tip change before publishing a correction.';
  end if;

  select * into card_row
  from public.tip_cards
  where id = p_card_id
  for update;

  if card_row.id is null or card_row.tipster_id <> current_tipster_id then
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
    select * into fixture_row
    from public.fixtures
    where id = nullif(race_item ->> 'fixtureId', '')::uuid
      and meeting_id = card_row.meeting_id;

    if fixture_row.id is null then
      raise exception 'Race correction is not part of this meeting.';
    end if;

    if fixture_row.selection_lock_at <= now() then
      raise exception 'Race % is locked because its selection cutoff has passed.', fixture_row.race_number;
    end if;

    if coalesce((race_item ->> 'remove')::boolean, false) then
      delete from public.race_tip_selections
      where tip_card_id = card_row.id
        and fixture_id = fixture_row.id;
      continue;
    end if;

    target_status := coalesce(nullif(race_item ->> 'selectionStatus', ''), 'tipped');
    if target_status not in ('tipped', 'skipped') then
      raise exception 'Race tip status is invalid.';
    end if;

    winner_entry_id_value := nullif(race_item ->> 'winnerEntryId', '')::uuid;
    place_entry_id_value := nullif(race_item ->> 'placeEntryId', '')::uuid;
    comments_value := nullif(btrim(coalesce(race_item ->> 'comments', '')), '');

    if target_status = 'skipped' then
      if winner_entry_id_value is not null or place_entry_id_value is not null then
        raise exception 'A skipped race cannot include horse selections.';
      end if;
      winner_entry_id_value := null;
      place_entry_id_value := null;
    elsif winner_entry_id_value is null
      and place_entry_id_value is null
      and comments_value is null then
      raise exception 'Race % needs a selection, a comment, or must be marked skipped.', fixture_row.race_number;
    end if;

    perform app_private.validate_entry_for_fixture(winner_entry_id_value, fixture_row.id);
    perform app_private.validate_entry_for_fixture(place_entry_id_value, fixture_row.id);

    insert into public.race_tip_selections (
      tip_card_id,
      fixture_id,
      winner_entry_id,
      place_entry_id,
      comments,
      selection_status
    ) values (
      card_row.id,
      fixture_row.id,
      winner_entry_id_value,
      place_entry_id_value,
      comments_value,
      target_status
    )
    on conflict (tip_card_id, fixture_id) do update
    set
      winner_entry_id = excluded.winner_entry_id,
      place_entry_id = excluded.place_entry_id,
      comments = excluded.comments,
      selection_status = excluded.selection_status,
      updated_at = now();
  end loop;

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiple_changes, '[]'::jsonb))
  loop
    select * into bet_option_row
    from public.meeting_bet_options
    where id = nullif(multiple_item ->> 'betOptionId', '')::uuid
      and meeting_id = card_row.meeting_id;

    if bet_option_row.id is null then
      raise exception 'Meeting option correction is invalid.';
    end if;

    if bet_option_row.cutoff_at <= now() then
      raise exception '% is locked because its cutoff has passed.', bet_option_row.display_name;
    end if;

    select id into multiple_id_value
    from public.tip_card_multiples
    where tip_card_id = card_row.id
      and bet_option_id = bet_option_row.id;

    if coalesce((multiple_item ->> 'remove')::boolean, false) then
      delete from public.tip_card_multiples
      where id = multiple_id_value;
      continue;
    end if;

    tip_text_value := nullif(btrim(coalesce(multiple_item ->> 'tipText', '')), '');

    if multiple_id_value is null then
      insert into public.tip_card_multiples (
        tip_card_id,
        bet_option_id,
        custom_name,
        tip_text,
        comments
      ) values (
        card_row.id,
        bet_option_row.id,
        nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
        tip_text_value,
        nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
      )
      returning id into multiple_id_value;
    else
      update public.tip_card_multiples
      set
        custom_name = nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
        tip_text = tip_text_value,
        comments = nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
      where id = multiple_id_value;

      delete from public.tip_card_multiple_selections
      where multiple_id = multiple_id_value;
    end if;

    if tip_text_value is not null then
      continue;
    end if;

    for leg_item in
      select value
      from jsonb_array_elements(coalesce(multiple_item -> 'legs', '[]'::jsonb))
    loop
      leg_number_value := (leg_item ->> 'legNumber')::integer;
      leg_fixture_id_value := (leg_item ->> 'fixtureId')::uuid;

      if not exists (
        select 1
        from public.fixtures fixture
        where fixture.id = leg_fixture_id_value
          and fixture.meeting_id = card_row.meeting_id
          and fixture.selection_lock_at > now()
      ) then
        raise exception 'Meeting option contains a locked or invalid race.';
      end if;

      if bet_option_row.bet_type <> 'other' and not exists (
        select 1
        from public.meeting_bet_legs leg
        where leg.bet_option_id = bet_option_row.id
          and leg.leg_number = leg_number_value
          and leg.fixture_id = leg_fixture_id_value
      ) then
        raise exception 'Meeting option leg does not match the official leg mapping.';
      end if;

      for entry_value in
        select value
        from jsonb_array_elements(coalesce(leg_item -> 'entryIds', '[]'::jsonb))
      loop
        perform app_private.validate_entry_for_fixture(
          trim(both '"' from entry_value::text)::uuid,
          leg_fixture_id_value
        );

        insert into public.tip_card_multiple_selections (
          multiple_id,
          leg_number,
          fixture_id,
          entry_id
        ) values (
          multiple_id_value,
          leg_number_value,
          leg_fixture_id_value,
          trim(both '"' from entry_value::text)::uuid
        )
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  if not exists (
    select 1
    from public.tip_card_multiples multiple
    where multiple.tip_card_id = card_row.id
      and app_private.multiple_is_complete(multiple.id)
  ) then
    raise exception 'A published card must retain at least one complete meeting option.';
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
  ) values (
    card_row.id,
    card_row.revision,
    'correction',
    current_user_id,
    btrim(p_revision_summary),
    app_private.tip_card_snapshot(card_row.id)
  );

  perform app_private.queue_tip_card_notifications(
    card_row.id,
    card_row.revision,
    'tip_card_corrected'
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id,
    'tip_card_corrected',
    'tip_card',
    card_row.id,
    jsonb_build_object(
      'revision', card_row.revision,
      'summary', btrim(p_revision_summary),
      'raceChangeCount', jsonb_array_length(coalesce(p_race_changes, '[]'::jsonb)),
      'multipleChangeCount', jsonb_array_length(coalesce(p_multiple_changes, '[]'::jsonb))
    )
  );

  return to_jsonb(card_row);
end;
$$;

revoke all on function public.revise_tip_card_v2(uuid, integer, text, jsonb, jsonb)
from public, anon;
grant execute on function public.revise_tip_card_v2(uuid, integer, text, jsonb, jsonb)
to authenticated;

revoke all on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb)
from public, anon, authenticated;

create or replace function public.report_tip_card_revision_failure(
  p_card_id uuid,
  p_expected_revision integer,
  p_error_message text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  audit_id uuid;
begin
  if current_user_id is null or current_tipster_id is null
    or not app_private.current_user_account_active() then
    raise exception 'An active Tipster account is required.';
  end if;

  select * into card_row
  from public.tip_cards
  where id = p_card_id
    and tipster_id = current_tipster_id;

  if card_row.id is null then
    raise exception 'Tip card not found.';
  end if;

  if nullif(btrim(coalesce(p_error_message, '')), '') is null
    or char_length(p_error_message) > 1000
    or p_context is null
    or jsonb_typeof(p_context) <> 'object'
    or octet_length(p_context::text) > 4096 then
    raise exception 'Invalid revision failure report.';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id,
    'tip_card_revision_failed',
    'tip_card',
    card_row.id,
    jsonb_build_object(
      'error', btrim(p_error_message),
      'expectedRevision', p_expected_revision,
      'currentRevision', card_row.revision,
      'context', p_context
    )
  )
  returning id into audit_id;

  return jsonb_build_object('recorded', true, 'auditId', audit_id);
end;
$$;

revoke all on function public.report_tip_card_revision_failure(uuid, integer, text, jsonb)
from public, anon;
grant execute on function public.report_tip_card_revision_failure(uuid, integer, text, jsonb)
to authenticated;

comment on function public.revise_tip_card_v2(uuid, integer, text, jsonb, jsonb) is
  'Applies ownership-checked, cutoff-aware published card corrections and records an immutable revision.';
comment on function public.report_tip_card_revision_failure(uuid, integer, text, jsonb) is
  'Records a sanitized client-reported revision failure for the owning Tipster and administrators.';
