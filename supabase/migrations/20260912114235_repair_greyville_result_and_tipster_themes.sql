alter table public.tipsters
  add column if not exists theme_primary_color text not null default '#FFB000',
  add column if not exists theme_secondary_color text not null default '#00D4E8',
  add column if not exists theme_surface_color text not null default '#351657';

alter table public.tipsters
  drop constraint if exists tipsters_theme_primary_color_check,
  drop constraint if exists tipsters_theme_secondary_color_check,
  drop constraint if exists tipsters_theme_surface_color_check;

alter table public.tipsters
  add constraint tipsters_theme_primary_color_check
    check (theme_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint tipsters_theme_secondary_color_check
    check (theme_secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint tipsters_theme_surface_color_check
    check (theme_surface_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.tipsters.theme_primary_color is
  'Primary client-facing accent for this tipster profile and meeting cards.';
comment on column public.tipsters.theme_secondary_color is
  'Secondary client-facing accent for this tipster profile and meeting cards.';
comment on column public.tipsters.theme_surface_color is
  'Dark client-facing surface for this tipster profile and meeting cards.';

create or replace function public.update_my_tipster_theme(
  p_primary_color text,
  p_secondary_color text,
  p_surface_color text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  tipster_before public.tipsters%rowtype;
  tipster_after public.tipsters%rowtype;
  primary_color text := upper(btrim(coalesce(p_primary_color, '')));
  secondary_color text := upper(btrim(coalesce(p_secondary_color, '')));
  surface_color text := upper(btrim(coalesce(p_surface_color, '')));
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if primary_color !~ '^#[0-9A-F]{6}$'
    or secondary_color !~ '^#[0-9A-F]{6}$'
    or surface_color !~ '^#[0-9A-F]{6}$'
  then
    raise exception 'Theme colors must be six-digit hexadecimal colors.';
  end if;

  select *
  into tipster_before
  from public.tipsters
  where user_id = current_user_id
  for update;

  if tipster_before.id is null then
    raise exception 'A tipster profile is required.';
  end if;

  update public.tipsters
  set
    theme_primary_color = primary_color,
    theme_secondary_color = secondary_color,
    theme_surface_color = surface_color,
    updated_at = now()
  where id = tipster_before.id
  returning * into tipster_after;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'tipster_theme_updated',
    'tipster',
    tipster_after.id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'primary', tipster_before.theme_primary_color,
        'secondary', tipster_before.theme_secondary_color,
        'surface', tipster_before.theme_surface_color
      ),
      'after', jsonb_build_object(
        'primary', tipster_after.theme_primary_color,
        'secondary', tipster_after.theme_secondary_color,
        'surface', tipster_after.theme_surface_color
      )
    )
  );

  return jsonb_build_object(
    'tipsterId', tipster_after.id,
    'primaryColor', tipster_after.theme_primary_color,
    'secondaryColor', tipster_after.theme_secondary_color,
    'surfaceColor', tipster_after.theme_surface_color,
    'updatedAt', tipster_after.updated_at
  );
end;
$$;

revoke all on function public.update_my_tipster_theme(text, text, text)
from public, anon, authenticated;
grant execute on function public.update_my_tipster_theme(text, text, text)
to authenticated;

comment on function public.update_my_tipster_theme(text, text, text) is
  'Lets an authenticated tipster update only their own validated client-facing color theme and records the change in the immutable audit log.';

create or replace function public.get_public_tipster_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', tipsters.id,
    'slug', tipsters.slug,
    'displayName', tipsters.display_name,
    'biography', tipsters.biography,
    'photoPath', tipsters.photo_path,
    'ranking', tipsters.ranking,
    'themePrimaryColor', tipsters.theme_primary_color,
    'themeSecondaryColor', tipsters.theme_secondary_color,
    'themeSurfaceColor', tipsters.theme_surface_color,
    'winnerStrikeRate', stats.winner_strike_rate,
    'settledWinnerTips', coalesce(stats.settled_winner_tips, 0),
    'winnerHits', coalesce(stats.winner_hits, 0),
    'placeStrikeRate', stats.place_strike_rate,
    'settledPlaceTips', coalesce(stats.settled_place_tips, 0),
    'placeHits', coalesce(stats.place_hits, 0),
    'statsUpdatedAt', stats.updated_at,
    'updatedAt', tipsters.updated_at
  )
  from public.tipsters tipsters
  left join public.tipster_performance_stats stats
    on stats.tipster_id = tipsters.id
  where tipsters.is_verified
    and tipsters.is_public
    and tipsters.slug = btrim(p_slug)
  limit 1;
