alter table public.race_feed_runs
  add column if not exists search_provider_name text,
  add column if not exists extraction_provider_name text,
  add column if not exists search_fetch_count integer not null default 0 check (search_fetch_count >= 0),
  add column if not exists extraction_request_count integer not null default 0 check (extraction_request_count >= 0),
  add column if not exists provider_input_tokens integer not null default 0 check (provider_input_tokens >= 0),
  add column if not exists provider_output_tokens integer not null default 0 check (provider_output_tokens >= 0);

comment on column public.race_feed_runs.search_provider_name is
  'Server-side web research provider used for this run.';
comment on column public.race_feed_runs.extraction_provider_name is
  'Server-side structured extraction provider used for this run.';
comment on column public.race_feed_runs.search_fetch_count is
  'Number of provider page-fetch requests performed during this run.';
comment on column public.race_feed_runs.extraction_request_count is
  'Number of structured extraction requests performed during this run.';
comment on column public.race_feed_runs.provider_input_tokens is
  'Provider-reported structured extraction input tokens.';
comment on column public.race_feed_runs.provider_output_tokens is
  'Provider-reported structured extraction output tokens.';

alter table public.race_feed_settings
  alter column daily_search_limit set default 25;

update public.race_feed_settings
set
  daily_search_limit = 25,
  auto_approve_new_meetings = false,
  auto_approve_routine_changes = false,
  auto_approve_results = false
where singleton = true;

update public.race_feed_sources
set is_enabled = false
where lower(name) = 'gemini grounded search';

create or replace function app_private.ensure_race_feed_provider_source()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
begin
  insert into public.race_feed_sources (
    name,
    source_name,
    source_url,
    extraction_hint,
    is_enabled
  )
  values (
    'Ollama web search',
    'Ollama Web Search',
    'https://docs.ollama.com/capabilities/web-search',
    'South African horse-racing calendar, meeting, runner and official-result evidence.',
    true
  )
  on conflict (name) do update
  set
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    extraction_hint = excluded.extraction_hint,
    is_enabled = true
  returning id into source_id_value;

  return source_id_value;
end;
$$;

create or replace function app_private.ensure_gemini_race_feed_source()
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app_private.ensure_race_feed_provider_source();
$$;

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
  provider_tasks_today integer;
  run_trigger text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('mrc-race-feed-task-claim')) then
    return null;
  end if;

  source_id_value := app_private.ensure_race_feed_provider_source();

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
  set
    state = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = 'Worker lease expired before completion.'
  where state = 'running'
    and locked_at < now() - interval '3 minutes';

  select coalesce(sum(greatest(search_query_count, extraction_request_count)), 0)::integer
  into provider_tasks_today
  from public.race_feed_runs
  where started_at >= date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';

  if provider_tasks_today >= settings_row.daily_search_limit then
    return jsonb_build_object(
      'status', 'search_limit_reached',
      'queriesToday', provider_tasks_today,
      'dailySearchLimit', settings_row.daily_search_limit
    );
  end if;

  select *
  into task_row
  from public.race_feed_tasks
  where state in ('pending', 'failed')
    and due_at <= now()
    and attempts < max_attempts
  order by
    case task_type
      when 'manual_research' then 0
      when 'result_refresh' then 1
      when 'race_detail' then 2
      when 'meeting_schedule' then 3
      else 4
    end,
    due_at,
    created_at
  for update skip locked
  limit 1;

  if task_row.id is null then
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
    'ollama',
    'groq',
    'ollama-web-search',
    'openai/gpt-oss-20b'
  )
  returning * into run_row;

  update public.race_feed_tasks
  set
    state = 'running',
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
    'queriesToday', provider_tasks_today
  );
end;
$$;

revoke all on function app_private.ensure_race_feed_provider_source() from public, anon, authenticated;
revoke all on function app_private.ensure_gemini_race_feed_source() from public, anon, authenticated;
revoke all on function public.claim_race_feed_task_plan(text, text) from public, anon, authenticated;
grant execute on function public.claim_race_feed_task_plan(text, text) to service_role;

select app_private.ensure_race_feed_provider_source();

;
