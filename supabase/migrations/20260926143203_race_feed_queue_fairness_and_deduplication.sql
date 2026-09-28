-- Prevent recurring comparison work from starving the rolling calendar import.

create or replace function public.claim_race_feed_task_plan(
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
  weekly_start date;
  queries_today integer;
  run_trigger text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('mrc-race-feed-task-claim')) then
    return null;
  end if;

  source_id_value := app_private.ensure_gemini_race_feed_source();

  select *
  into settings_row
  from public.race_feed_settings
  where singleton = true;

  weekly_start := date_trunc('week', now() at time zone 'Africa/Johannesburg')::date;

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    task_payload,
    due_at
  )
  values (
    source_id_value,
    'weekly-calendar:' || weekly_start::text,
    'weekly_calendar',
    jsonb_build_object(
      'weekStart', weekly_start,
      'lookaheadDays', settings_row.future_lookahead_days,
      'countryCode', 'ZA'
    ),
    coalesce(settings_row.last_weekly_discovery_at + interval '7 days', now())
  )
  on conflict (task_key) do nothing;

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    meeting_id,
    meeting_external_id,
    venue,
    meeting_date,
    task_payload,
    due_at
  )
  select
    source_id_value,
    'result-refresh:' || meeting.id::text,
    'result_refresh',
    meeting.id,
    meeting.external_id,
    meeting.venue,
    meeting.meeting_date,
    jsonb_build_object(
      'meetingId', meeting.id,
      'meetingExternalId', meeting.external_id,
      'venue', meeting.venue,
      'meetingDate', meeting.meeting_date
    ),
    greatest(meeting.first_race_at, now())
  from public.race_meetings meeting
  where not meeting.is_test
    and meeting.first_race_at <= now()
    and coalesce(meeting.last_race_at, meeting.first_race_at) >= now() - interval '7 days'
    and exists (
      select 1
      from public.tip_cards card
      where card.meeting_id = meeting.id
        and card.status <> 'void'::public.tip_card_status
    )
  on conflict (task_key) do nothing;

  update public.race_feed_tasks
  set state = 'failed',
      locked_at = null,
      locked_by = null,
      last_error = 'Worker lease expired before completion.'
  where state = 'running'
    and locked_at < now() - interval '3 minutes';

  select coalesce(sum(search_query_count), 0)::integer
  into queries_today
  from public.race_feed_runs
  where started_at >= date_trunc('day', now() at time zone 'Africa/Johannesburg')
    at time zone 'Africa/Johannesburg';

  select *
  into task_row
  from public.race_feed_tasks
  where state in ('pending', 'failed')
    and due_at <= now()
    and attempts < max_attempts
    and (
      queries_today < settings_row.daily_search_limit
      or coalesce((task_payload ->> 'delegate_to_hermes')::boolean, false)
    )
  order by
    case
      when task_type = 'manual_research' then 0
      when task_type = 'weekly_calendar' and due_at <= now() - interval '15 minutes' then 1
      when task_type = 'race_detail' then 2
      when task_type = 'meeting_schedule' then 3
      when task_type = 'result_refresh' then 4
      when task_type = 'weekly_calendar' then 5
      else 6
    end,
    due_at,
    created_at
  for update skip locked
  limit 1;

  if task_row.id is null then
    if queries_today >= settings_row.daily_search_limit
      and exists (
        select 1
        from public.race_feed_tasks
        where state in ('pending', 'failed')
          and due_at <= now()
          and attempts < max_attempts
          and not coalesce((task_payload ->> 'delegate_to_hermes')::boolean, false)
      )
    then
      return jsonb_build_object(
        'status', 'search_limit_reached',
        'queriesToday', queries_today,
        'dailySearchLimit', settings_row.daily_search_limit
      );
    end if;

    return null;
  end if;

  run_trigger := case
    when task_row.task_type = 'manual_research' then 'manual'
    when lower(coalesce(p_trigger, 'cron')) = 'retry' then 'retry'
    else 'cron'
  end;

  insert into public.race_feed_runs (
    source_id,
    trigger_type,
    status,
    task_count,
    search_model_name,
    extraction_model_name
  )
  values (
    source_id_value,
    run_trigger,
    'running',
    1,
    'gemini-2.5-flash',
    'gemini-3.6-flash'
  )
  returning * into run_row;

  update public.race_feed_tasks
  set state = 'running',
      run_id = run_row.id,
      locked_at = now(),
      locked_by = left(coalesce(nullif(btrim(p_worker_id), ''), 'edge-worker'), 200),
      attempts = attempts + 1,
      last_error = null
  where id = task_row.id
  returning * into task_row;

  return jsonb_build_object(
    'status', 'claimed',
    'task', to_jsonb(task_row),
    'run', to_jsonb(run_row),
    'settings', to_jsonb(settings_row),
    'queriesToday', queries_today
  );
end;
$$;

revoke all on function public.claim_race_feed_task_plan(text, text)
from public, anon, authenticated;

grant execute on function public.claim_race_feed_task_plan(text, text)
to service_role;

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
    case
      when task_type = 'manual_research' then 0
      when task_type = 'result_refresh' then 1
      when task_type = 'weekly_calendar' and available_at <= now() - interval '15 minutes' then 2
      when task_type = 'meeting_schedule' then 3
      when task_type = 'race_detail' then 4
      when task_type = 'weekly_calendar' then 5
      else 6
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

create or replace function app_private.queue_secondary_race_comparisons()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  target record;
  queued_count integer := 0;
