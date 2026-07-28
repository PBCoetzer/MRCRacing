do $$
declare
  horse_racing_id uuid;
  v_meeting_id uuid;
  fixture_ids uuid[] := array[]::uuid[];
  option_id uuid;
  v_fixture_id uuid;
  test_date date := (now() at time zone 'Africa/Johannesburg')::date + 3;
  first_start timestamptz;
  race_offsets integer[] := array[0, 40, 90, 140, 180, 220, 260, 300, 340, 380];
  original_times text[] := array[
    '2026-07-26 12:15 Africa/Johannesburg',
    '2026-07-26 12:55 Africa/Johannesburg',
    '2026-07-26 13:45 Africa/Johannesburg',
    '2026-07-26 14:35 Africa/Johannesburg',
    '2026-07-26 15:15 Africa/Johannesburg',
    '2026-07-26 15:55 Africa/Johannesburg',
    '2026-07-26 16:35 Africa/Johannesburg',
    '2026-07-26 17:15 Africa/Johannesburg',
    '2026-07-26 17:55 Africa/Johannesburg',
    '2026-07-26 18:35 Africa/Johannesburg'
  ];
  race_titles text[] := array[
    'Tote Stakes (Listed)',
    'World Pool With Race Coast Gr2 Debutante (Fillies)',
    'Greyville Test Race 3',
    'Greyville Test Race 4',
    'Greyville Test Race 5',
    'Greyville Test Race 6',
    'Greyville Test Race 7',
    'Greyville Test Race 8',
    'Greyville Test Race 9',
    'Greyville Test Race 10'
  ];
  race_distances integer[] := array[1600, 1200, 1200, 1600, 1600, 1200, 3200, 1800, 2000, 1000];
  race_number integer;
  runner_number integer;