$$;

create or replace function public.claim_race_feed_result_task_plan(
  p_worker_id text,
  p_trigger text default 'cron'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  settings_row public.race_feed_settings%rowtype;
  task_row public.race_feed_tasks%rowtype;
  run_row public.race_feed_runs%rowtype;
  run_trigger text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('mrc-race-feed-task-claim')) then
    return null;
  end if;

  source_id_value := app_private.ensure_hermes_local_source();

  select *
  into settings_row
  from public.race_feed_settings
  where singleton = true;

  update public.race_feed_tasks
  set
    state = 'cancelled',
    locked_at = null,
    locked_by = null,
    last_error = 'Replaced by per-fixture result polling.',
    updated_at = now()
  where task_type = 'result_refresh'
    and fixture_id is null
    and state in ('pending', 'failed');

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    meeting_id,
    fixture_id,
    meeting_external_id,
    venue,
    meeting_date,
    race_number,
    task_payload,
    due_at,
    max_attempts
  )
  select
    source_id_value,
    'result-refresh:' || fixtures.id::text,
    'result_refresh',
    meetings.id,
    fixtures.id,
    meetings.external_id,
    meetings.venue,
    meetings.meeting_date,
    fixtures.race_number,
    jsonb_build_object(
      'meetingId', meetings.id,
      'fixtureId', fixtures.id,
      'meetingExternalId', meetings.external_id,
      'venue', meetings.venue,
      'meetingDate', meetings.meeting_date,
      'raceNumber', fixtures.race_number,
      'provider', 'hermes',
      'delegate_to_hermes', true,
      'permitted_sources', jsonb_build_array('formgrids.info', 'raceform.co.za')
    ),
    greatest(fixtures.starts_at + interval '10 minutes', now()),
    192
  from public.fixtures fixtures
  join public.race_meetings meetings on meetings.id = fixtures.meeting_id
  where not meetings.is_test
    and fixtures.starts_at <= now()
    and fixtures.status not in ('cancelled', 'abandoned')
    and not exists (
      select 1
      from public.race_entries entries
      where entries.fixture_id = fixtures.id
        and entries.result_position = 1
    )
    and coalesce(meetings.last_race_at, fixtures.starts_at) >= now() - interval '7 days'
    and exists (
      select 1
      from public.tip_cards cards
      where cards.meeting_id = meetings.id
        and cards.status <> 'void'::public.tip_card_status
    )
  on conflict (task_key) do update
  set
    source_id = excluded.source_id,
    meeting_id = excluded.meeting_id,
    fixture_id = excluded.fixture_id,
    meeting_external_id = excluded.meeting_external_id,
    venue = excluded.venue,
    meeting_date = excluded.meeting_date,
    race_number = excluded.race_number,
    task_payload = excluded.task_payload,
    max_attempts = 192,
    state = case
      when public.race_feed_tasks.state = 'running' then 'running'
      when public.race_feed_tasks.attempts >= 192 then 'failed'
      when exists (
        select 1
        from public.race_feed_proposals proposals
        where proposals.source_task_id = public.race_feed_tasks.id
          and proposals.status in ('pending', 'quarantined')
      ) then public.race_feed_tasks.state
      else 'pending'
    end,
    due_at = case
      when public.race_feed_tasks.last_completed_at is null
        then greatest(excluded.due_at, now())
      when now() <= coalesce((
        select meetings.last_race_at + interval '2 hours'
        from public.race_meetings meetings
        where meetings.id = excluded.meeting_id
      ), now())
        then greatest(excluded.due_at, public.race_feed_tasks.last_completed_at + interval '10 minutes')
      else greatest(excluded.due_at, public.race_feed_tasks.last_completed_at + interval '1 hour')
    end,
    locked_at = case
      when public.race_feed_tasks.state = 'running' then public.race_feed_tasks.locked_at
      else null
    end,
    locked_by = case
      when public.race_feed_tasks.state = 'running' then public.race_feed_tasks.locked_by
      else null
    end,
    last_error = case
      when public.race_feed_tasks.attempts >= 192 then public.race_feed_tasks.last_error
      else null
    end,
    updated_at = now()
  where not exists (
    select 1
    from public.race_feed_proposals proposals
    where proposals.source_task_id = public.race_feed_tasks.id
      and proposals.status in ('pending', 'quarantined')
  );

  update public.race_feed_tasks
  set
    source_id = source_id_value,
    updated_at = now()
  where task_type = 'result_refresh'
    and fixture_id is not null
    and state in ('pending', 'failed')
    and source_id <> source_id_value;

  update public.race_feed_tasks
  set
    state = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = 'Worker lease expired before completion.',
    updated_at = now()
  where task_type = 'result_refresh'
    and state = 'running'
    and locked_at < now() - interval '3 minutes';

  update public.race_feed_tasks tasks
  set
    state = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = 'No validated official result was available within seven days.',
    updated_at = now()
  from public.race_meetings meetings
  where meetings.id = tasks.meeting_id
    and tasks.task_type = 'result_refresh'
    and tasks.fixture_id is not null
    and coalesce(meetings.last_race_at, meetings.first_race_at) < now() - interval '7 days'
    and tasks.state not in ('completed', 'cancelled');

  select *
  into task_row
  from public.race_feed_tasks
  where task_type = 'result_refresh'
    and fixture_id is not null
    and state in ('pending', 'failed')
    and due_at <= now()
    and attempts < max_attempts
  order by due_at, created_at
  for update skip locked
  limit 1;

  if task_row.id is null then
    return null;
  end if;

  run_trigger := case
    when lower(coalesce(p_trigger, 'cron')) = 'retry' then 'retry'
    when lower(coalesce(p_trigger, 'cron')) = 'manual' then 'manual'
    else 'cron'
  end;

  insert into public.race_feed_runs (
    source_id,
    trigger_type,
    status,
    task_count,
    search_provider_name,
    extraction_provider_name,
    search_model_name,
    extraction_model_name
  )
  values (
    source_id_value,
    run_trigger,
    'running',
    1,
    'hermes-local',
    'hermes-local',
    'qwen3.5:9b',
    'qwen3.5:9b'
  )
  returning * into run_row;

  update public.race_feed_tasks
  set
    source_id = source_id_value,
    state = 'running',
    run_id = run_row.id,
    locked_at = now(),
    locked_by = left(coalesce(nullif(btrim(p_worker_id), ''), 'edge-worker'), 200),
    attempts = attempts + 1,
    last_error = null,
    updated_at = now()
  where id = task_row.id
  returning * into task_row;

  return jsonb_build_object(
    'status', 'claimed',
    'task', to_jsonb(task_row),
    'run', to_jsonb(run_row),
    'settings', to_jsonb(settings_row),
    'queriesToday', 0
  );
