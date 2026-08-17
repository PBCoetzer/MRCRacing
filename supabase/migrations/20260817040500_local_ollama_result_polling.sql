create or replace function app_private.ensure_hermes_local_source()
returns uuid
language plpgsql
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
    'Hermes local Ollama',
    'hermes_local_ollama',
    'https://ollama.com/library/qwen3.5',
    'Native Hermes worker using local qwen3.5 with cited public evidence.',
    true
  )
  on conflict (name) do update
  set
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    extraction_hint = excluded.extraction_hint,
    is_enabled = true,
    updated_at = now()
  returning id into source_id_value;

  return source_id_value;
end;
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
    source_id = source_id_value,
    updated_at = now()
  where task_type = 'result_refresh'
    and state in ('pending', 'failed')
    and source_id <> source_id_value;

  update public.race_feed_tasks
  set
    state = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = 'Worker lease expired before completion.'
  where task_type = 'result_refresh'
    and state = 'running'
    and locked_at < now() - interval '3 minutes';

  select *
  into task_row
  from public.race_feed_tasks
  where task_type = 'result_refresh'
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
    last_error = null
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

revoke all on function app_private.ensure_hermes_local_source() from public, anon, authenticated;
revoke all on function public.claim_race_feed_result_task_plan(text, text) from public, anon, authenticated;
grant execute on function public.claim_race_feed_result_task_plan(text, text) to service_role;

select app_private.ensure_hermes_local_source();