begin
  if (now() at time zone 'Africa/Johannesburg')::time < time '05:00'
    or (now() at time zone 'Africa/Johannesburg')::time > time '21:00'
  then
    return 0;
  end if;

  source_id_value := app_private.ensure_hermes_local_source();
  for target in
    select meetings.id, meetings.venue, meetings.meeting_date
    from public.race_meetings meetings
    where meetings.meeting_date = (now() at time zone 'Africa/Johannesburg')::date
      and not meetings.is_test
      and meetings.status in ('scheduled', 'in_progress')
      and meetings.last_race_at >= now() - interval '30 minutes'
  loop
    insert into public.race_feed_tasks (
      source_id, task_key, task_type, meeting_id, venue, meeting_date,
      task_payload, due_at, max_attempts
    ) values (
      source_id_value,
      'secondary-comparison:' || target.id::text || ':raceform.co.za',
      'meeting_schedule',
      target.id,
      target.venue,
      target.meeting_date,
      jsonb_build_object(
        'provider', 'hermes',
        'delegate_to_hermes', true,
        'comparison_only', true,
        'primary_source', 'formgrids.info',
        'comparison_source', 'raceform.co.za',
        'permitted_sources', jsonb_build_array('raceform.co.za')
      ),
      now(),
      4
    )
    on conflict (task_key) do update
    set source_id = excluded.source_id,
        meeting_id = excluded.meeting_id,
        venue = excluded.venue,
        meeting_date = excluded.meeting_date,
        task_payload = excluded.task_payload,
        due_at = excluded.due_at,
        max_attempts = excluded.max_attempts,
        state = 'pending',
        attempts = 0,
        run_id = null,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = now()
    where public.race_feed_tasks.state in ('completed', 'failed', 'cancelled')
      and not exists (
        select 1
        from public.race_feed_proposals proposals
        where proposals.source_task_id = public.race_feed_tasks.id
          and proposals.status in ('pending', 'quarantined')
      );

    if found then
      queued_count := queued_count + 1;
    end if;
  end loop;

  return queued_count;
end;
$$;

revoke all on function app_private.queue_secondary_race_comparisons()
from public, anon, authenticated, service_role;

-- Retire duplicate comparison jobs created with the old ten-minute bucket key.
update app_private.hermes_race_jobs jobs
set state = 'failed',
    error_code = 'superseded_duplicate',
    error_detail = 'Superseded by the deduplicated secondary-comparison scheduler.',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
from public.race_feed_tasks tasks
where jobs.source_task_id = tasks.id
  and jobs.state = 'queued'
  and tasks.task_key like 'secondary-comparison:%:raceform.co.za:%';

update public.race_feed_tasks tasks
set state = 'cancelled',
    locked_at = null,
    locked_by = null,
    last_error = 'Superseded by the deduplicated secondary-comparison scheduler.',
    updated_at = now()
where tasks.state in ('pending', 'failed')
  and tasks.task_key like 'secondary-comparison:%:raceform.co.za:%'
  and not exists (
    select 1
    from app_private.hermes_race_jobs jobs
    where jobs.source_task_id = tasks.id
      and (
        jobs.state = 'leased'
        or (jobs.state = 'returned' and jobs.handoff_status = 'pending')
      )
  );

-- Keep only the newest pending rolling-calendar task and make it immediately fair.
with ranked_weekly as (
  select id, row_number() over (order by created_at desc, id desc) as task_rank
  from public.race_feed_tasks
  where task_type = 'weekly_calendar'
    and state in ('pending', 'failed')
), stale_weekly as (
  select id from ranked_weekly where task_rank > 1
)
update app_private.hermes_race_jobs jobs
set state = 'failed',
    error_code = 'superseded_calendar_discovery',
    error_detail = 'Superseded by the newest rolling seven-day calendar discovery.',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where jobs.state = 'queued'
  and jobs.source_task_id in (select id from stale_weekly);

with ranked_weekly as (
  select id, row_number() over (order by created_at desc, id desc) as task_rank
  from public.race_feed_tasks
  where task_type = 'weekly_calendar'
    and state in ('pending', 'failed')
)
update public.race_feed_tasks tasks
set state = 'cancelled',
    locked_at = null,
    locked_by = null,
    last_error = 'Superseded by the newest rolling seven-day calendar discovery.',
    updated_at = now()
where tasks.id in (select id from ranked_weekly where task_rank > 1)
  and not exists (
    select 1
    from app_private.hermes_race_jobs jobs
    where jobs.source_task_id = tasks.id
      and (
        jobs.state = 'leased'
        or (jobs.state = 'returned' and jobs.handoff_status = 'pending')
      )
  );

with newest_weekly as (
  select id
  from public.race_feed_tasks
  where task_type = 'weekly_calendar'
    and state in ('pending', 'failed')
  order by created_at desc, id desc
  limit 1
)
update public.race_feed_tasks tasks
set state = 'pending',
    due_at = now() - interval '16 minutes',
    attempts = least(tasks.attempts, tasks.max_attempts - 1),
    locked_at = null,
    locked_by = null,
    last_error = null,
    updated_at = now()
where tasks.id in (select id from newest_weekly);

select app_private.queue_secondary_race_comparisons();

comment on function public.claim_race_feed_task_plan(text, text) is
  'Claims race-feed work with age-based fairness so rolling calendar discovery cannot be starved by recurring fixture work.';

comment on function app_private.claim_hermes_race_job(text) is
  'Claims Hermes race jobs with result priority and age-based fairness for rolling calendar discovery.';

comment on function app_private.queue_secondary_race_comparisons() is
  'Maintains at most one outstanding Raceform comparison task per live meeting instead of creating a new task every ten minutes.';