end;
$$;

revoke all on function public.claim_race_feed_result_task_plan(text, text)
from public, anon, authenticated;
grant execute on function public.claim_race_feed_result_task_plan(text, text)
to service_role;

comment on function public.claim_race_feed_result_task_plan(text, text) is
  'Claims official-result work before search-limited discovery, and continuously requeues missing winners for seven days even after a race has been marked complete.';

do $$
declare
  target_fixture public.fixtures%rowtype;
  target_fixture_count integer;
  updated_entry_count integer;
  gj_count integer;
  settled_card_count integer;
begin
  select count(*)
  into target_fixture_count
  from public.fixtures fixtures
  join public.race_meetings meetings on meetings.id = fixtures.meeting_id
  where lower(btrim(meetings.venue)) = 'greyville'
    and meetings.meeting_date = date '2026-09-11'
    and fixtures.race_number = 7;

  if target_fixture_count <> 1 then
    raise exception 'Expected exactly one Greyville 11 September 2026 Race 7 fixture; found %.', target_fixture_count;
  end if;

  select fixtures.*
  into target_fixture
  from public.fixtures fixtures
  join public.race_meetings meetings on meetings.id = fixtures.meeting_id
  where lower(btrim(meetings.venue)) = 'greyville'
    and meetings.meeting_date = date '2026-09-11'
    and fixtures.race_number = 7;

  if (
    select count(*)
    from public.race_entries entries
    where entries.fixture_id = target_fixture.id
      and (entries.saddle_number, upper(btrim(entries.horse_name))) in (
        (1, 'FINE WINE'),
        (2, 'STAR OF THE FUTURE'),
        (3, 'NO PRESSURE'),
        (4, 'GARDENER''S PRIDE'),
        (5, 'TAKETHEGREENLIGHT'),
        (6, 'PRINCE OF TROY'),
        (7, 'RED CARDINAL'),
        (8, 'BLIZZARDBOY'),
        (9, 'TEE DOG'),
        (10, 'DAY TWO'),
        (11, 'HIGH QUEUE')
      )
  ) <> 11 then
    raise exception 'Greyville Race 7 entries no longer match the independently verified field.';
  end if;

  update public.race_entries
  set
    result_position = case saddle_number
      when 3 then 1
      when 7 then 2
      when 6 then 3
      when 10 then 4
      when 8 then 5
      when 2 then 6
      when 4 then 7
      when 5 then 8
      when 1 then 9
      when 11 then 10
      else null
    end,
    status = case when saddle_number = 9 then 'withdrawn' else 'active' end,
    source_payload = coalesce(source_payload, '{}'::jsonb) || jsonb_build_object(
      'resultRepair', jsonb_build_object(
        'source', 'Sporting Life',
        'sourceUrl', 'https://www.sportinglife.com/racing/results/2026-09-11/greyville/938324/lucky-fish-power-pick-c-stakes',
        'verifiedAt', now()
      )
    ),
    updated_at = now()
  where fixture_id = target_fixture.id;
  get diagnostics updated_entry_count = row_count;

  if updated_entry_count <> 11 then
    raise exception 'Expected to update 11 Greyville Race 7 entries; updated %.', updated_entry_count;
  end if;

  update public.fixtures
  set
    status = 'completed',
    result_summary = 'NO PRESSURE won in 122.62s.',
    source_name = 'Sporting Life',
    source_url = 'https://www.sportinglife.com/racing/results/2026-09-11/greyville/938324/lucky-fish-power-pick-c-stakes',
    source_updated_at = now(),
    source_payload = coalesce(source_payload, '{}'::jsonb) || jsonb_build_object(
      'resultRepair', jsonb_build_object(
        'source', 'Sporting Life',
        'sourceUrl', 'https://www.sportinglife.com/racing/results/2026-09-11/greyville/938324/lucky-fish-power-pick-c-stakes',
        'winningTimeSeconds', 122.62,
        'verifiedAt', now()
      )
    ),
    updated_at = now()
  where id = target_fixture.id;

  update public.race_feed_tasks
  set
    state = 'completed',
    locked_at = null,
    locked_by = null,
    last_error = null,
    last_completed_at = now(),
    updated_at = now()
  where fixture_id = target_fixture.id
    and task_type = 'result_refresh';

  insert into public.audit_logs (
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'greyville_result_repaired',
    'fixture',
    target_fixture.id,
    jsonb_build_object(
      'venue', 'Greyville',
      'meetingDate', '2026-09-11',
      'raceNumber', 7,
      'winner', 'NO PRESSURE',
      'winningTimeSeconds', 122.62,
      'nonRunner', 'TEE DOG',
      'sourceUrl', 'https://www.sportinglife.com/racing/results/2026-09-11/greyville/938324/lucky-fish-power-pick-c-stakes'
    )
  );

  settled_card_count := app_private.settle_completed_tip_cards();

  select count(*)
  into gj_count
  from public.tipsters
  where upper(btrim(display_name)) = 'GJ'
    and is_verified = true;

  if gj_count <> 1 then
    raise exception 'Expected exactly one verified GJ tipster profile; found %.', gj_count;
  end if;

  update public.tipsters
  set
    theme_primary_color = '#41B8F4',
    theme_secondary_color = '#B9ECFF',
    theme_surface_color = '#08263F',
    updated_at = now()
  where upper(btrim(display_name)) = 'GJ'
    and is_verified = true;

  insert into public.audit_logs (
    action,
    entity_type,
    entity_id,
    metadata
  )
  select
    'tipster_theme_seeded',
    'tipster',
    tipsters.id,
    jsonb_build_object(
      'displayName', tipsters.display_name,
      'primary', tipsters.theme_primary_color,
      'secondary', tipsters.theme_secondary_color,
      'surface', tipsters.theme_surface_color,
      'settledCardsAfterResultRepair', settled_card_count
    )
  from public.tipsters tipsters
  where upper(btrim(tipsters.display_name)) = 'GJ'
    and tipsters.is_verified = true;
end;
$$;
