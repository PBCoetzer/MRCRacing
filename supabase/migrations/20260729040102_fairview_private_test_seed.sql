do $$
declare
  horse_racing_id uuid;
  v_meeting_id uuid;
  fixture_ids uuid[] := array[]::uuid[];
  option_id uuid;
  v_fixture_id uuid;
  test_date date := (now() at time zone 'Africa/Johannesburg')::date + 7;
  first_start timestamptz;
  race_offsets integer[] := array[0, 38, 76, 114, 154, 194, 234, 274];
  race_titles text[] := array[
    'Welcome To Fairview Maiden Plate',
    'Racing Today Open Maiden',
    'Eastern Cape Fillies Handicap',
    'Fairview Sprint',
    'Nelson Mandela Bay Middle Stakes',
    'Port Elizabeth Progress Plate',
    'Algoa Cup Trial',
    'Next Fairview Meeting Classified Stakes'
  ];
  race_distances integer[] := array[1000, 1200, 1400, 1200, 1600, 1800, 2000, 1400];
  race_classes text[] := array[
    'Maiden Plate',
    'Open Maiden',
    'Fillies Handicap',
    'Handicap',
    'Middle Stakes',
    'Progress Plate',
    'Cup Trial',
    'Classified Stakes'
  ];
  horse_prefixes text[] := array[
    'African',
    'Algoa',
    'Amber',
    'Atlantic',
    'Brave',
    'Cape',
    'Crimson',
    'Eastern',
    'Emerald',
    'Fairview',
    'Golden',
    'Karoo',
    'Midnight',
    'Royal',
    'Silver',
    'Windy'
  ];
  horse_suffixes text[] := array[
    'Arrow',
    'Belle',
    'Comet',
    'Crown',
    'Dancer',
    'Dream',
    'Echo',
    'Flame',
    'Fortune',
    'Harbour',
    'Legend',
    'Prince',
    'Promise',
    'Sovereign',
    'Spirit',
    'Voyage'
  ];
  jockey_names text[] := array[
    'L Mxothwa',
    'R Fourie',
    'C Maujean',
    'M Yeni',
    'S Khumalo',
    'D Schwarz',
    'C Zackey',
    'K Matsunyane',
    'Y Ramzan',
    'X Ndlovu',
    'M V''Rensburg',
    'K Minnie'
  ];
  trainer_names text[] := array[
    'A C Greeff',
    'G D Smith',
    'Z Oosthuizen',
    'S B Kotzen',
    'J P Nel',
    'E Kaknis',
    'T J Laing',
    'K Mitchley',
    'D A McKenzie',
    'WGC Miller'
  ];
  provisional_odds text[] := array[
    '22/10',
    '3/1',
    '7/2',
    '9/2',
    '5/1',
    '6/1',
    '8/1',
    '10/1',
    '14/1',
    '20/1'
  ];
  race_number integer;
  runner_number integer;
  horse_name text;