begin
  select id
  into horse_racing_id
  from public.sports
  where slug = 'horse-racing';

  if horse_racing_id is null then
    raise exception 'Horse Racing sport is required before loading test data.';
  end if;

  first_start := (
    test_date::text || ' 12:15 Africa/Johannesburg'
  )::timestamptz;

  insert into public.race_meetings (
    sport_id,
    external_id,
    venue,
    country_code,
    meeting_date,
    first_race_at,
    last_race_at,
    status,
    is_test,
    source_name,
    source_url,
    source_updated_at,
    source_payload
  )
  values (
    horse_racing_id,
    'greyville-2026-07-26-private-test-clone',
    'Greyville',
    'ZA',
    test_date,
    first_start,
    first_start + make_interval(mins => race_offsets[10]),
    'scheduled',
    true,
    'Raceform test clone',
    'https://raceform.co.za/races/136738/racecard',
    now(),
    jsonb_build_object(
      'originalMeetingDate', '2026-07-26',
      'testClone', true,
      'notice', 'Historical Raceform reference data with synthetic future times for private testing.'
    )
  )
  on conflict (source_name, external_id) do update
  set
    meeting_date = excluded.meeting_date,
    first_race_at = excluded.first_race_at,
    last_race_at = excluded.last_race_at,
    status = 'scheduled',
    is_test = true,
    source_updated_at = now(),
    source_payload = excluded.source_payload
  returning id into v_meeting_id;

  for race_number in 1..10 loop
    insert into public.fixtures (
      sport_id,
      meeting_id,
      race_number,
      external_id,
      league,
      title,
      venue,
      starts_at,
      original_starts_at,
      distance_m,
      race_class,
      status,
      source_name,
      source_url,
      source_updated_at,
      source_payload
    )
    values (
      horse_racing_id,
      v_meeting_id,
      race_number,
      'greyville-private-test-race-' || race_number::text,
      'South African Horse Racing',
      'Race ' || race_number::text || ' – ' || race_titles[race_number],
      'Greyville',
      first_start + make_interval(mins => race_offsets[race_number]),
      original_times[race_number]::timestamptz,
      race_distances[race_number],
      case
        when race_number = 1 then 'Listed'
        when race_number = 2 then 'Grade 2'
        else 'Test'
      end,
      'scheduled',
      'Raceform test clone',
      'https://raceform.co.za/races/' || (136737 + race_number)::text || '/racecard',
      now(),
      jsonb_build_object(
        'raceformRaceId', 136737 + race_number,
        'originalMeetingDate', '2026-07-26',
        'testClone', true
      )
    )
    on conflict (source_name, external_id) do update
    set
      meeting_id = excluded.meeting_id,
      race_number = excluded.race_number,
      title = excluded.title,
      starts_at = excluded.starts_at,
      original_starts_at = excluded.original_starts_at,
      distance_m = excluded.distance_m,
      status = 'scheduled',
      source_updated_at = now(),
      source_payload = excluded.source_payload
    returning id into v_fixture_id;

    fixture_ids[race_number] := v_fixture_id;
  end loop;

  insert into public.race_entries (
    fixture_id,
    external_id,
    saddle_number,
    horse_name,
    jockey_name,
    draw,
    carried_weight,
    odds,
    result_position,
    source_payload
  )
  values
    (fixture_ids[1], 'raceform-216685', 1, 'Talk To The Master', 'G Lerena', 1, 59.5, '3/1', 5, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-test-captain-west', 2, 'Captain West', 'C Murray', 2, 56.0, '40/1', 6, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-216128', 3, 'Field Marshal', 'R Fourie', 3, 60.0, '16/1', 4, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-218959', 4, 'Better Man', 'K de Melo', 4, 54.5, '28/10', 7, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-218412', 5, 'Green Gateway', 'C Zackey', 5, 58.5, '10/1', 11, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-216138', 6, 'Major Master', 'A Mgudlwa', 6, 57.0, '25/1', 2, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-216971', 7, 'Care Forgot', 'L Hewitson', 7, 56.0, '25/1', 12, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-216462', 8, 'Isivivane', 'S Veale', 8, 59.0, '7/1', 10, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-218576', 9, 'Golden Operator', 'K Matsunyane', 9, 53.5, '100/1', 14, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-217153', 10, 'Landoftherisingsun', 'M Yeni', 10, 54.5, '20/1', 7, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-216988', 11, 'Go Grayson Go', 'C Habib', 11, 54.0, '50/1', 3, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-217893', 12, 'JP''s Palace', 'R A Venniker', 12, 54.5, '14/1', 9, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-216302', 13, 'Zeitz', 'S Moodley', 13, 60.0, '17/2', 1, '{"testClone":true}'::jsonb),
    (fixture_ids[1], 'raceform-219644', 14, 'Pay The Palace', 'T Godden', 14, 55.5, '50/1', 13, '{"testClone":true}'::jsonb)
  on conflict (fixture_id, saddle_number) do update
  set
    horse_name = excluded.horse_name,
    jockey_name = excluded.jockey_name,
    draw = excluded.draw,
    carried_weight = excluded.carried_weight,
    odds = excluded.odds,
    result_position = excluded.result_position,
    source_payload = excluded.source_payload;

  for race_number in 2..10 loop
    for runner_number in 1..10 loop
      insert into public.race_entries (
        fixture_id,
        external_id,
        saddle_number,
        horse_name,
        jockey_name,
        draw,
        carried_weight,
        odds,
        source_payload
      )
      values (
        fixture_ids[race_number],
        'greyville-private-test-' || race_number::text || '-' || runner_number::text,
        runner_number,
        'Test Runner ' || race_number::text || '-' || runner_number::text,
        'Test Jockey ' || runner_number::text,
        runner_number,
        52.0 + runner_number::numeric / 2,
        (runner_number + 1)::text || '/1',
        jsonb_build_object(
          'testClone', true,
          'syntheticRunner', true,
          'originalRaceformRaceId', 136737 + race_number
        )
      )
      on conflict (fixture_id, saddle_number) do update
      set
        horse_name = excluded.horse_name,
        jockey_name = excluded.jockey_name,
        draw = excluded.draw,
        carried_weight = excluded.carried_weight,
        odds = excluded.odds,
        source_payload = excluded.source_payload;
    end loop;
  end loop;

  insert into public.meeting_bet_options (
    meeting_id,
    bet_type,
    display_name,
    cutoff_at,
    leg_count,
    sort_order,
    external_id,
    source_payload
  )
  values (
    v_meeting_id,
    'bipot',
    'Bipot',
    first_start - interval '5 minutes',
    6,
    10,
    'greyville-private-test-bipot',
    '{"testClone":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set cutoff_at = excluded.cutoff_at, leg_count = excluded.leg_count
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 1..6 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number, fixture_ids[race_number]);
  end loop;

  insert into public.meeting_bet_options (
    meeting_id,
    bet_type,
    display_name,
    cutoff_at,
    leg_count,
    sort_order,
    external_id,
    source_payload
  )
  values (
    v_meeting_id,
    'pa',
    'PA',
    first_start + make_interval(mins => race_offsets[4] - 5),
    7,
    20,
    'greyville-private-test-pa',
    '{"testClone":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set cutoff_at = excluded.cutoff_at, leg_count = excluded.leg_count
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 4..10 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 3, fixture_ids[race_number]);
  end loop;

  insert into public.meeting_bet_options (
    meeting_id,
    bet_type,
    display_name,
    cutoff_at,
    leg_count,
    sort_order,
    external_id,
    source_payload
  )
  values (
    v_meeting_id,
    'pick6',
    'Pick 6',
    first_start + make_interval(mins => race_offsets[5] - 5),
    6,
    30,
    'greyville-private-test-pick6',
    '{"testClone":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set cutoff_at = excluded.cutoff_at, leg_count = excluded.leg_count
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 5..10 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 4, fixture_ids[race_number]);
  end loop;

  insert into public.meeting_bet_options (
    meeting_id,
    bet_type,
    display_name,
    cutoff_at,
    leg_count,
    sort_order,
    external_id,
    source_payload
  )
  values (
    v_meeting_id,
    'jackpot',
    'Jackpot 1',
    first_start + make_interval(mins => race_offsets[4] - 5),
    4,
    40,
    'greyville-private-test-jackpot-1',
    '{"testClone":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set cutoff_at = excluded.cutoff_at, leg_count = excluded.leg_count
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 4..7 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 3, fixture_ids[race_number]);
  end loop;

  insert into public.meeting_bet_options (
    meeting_id,
    bet_type,
    display_name,
    cutoff_at,
    leg_count,
    sort_order,
    external_id,
    source_payload
  )
  values (
    v_meeting_id,
    'jackpot',
    'Jackpot 2',
    first_start + make_interval(mins => race_offsets[7] - 5),
    4,
    50,
    'greyville-private-test-jackpot-2',
    '{"testClone":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set cutoff_at = excluded.cutoff_at, leg_count = excluded.leg_count
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 7..10 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 6, fixture_ids[race_number]);
  end loop;

  insert into public.meeting_bet_options (
    meeting_id,
    bet_type,
    display_name,
    cutoff_at,
    leg_count,
    sort_order,
    external_id,
    source_payload
  )
  values (
    v_meeting_id,
    'other',
    'Other',
    first_start - interval '5 minutes',
    0,
    60,
    'greyville-private-test-other',
    '{"testClone":true,"customLegsAllowed":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set cutoff_at = excluded.cutoff_at, leg_count = excluded.leg_count;
end;
$$;
