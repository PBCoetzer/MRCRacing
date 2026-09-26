create or replace function app_private.reconcile_postponed_race_meetings(
  target_run_id uuid,
  target_source_id uuid,
  target_snapshot jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_name_value text;
  meeting_item jsonb;
  incoming_external_id text;
  incoming_venue text;
  incoming_date date;
  incoming_status text;
  incoming_race_count integer;
  incoming_runner_count integer;
  incoming_first_race_at timestamptz;
  incoming_last_race_at timestamptz;
  candidate_count integer;
  candidate_id uuid;
  candidate_row public.race_meetings%rowtype;
  old_date_label text;
  new_date_label text;
  reconciled_count integer := 0;
begin
  select source_name
  into source_name_value
  from public.race_feed_sources
  where id = target_source_id;

  if source_name_value is null
    or jsonb_typeof(target_snapshot -> 'meetings') <> 'array'
  then
    return 0;
  end if;

  for meeting_item in
    select value from jsonb_array_elements(target_snapshot -> 'meetings')
  loop
    incoming_external_id := nullif(btrim(meeting_item ->> 'externalId'), '');
    incoming_venue := nullif(btrim(meeting_item ->> 'venue'), '');
    incoming_date := nullif(meeting_item ->> 'meetingDate', '')::date;
    incoming_status := lower(coalesce(nullif(meeting_item ->> 'status', ''), 'scheduled'));

    if incoming_external_id is null
      or incoming_venue is null
      or incoming_date is null
      or jsonb_typeof(meeting_item -> 'races') <> 'array'
      or incoming_status not in ('scheduled', 'in_progress', 'completed', 'cancelled')
      or exists (
        select 1
        from public.race_meetings meetings
        where meetings.source_name = source_name_value
          and meetings.external_id = incoming_external_id
      )
    then
      continue;
    end if;

    incoming_race_count := jsonb_array_length(meeting_item -> 'races');
    select count(*)::integer,
           min((race_value ->> 'startsAt')::timestamptz),
           max((race_value ->> 'startsAt')::timestamptz)
    into incoming_runner_count, incoming_first_race_at, incoming_last_race_at
    from jsonb_array_elements(meeting_item -> 'races') race_value
    cross join lateral jsonb_array_elements(
      coalesce(race_value -> 'runners', '[]'::jsonb)
    ) runner_value;

    if incoming_race_count < 1 or incoming_runner_count < 3 then
      continue;
    end if;

    with incoming_runners as (
      select
        (race_value ->> 'raceNumber')::integer as race_number,
        lower(regexp_replace(btrim(runner_value ->> 'horseName'), '\s+', ' ', 'g')) as horse_name
      from jsonb_array_elements(meeting_item -> 'races') race_value
      cross join lateral jsonb_array_elements(
        coalesce(race_value -> 'runners', '[]'::jsonb)
      ) runner_value
      where nullif(btrim(runner_value ->> 'horseName'), '') is not null
    ), candidate_scores as (
      select
        meetings.id,
        (
          select count(*)::integer
          from public.fixtures fixtures
          where fixtures.meeting_id = meetings.id
        ) as existing_race_count,
        (
          select count(*)::integer
          from public.fixtures fixtures
          join public.race_entries entries on entries.fixture_id = fixtures.id
          where fixtures.meeting_id = meetings.id
        ) as existing_runner_count,
        (
          select count(*)::integer
          from incoming_runners incoming
          join public.fixtures fixtures
            on fixtures.meeting_id = meetings.id
           and fixtures.race_number = incoming.race_number
          join public.race_entries entries
            on entries.fixture_id = fixtures.id
           and lower(regexp_replace(btrim(entries.horse_name), '\s+', ' ', 'g')) = incoming.horse_name
        ) as matched_runner_count
      from public.race_meetings meetings
      where meetings.source_name = source_name_value
        and lower(btrim(meetings.venue)) = lower(incoming_venue)
        and meetings.meeting_date between incoming_date - 7 and incoming_date - 1
        and not meetings.is_test
        and not exists (
          select 1
          from public.fixtures fixtures
          where fixtures.meeting_id = meetings.id
            and fixtures.result_summary is not null
        )
        and not exists (
          select 1
          from public.fixtures fixtures
          join public.race_entries entries on entries.fixture_id = fixtures.id
          where fixtures.meeting_id = meetings.id
            and entries.result_position is not null
        )
    ), eligible_candidates as (
      select id
      from candidate_scores
      where existing_race_count = incoming_race_count
        and matched_runner_count >= greatest(
          3,
          ceil(least(existing_runner_count, incoming_runner_count) * 0.80)::integer
        )
    )
    select count(*)::integer, min(id)
    into candidate_count, candidate_id
    from eligible_candidates;

    if candidate_count <> 1 or candidate_id is null then
      continue;
    end if;

    select *
    into candidate_row
    from public.race_meetings
    where id = candidate_id
    for update;

    old_date_label := to_char(candidate_row.meeting_date, 'FMDD FMMonth YYYY');
    new_date_label := to_char(incoming_date, 'FMDD FMMonth YYYY');

    update public.race_meetings
    set external_id = incoming_external_id,
        meeting_date = incoming_date,
        first_race_at = incoming_first_race_at,
        last_race_at = incoming_last_race_at,
        status = incoming_status::public.race_meeting_status,
        source_updated_at = now(),
        updated_at = now()
    where id = candidate_row.id;

    update public.tip_cards
    set title = replace(title, old_date_label, new_date_label),
        updated_at = now()
    where meeting_id = candidate_row.id
      and position(old_date_label in title) > 0;

    perform app_private.record_race_change(
      target_run_id,
      target_source_id,
      candidate_row.id,
      null,
      null,
      'meeting',
      'updated',
      array['externalId', 'meetingDate', 'firstRaceAt', 'lastRaceAt', 'status'],
      jsonb_build_object(
        'externalId', candidate_row.external_id,
        'meetingDate', candidate_row.meeting_date,
        'firstRaceAt', candidate_row.first_race_at,
        'lastRaceAt', candidate_row.last_race_at,
        'status', candidate_row.status
      ),
      jsonb_build_object(
        'externalId', incoming_external_id,
        'meetingDate', incoming_date,
        'firstRaceAt', incoming_first_race_at,
        'lastRaceAt', incoming_last_race_at,
        'status', incoming_status
      ),
      incoming_venue || ' was rescheduled from ' || candidate_row.meeting_date::text ||
        ' to ' || incoming_date::text || '.',
      now(),
      true
    );

    reconciled_count := reconciled_count + 1;
  end loop;

  return reconciled_count;
end;
$$;

revoke all on function app_private.reconcile_postponed_race_meetings(uuid, uuid, jsonb)
from public, anon, authenticated;

create or replace function app_private.apply_race_snapshot(
  target_run_id uuid,
  target_source_id uuid,
  target_snapshot jsonb,
  force_quarantined boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_snapshot jsonb;
  public_snapshot jsonb;
  meeting_item jsonb;
  apply_result jsonb;
  source_name_value text;
begin
  normalized_snapshot := app_private.normalize_mrc_race_snapshot_titles(target_snapshot, true);
  perform app_private.reconcile_postponed_race_meetings(
    target_run_id,
    target_source_id,
    normalized_snapshot
  );
  apply_result := app_private.apply_race_snapshot_source(
    target_run_id,
    target_source_id,
    normalized_snapshot,
    force_quarantined
  );

  if coalesce(apply_result ->> 'status', '') <> 'quarantined' then
    select source_name into source_name_value
    from public.race_feed_sources
    where id = target_source_id;

    public_snapshot := app_private.normalize_mrc_race_snapshot_titles(normalized_snapshot, false);
    for meeting_item in select value from jsonb_array_elements(public_snapshot -> 'meetings') loop
      update public.race_meetings
      set source_payload = meeting_item
      where source_name = source_name_value
        and external_id = meeting_item ->> 'externalId';
    end loop;
  end if;

  return apply_result;
end;
$$;

revoke all on function app_private.apply_race_snapshot(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;

create or replace function app_private.enqueue_hermes_race_job(p_job jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
  expired_row record;
  created_value boolean := false;
  correlation_value text := nullif(btrim(p_job ->> 'correlation_id'), '');
  source_task_value uuid := nullif(p_job ->> 'source_task_id', '')::uuid;
  deadline_value timestamptz := nullif(p_job ->> 'deadline', '')::timestamptz;
begin
  if correlation_value is null or length(correlation_value) > 160 then
    raise exception 'A correlation_id of 1 to 160 characters is required.';
  end if;

  if coalesce(p_job ->> 'task_type', '') not in (
    'weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh', 'manual_research'
  ) then
    raise exception 'Unsupported Hermes race task type.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(coalesce(source_task_value::text, correlation_value), 0)
  );

  for expired_row in
    update app_private.hermes_race_jobs
    set state = 'failed',
        error_code = 'deadline_expired',
        error_detail = 'The Hermes race job expired before a worker claimed it.',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where source_task_id = source_task_value
      and state = 'queued'
      and deadline is not null
      and deadline <= now()
    returning id
  loop
    insert into app_private.hermes_race_job_events (job_id, event_type, detail)
    values (
      expired_row.id,
      'failed',
      jsonb_build_object('error_code', 'deadline_expired')
    );
  end loop;

  if source_task_value is not null then
    select *
    into job_row
    from app_private.hermes_race_jobs
    where source_task_id = source_task_value
      and (
        state in ('queued', 'leased')
        or (state = 'returned' and handoff_status = 'pending')
      )
    order by created_at desc
    limit 1
    for update;

    if job_row.id is not null then
      update app_private.hermes_race_jobs
      set deadline = case
            when deadline_value is null then deadline
            when deadline is null then deadline_value
            else greatest(deadline, deadline_value)
          end,
          updated_at = now()
      where id = job_row.id
      returning * into job_row;

      return jsonb_build_object('created', false, 'job', to_jsonb(job_row));
    end if;
  end if;

  insert into app_private.hermes_race_jobs (
    correlation_id,
    schema_version,
    task_type,
    source_task_id,
    source_run_id,
    venue,
    meeting_date,
    race_number,
    required_fields,
    permitted_sources,
    task_payload,
    available_at,
    deadline
  )
  values (
    correlation_value,
    coalesce((p_job ->> 'schema_version')::integer, 1),
    p_job ->> 'task_type',
    source_task_value,
    nullif(p_job ->> 'source_run_id', '')::uuid,
    nullif(btrim(p_job ->> 'venue'), ''),
    nullif(p_job ->> 'meeting_date', '')::date,
    nullif(p_job ->> 'race_number', '')::integer,
    coalesce(p_job -> 'required_fields', '[]'::jsonb),
    coalesce(p_job -> 'permitted_sources', '[]'::jsonb),
    coalesce(p_job -> 'task_payload', '{}'::jsonb),
    coalesce(nullif(p_job ->> 'available_at', '')::timestamptz, now()),
    deadline_value
  )
  on conflict (correlation_id) do nothing
  returning * into job_row;

  if job_row.id is not null then
    created_value := true;
    insert into app_private.hermes_race_job_events (job_id, event_type, detail)
    values (job_row.id, 'queued', jsonb_build_object('correlation_id', correlation_value));
  else
    select * into job_row
    from app_private.hermes_race_jobs
    where correlation_id = correlation_value;
  end if;

  return jsonb_build_object('created', created_value, 'job', to_jsonb(job_row));
end;
$$;

create or replace function app_private.claim_hermes_race_job(p_worker_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
  expired_row record;
  worker_value text := nullif(btrim(p_worker_id), '');
begin
  if worker_value is null or length(worker_value) > 160 then
    raise exception 'A valid worker id is required.';
  end if;

  update app_private.hermes_race_jobs
  set state = case when attempt >= max_attempts then 'failed' else 'queued' end,
      available_at = case when attempt >= max_attempts then available_at else now() end,
      lease_owner = null,
      lease_expires_at = null,
      error_code = case when attempt >= max_attempts then 'lease_attempts_exhausted' else error_code end,
      error_detail = case when attempt >= max_attempts then 'The Hermes worker lease expired too many times.' else error_detail end,
      updated_at = now()
  where state = 'leased'
    and lease_expires_at <= now();

  for expired_row in
    update app_private.hermes_race_jobs
    set state = 'failed',
        error_code = 'deadline_expired',
        error_detail = 'The Hermes race job expired before a worker claimed it.',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where state = 'queued'
      and deadline is not null
      and deadline <= now()
    returning id
  loop
    insert into app_private.hermes_race_job_events (job_id, event_type, worker_id, detail)
    values (
      expired_row.id,
      'failed',
      worker_value,
      jsonb_build_object('error_code', 'deadline_expired')
    );
  end loop;

  select *
  into job_row
  from app_private.hermes_race_jobs
  where state = 'queued'
    and available_at <= now()
    and attempt < max_attempts
    and (deadline is null or deadline > now())
  order by
    case task_type
      when 'meeting_schedule' then 1
      when 'race_detail' then 2
      when 'weekly_calendar' then 3
      when 'result_refresh' then 4
      else 5
    end,
    available_at,
    created_at
  for update skip locked
  limit 1;

  if job_row.id is null then
    return null;
  end if;

  update app_private.hermes_race_jobs
  set state = 'leased',
      attempt = attempt + 1,
      lease_owner = worker_value,
      lease_expires_at = now() + interval '15 minutes',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = job_row.id
  returning * into job_row;

  insert into app_private.hermes_race_job_events (job_id, event_type, worker_id, detail)
  values (
    job_row.id,
    'claimed',
    worker_value,
    jsonb_build_object('attempt', job_row.attempt, 'lease_expires_at', job_row.lease_expires_at)
  );

  return to_jsonb(job_row)
    - 'result_payload'
    - 'result_sources'
    - 'result_warnings'
    - 'result_conflicts'
    - 'error_detail';
end;
$$;

create or replace function public.complete_race_feed_task_plan(
  p_task_id uuid,
  p_run_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_search_query_count integer default 0,
  p_evidence_count integer default 0,
  p_extracted_payload jsonb default null,
  p_next_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.race_feed_tasks%rowtype;
  normalized_status text;
  next_due_at_value timestamptz;
  next_state text;
  delegated_pending boolean := false;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  normalized_status := lower(coalesce(p_status, 'failed'));
  if normalized_status not in ('succeeded', 'failed', 'skipped', 'unchanged', 'pending_approval') then
    raise exception 'Unsupported task completion status.';
  end if;

  select *
  into task_row
  from public.race_feed_tasks
  where id = p_task_id
    and run_id = p_run_id
  for update;

  if task_row.id is null then
    raise exception 'Race-feed task lease was not found.';
  end if;

  delegated_pending := normalized_status = 'pending_approval'
    and coalesce(p_extracted_payload ->> 'delegatedTo', '') = 'hermes-race-bridge';

  if delegated_pending then
    next_due_at_value := coalesce(p_next_due_at, now() + interval '5 minutes');
  elsif task_row.task_type = 'result_refresh'
    and normalized_status in ('succeeded', 'unchanged', 'pending_approval')
  then
    if p_next_due_at is not null then
      next_due_at_value := p_next_due_at;
    elsif now() <= coalesce(
      (select last_race_at from public.race_meetings where id = task_row.meeting_id),
      now()
    ) + interval '4 hours' then
      next_due_at_value := now() + interval '5 minutes';
    elsif now() <= coalesce(
      (select last_race_at from public.race_meetings where id = task_row.meeting_id),
      now() - interval '8 days'
    ) + interval '72 hours' then
      next_due_at_value := now() + interval '6 hours';
    elsif now() <= coalesce(
      (select last_race_at from public.race_meetings where id = task_row.meeting_id),
      now() - interval '8 days'
    ) + interval '7 days' then
      next_due_at_value := now() + interval '1 day';
    end if;
  end if;

  if normalized_status = 'failed' then
    next_state := 'failed';
    next_due_at_value := coalesce(p_next_due_at, now() + interval '5 minutes');
  elsif next_due_at_value is not null then
    next_state := 'pending';
  else
    next_state := 'completed';
  end if;

  update public.race_feed_tasks
  set state = next_state,
      due_at = coalesce(next_due_at_value, due_at),
      locked_at = null,
      locked_by = null,
      last_error = case when normalized_status = 'failed' then left(coalesce(p_error_message, 'Race-feed task failed.'), 1000) else null end,
      last_completed_at = case when normalized_status <> 'failed' then now() else last_completed_at end
  where id = task_row.id;

  update public.race_feed_runs
  set status = normalized_status,
      completed_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from now() - started_at) * 1000))::integer,
      search_query_count = greatest(0, coalesce(p_search_query_count, 0)),
      evidence_count = greatest(0, coalesce(p_evidence_count, 0)),
      llm_called = coalesce(p_search_query_count, 0) > 0,
      extracted_payload = coalesce(p_extracted_payload, extracted_payload),
      error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
      error_message = nullif(left(coalesce(p_error_message, ''), 1000), '')
  where id = p_run_id
    and status <> 'succeeded';

  if task_row.task_type = 'weekly_calendar'
    and normalized_status in ('succeeded', 'unchanged', 'pending_approval')
    and not delegated_pending
  then
    update public.race_feed_settings
    set last_weekly_discovery_at = now()
    where singleton = true;
  end if;

  return jsonb_build_object(
    'taskId', task_row.id,
    'runId', p_run_id,
    'state', next_state,
    'nextDueAt', next_due_at_value
  );
end;
$$;

do $$
declare
  meeting_row public.race_meetings%rowtype;
  source_id_value uuid;
  run_id_value uuid;
  old_date_label text := '18 September 2026';
  new_date_label text := '20 September 2026';
begin
  select *
  into meeting_row
  from public.race_meetings
  where lower(btrim(venue)) = 'greyville'
    and meeting_date = date '2026-09-18'
    and not is_test
    and not exists (
      select 1
      from public.race_meetings replacement
      where lower(btrim(replacement.venue)) = 'greyville'
        and replacement.meeting_date = date '2026-09-20'
        and not replacement.is_test
    )
  order by created_at
  limit 1
  for update;

  if meeting_row.id is null then
    return;
  end if;

  select tasks.source_id, tasks.run_id
  into source_id_value, run_id_value
  from public.race_feed_tasks tasks
  where tasks.task_type = 'meeting_schedule'
    and lower(btrim(tasks.venue)) = 'greyville'
    and tasks.meeting_date = date '2026-09-20'
  order by tasks.created_at desc
  limit 1;

  update public.race_meetings
  set external_id = 'za-greyville-2026-09-20',
      meeting_date = date '2026-09-20',
      first_race_at = timestamptz '2026-09-20 11:07:00+00',
      last_race_at = timestamptz '2026-09-20 15:15:00+00',
      status = 'scheduled',
      source_url = 'https://www.racecoast.co.za/postponed-hollywoodbets-greyville-friday-18-september-2026-postponed-to-sunday-20-september-2026/',
      source_updated_at = now(),
      source_payload = jsonb_set(
        jsonb_set(
          jsonb_set(source_payload, '{externalId}', to_jsonb('za-greyville-2026-09-20'::text), true),
          '{meetingDate}', to_jsonb('2026-09-20'::text), true
        ),
        '{status}', to_jsonb('scheduled'::text), true
      ) || jsonb_build_object(
        'rescheduledFrom', '2026-09-18',
        'rescheduleEvidenceUrl', 'https://www.racecoast.co.za/postponed-hollywoodbets-greyville-friday-18-september-2026-postponed-to-sunday-20-september-2026/'
      ),
      updated_at = now()
  where id = meeting_row.id;

  with schedule(race_number, starts_at) as (
    values
      (1, timestamptz '2026-09-20 11:07:00+00'),
      (2, timestamptz '2026-09-20 11:45:00+00'),
      (3, timestamptz '2026-09-20 12:20:00+00'),
      (4, timestamptz '2026-09-20 12:55:00+00'),
      (5, timestamptz '2026-09-20 13:30:00+00'),
      (6, timestamptz '2026-09-20 14:05:00+00'),
      (7, timestamptz '2026-09-20 14:40:00+00'),
      (8, timestamptz '2026-09-20 15:15:00+00')
  )
  update public.fixtures fixtures
  set external_id = 'za-greyville-2026-09-20-r' || schedule.race_number,
      original_starts_at = coalesce(fixtures.original_starts_at, fixtures.starts_at),
      starts_at = schedule.starts_at,
      selection_lock_at = schedule.starts_at,
      status = 'scheduled',
      source_url = 'https://www.racingtv.com/racecourses/international/greyville/racecards',
      source_updated_at = now(),
      source_payload = jsonb_set(
        jsonb_set(
          jsonb_set(
            fixtures.source_payload,
            '{externalId}',
            to_jsonb('za-greyville-2026-09-20-r' || schedule.race_number),
            true
          ),
          '{startsAt}', to_jsonb(schedule.starts_at), true
        ),
        '{status}', to_jsonb('scheduled'::text), true
      ),
      updated_at = now()
  from schedule
  where fixtures.meeting_id = meeting_row.id
    and fixtures.race_number = schedule.race_number;

  update public.race_entries entries
  set external_id = replace(entries.external_id, '2026-09-18', '2026-09-20'),
      source_payload = case
        when jsonb_typeof(entries.source_payload) = 'object' then jsonb_set(
          entries.source_payload,
          '{externalId}',
          to_jsonb(replace(coalesce(entries.source_payload ->> 'externalId', entries.external_id), '2026-09-18', '2026-09-20')),
          true
        )
        else entries.source_payload
      end,
      source_updated_at = now(),
      updated_at = now()
  where entries.fixture_id in (
    select fixtures.id
    from public.fixtures fixtures
    where fixtures.meeting_id = meeting_row.id
  );

  update public.meeting_bet_options
  set cutoff_at = timestamptz '2026-09-20 11:07:00+00',
      updated_at = now()
  where meeting_id = meeting_row.id
    and source_payload ->> 'cutoffBasis' = 'meeting_first_race';

  update public.tip_cards
  set title = replace(title, old_date_label, new_date_label),
      updated_at = now()
  where meeting_id = meeting_row.id
    and position(old_date_label in title) > 0;

  update public.race_feed_tasks tasks
  set meeting_external_id = 'za-greyville-2026-09-20',
      meeting_date = date '2026-09-20',
      task_payload = jsonb_set(
        jsonb_set(
          coalesce(tasks.task_payload, '{}'::jsonb),
          '{meetingExternalId}', to_jsonb('za-greyville-2026-09-20'::text), true
        ),
        '{meetingDate}', to_jsonb('2026-09-20'::text), true
      ),
      due_at = case
        when tasks.state = 'pending' then coalesce((
          select fixtures.starts_at + interval '2 minutes'
          from public.fixtures fixtures
          where fixtures.id = tasks.fixture_id
             or fixtures.id = nullif(tasks.task_payload ->> 'fixtureId', '')::uuid
          order by fixtures.race_number
          limit 1
        ), timestamptz '2026-09-20 11:09:00+00')
        else tasks.due_at
      end,
      attempts = case when tasks.state = 'pending' then 0 else tasks.attempts end,
      last_error = case when tasks.state = 'pending' then null else tasks.last_error end,
      updated_at = now()
  where tasks.meeting_id = meeting_row.id;

  with stale_jobs as (
    update app_private.hermes_race_jobs jobs
    set state = 'failed',
        error_code = 'meeting_rescheduled',
        error_detail = 'The source meeting was rescheduled from 2026-09-18 to 2026-09-20.',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where jobs.task_type = 'result_refresh'
      and lower(btrim(jobs.venue)) = 'greyville'
      and jobs.meeting_date = date '2026-09-18'
      and jobs.state = 'queued'
    returning jobs.id
  )
  insert into app_private.hermes_race_job_events (job_id, event_type, detail)
  select id, 'failed', jsonb_build_object('error_code', 'meeting_rescheduled')
  from stale_jobs;

  update public.race_feed_tasks tasks
  set state = 'pending',
      due_at = now(),
      attempts = 0,
      last_error = null,
      updated_at = now()
  where tasks.task_type = 'meeting_schedule'
    and lower(btrim(tasks.venue)) = 'greyville'
    and tasks.meeting_date = date '2026-09-20';

  update app_private.hermes_race_jobs jobs
  set state = 'queued',
      available_at = now(),
      deadline = now() + interval '24 hours',
      error_code = null,
      error_detail = null,
      completed_at = null,
      updated_at = now()
  where jobs.source_task_id in (
    select tasks.id
    from public.race_feed_tasks tasks
    where tasks.task_type = 'meeting_schedule'
      and lower(btrim(tasks.venue)) = 'greyville'
      and tasks.meeting_date = date '2026-09-20'
  )
    and jobs.state in ('queued', 'failed');

  if source_id_value is not null and run_id_value is not null then
    perform app_private.record_race_change(
      run_id_value,
      source_id_value,
      meeting_row.id,
      null,
      null,
      'meeting',
      'updated',
      array['externalId', 'meetingDate', 'firstRaceAt', 'lastRaceAt', 'status'],
      jsonb_build_object(
        'externalId', meeting_row.external_id,
        'meetingDate', meeting_row.meeting_date,
        'firstRaceAt', meeting_row.first_race_at,
        'lastRaceAt', meeting_row.last_race_at,
        'status', meeting_row.status
      ),
      jsonb_build_object(
        'externalId', 'za-greyville-2026-09-20',
        'meetingDate', '2026-09-20',
        'firstRaceAt', '2026-09-20T11:07:00Z',
        'lastRaceAt', '2026-09-20T15:15:00Z',
        'status', 'scheduled'
      ),
      'Greyville was postponed from 2026-09-18 to 2026-09-20 and moved to the Polytrack.',
      now(),
      true
    );
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    'race_meeting_rescheduled_from_verified_source',
    'race_meeting',
    meeting_row.id,
    jsonb_build_object(
      'fromDate', '2026-09-18',
      'toDate', '2026-09-20',
      'venue', 'Greyville',
      'evidenceUrl', 'https://www.racecoast.co.za/postponed-hollywoodbets-greyville-friday-18-september-2026-postponed-to-sunday-20-september-2026/',
      'preservedTipCards', true
    )
  );
end;
$$;

comment on function app_private.reconcile_postponed_race_meetings(uuid, uuid, jsonb) is
  'Reuses an existing unresolved meeting when a nearby same-venue card has an 80 percent runner match, preserving tip cards, purchases, and entitlements across postponements.';