begin
  select id
  into horse_racing_id
  from public.sports
  where slug = 'horse-racing';

  if horse_racing_id is null then
    raise exception 'Horse Racing sport is required before loading Fairview test data.';
  end if;

  first_start := (
    test_date::text || ' 12:10 Africa/Johannesburg'
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
    'fairview-synthetic-private-v1',
    'Fairview',
    'ZA',
    test_date,
    first_start,
    first_start + make_interval(mins => race_offsets[8]),
    'scheduled',
    true,
    'MRC synthetic test data',
    null,
    now(),
    jsonb_build_object(
      'syntheticTestData', true,
      'privateTestMeeting', true,
      'verifiedOdds', false,
      'notice', 'Synthetic Fairview meeting for private workflow testing. Names, runners, times, and odds are fictional.'
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
    source_payload = excluded.source_payload,
    updated_at = now()
  returning id into v_meeting_id;

  for race_number in 1..8 loop
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
      result_summary,
      source_name,
      source_url,
      source_updated_at,
      source_payload
    )
    values (
      horse_racing_id,
      v_meeting_id,
      race_number,
      'fairview-synthetic-private-race-' || race_number::text,
      'South African Horse Racing',
      'Race ' || race_number::text || ' – ' || race_titles[race_number],
      'Fairview',
      first_start + make_interval(mins => race_offsets[race_number]),
      null,
      race_distances[race_number],
      race_classes[race_number],
      'scheduled',
      null,
      'MRC synthetic test data',
      null,
      now(),
      jsonb_build_object(
        'syntheticTestData', true,
        'privateTestMeeting', true,
        'verifiedOdds', false,
        'raceNumber', race_number
      )
    )
    on conflict (source_name, external_id) do update
    set
      meeting_id = excluded.meeting_id,
      race_number = excluded.race_number,
      title = excluded.title,
      starts_at = excluded.starts_at,
      distance_m = excluded.distance_m,
      race_class = excluded.race_class,
      status = 'scheduled',
      result_summary = null,
      source_updated_at = now(),
      source_payload = excluded.source_payload,
      updated_at = now()
    returning id into v_fixture_id;

    fixture_ids[race_number] := v_fixture_id;

    for runner_number in 1..10 loop
      horse_name :=
        horse_prefixes[((race_number * 3 + runner_number * 5 - 1) % 16) + 1]
        || ' '
        || horse_suffixes[((race_number * 7 + runner_number * 3 - 1) % 16) + 1];

      insert into public.race_entries (
        fixture_id,
        external_id,
        saddle_number,
        horse_name,
        jockey_name,
        trainer_name,
        draw,
        carried_weight,
        odds,
        status,
        result_position,
        source_payload
      )
      values (
        v_fixture_id,
        'fairview-synthetic-r'
          || race_number::text
          || '-runner-'
          || runner_number::text,
        runner_number,
        horse_name,
        jockey_names[((race_number + runner_number - 2) % 12) + 1],
        trainer_names[((race_number * 2 + runner_number - 2) % 10) + 1],
        ((runner_number * 3 + race_number - 2) % 10) + 1,
        52.0 + (((race_number + runner_number) % 15)::numeric / 2),
        provisional_odds[runner_number],
        'active',
        null,
        jsonb_build_object(
          'syntheticTestData', true,
          'privateTestMeeting', true,
          'provisionalOdds', true,
          'verifiedOdds', false
        )
      )
      on conflict (fixture_id, saddle_number) do update
      set
        external_id = excluded.external_id,
        horse_name = excluded.horse_name,
        jockey_name = excluded.jockey_name,
        trainer_name = excluded.trainer_name,
        draw = excluded.draw,
        carried_weight = excluded.carried_weight,
        odds = excluded.odds,
        status = 'active',
        result_position = null,
        source_payload = excluded.source_payload,
        updated_at = now();
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
    'fairview-synthetic-bipot',
    '{"syntheticTestData":true,"privateTestMeeting":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set
    cutoff_at = excluded.cutoff_at,
    leg_count = excluded.leg_count,
    source_payload = excluded.source_payload,
    updated_at = now()
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
    first_start + make_interval(mins => race_offsets[2] - 5),
    7,
    20,
    'fairview-synthetic-pa',
    '{"syntheticTestData":true,"privateTestMeeting":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set
    cutoff_at = excluded.cutoff_at,
    leg_count = excluded.leg_count,
    source_payload = excluded.source_payload,
    updated_at = now()
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 2..8 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 1, fixture_ids[race_number]);
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
    first_start + make_interval(mins => race_offsets[3] - 5),
    6,
    30,
    'fairview-synthetic-pick6',
    '{"syntheticTestData":true,"privateTestMeeting":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set
    cutoff_at = excluded.cutoff_at,
    leg_count = excluded.leg_count,
    source_payload = excluded.source_payload,
    updated_at = now()
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 3..8 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 2, fixture_ids[race_number]);
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
    first_start + make_interval(mins => race_offsets[2] - 5),
    4,
    40,
    'fairview-synthetic-jackpot-1',
    '{"syntheticTestData":true,"privateTestMeeting":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set
    cutoff_at = excluded.cutoff_at,
    leg_count = excluded.leg_count,
    source_payload = excluded.source_payload,
    updated_at = now()
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 2..5 loop
    insert into public.meeting_bet_legs (bet_option_id, leg_number, fixture_id)
    values (option_id, race_number - 1, fixture_ids[race_number]);
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
    first_start + make_interval(mins => race_offsets[5] - 5),
    4,
    50,
    'fairview-synthetic-jackpot-2',
    '{"syntheticTestData":true,"privateTestMeeting":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set
    cutoff_at = excluded.cutoff_at,
    leg_count = excluded.leg_count,
    source_payload = excluded.source_payload,
    updated_at = now()
  returning id into option_id;

  delete from public.meeting_bet_legs where bet_option_id = option_id;
  for race_number in 5..8 loop
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
    'other',
    'Other',
    first_start - interval '5 minutes',
    0,
    60,
    'fairview-synthetic-other',
    '{"syntheticTestData":true,"privateTestMeeting":true,"customLegsAllowed":true}'::jsonb
  )
  on conflict (meeting_id, display_name) do update
  set
    cutoff_at = excluded.cutoff_at,
    leg_count = excluded.leg_count,
    source_payload = excluded.source_payload,
    updated_at = now();
end;
$$;
;
