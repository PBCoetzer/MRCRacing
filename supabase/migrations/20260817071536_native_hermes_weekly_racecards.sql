create or replace function public.queue_hermes_weekly_calendar(
  p_created_by uuid,
  p_date_from date,
  p_date_to date,
  p_additional_guidance text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  task_row public.race_feed_tasks%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if p_date_from is null or p_date_to is null
    or p_date_to < p_date_from
    or p_date_to > p_date_from + 13
  then
    raise exception 'The Hermes calendar window must contain between one and fourteen days.';
  end if;

  source_id_value := app_private.ensure_hermes_local_source();

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    task_payload,
    due_at,
    created_by
  )
  values (
    source_id_value,
    'weekly-calendar:hermes:manual:' || gen_random_uuid()::text,
    'weekly_calendar',
    jsonb_build_object(
      'weekStart', p_date_from,
      'dateFrom', p_date_from,
      'dateTo', p_date_to,
      'lookaheadDays', (p_date_to - p_date_from) + 1,
      'countryCode', 'ZA',
      'provider', 'hermes',
      'delegate_to_hermes', true,
      'permitted_sources', jsonb_build_array('raceform.co.za'),
      'additionalInformation', nullif(btrim(coalesce(p_additional_guidance, '')), '')
    ),
    now(),
    p_created_by
  )
  returning * into task_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_created_by,
    'hermes_weekly_calendar_queued',
    'race_feed_task',
    task_row.id,
    jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to)
  );

  return to_jsonb(task_row);
end;
$$;

create or replace function public.prepare_hermes_race_task(
  p_task_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  task_row public.race_feed_tasks%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  source_id_value := app_private.ensure_hermes_local_source();

  update public.race_feed_tasks
  set source_id = source_id_value,
      updated_at = now()
  where id = p_task_id
    and run_id = p_run_id
    and state = 'running'
  returning * into task_row;

  if task_row.id is null then
    raise exception 'The running race-feed task was not found.';
  end if;

  update public.race_feed_runs
  set source_id = source_id_value,
      search_provider_name = 'hermes-native',
      extraction_provider_name = 'hermes-native',
      search_model_name = 'hermes-mrc-local',
      extraction_model_name = 'qwen3.5:9b'
  where id = p_run_id;

  return to_jsonb(task_row);
end;
$$;

create or replace function public.stage_hermes_weekly_calendar_result(
  p_task_id uuid,
  p_run_id uuid,
  p_meetings jsonb,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.race_feed_tasks%rowtype;
  meeting_item jsonb;
  venue_value text;
  meeting_date_value date;
  meeting_external_id_value text;
  meeting_key_value text;
  child_count integer := 0;
  fragment_hash text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if jsonb_typeof(p_meetings) <> 'array'
    or jsonb_array_length(p_meetings) < 1
    or jsonb_array_length(p_meetings) > 14
    or jsonb_typeof(p_evidence) <> 'array'
  then
    raise exception 'Hermes weekly results require one to fourteen meetings and an evidence array.';
  end if;

  select * into task_row
  from public.race_feed_tasks
  where id = p_task_id
    and run_id = p_run_id
    and task_type = 'weekly_calendar'
  for update;

  if task_row.id is null then
    raise exception 'The Hermes weekly source task was not found.';
  end if;

  fragment_hash := encode(
    extensions.digest(convert_to(p_meetings::text || '|' || p_evidence::text, 'UTF8'), 'sha256'),
    'hex'
  );

  update public.race_feed_fragments
  set is_current = false
  where task_id = task_row.id
    and fragment_type = 'weekly_calendar'
    and is_current;

  insert into public.race_feed_fragments (
    task_id,
    run_id,
    source_id,
    fragment_type,
    payload,
    evidence,
    content_hash,
    is_current
  )
  values (
    task_row.id,
    p_run_id,
    task_row.source_id,
    'weekly_calendar',
    jsonb_build_object('meetings', p_meetings),
    p_evidence,
    fragment_hash,
    true
  )
  on conflict (task_id, content_hash) do update
  set evidence = excluded.evidence,
      is_current = true;

  for meeting_item in select value from jsonb_array_elements(p_meetings)
  loop
    venue_value := nullif(btrim(meeting_item ->> 'venue'), '');
    meeting_date_value := nullif(meeting_item ->> 'meetingDate', '')::date;
    if venue_value is null or meeting_date_value is null then
      raise exception 'Every Hermes calendar meeting requires venue and meetingDate.';
    end if;
    meeting_key_value := lower(regexp_replace(venue_value, '[^a-zA-Z0-9]+', '-', 'g'))
      || ':' || meeting_date_value::text;
    meeting_external_id_value := coalesce(
      nullif(btrim(meeting_item ->> 'externalId'), ''),
      'za-' || split_part(meeting_key_value, ':', 1) || '-' || meeting_date_value::text
    );

    insert into public.race_feed_tasks (
      source_id,
      task_key,
      task_type,
      meeting_external_id,
      venue,
      meeting_date,
      task_payload,
      due_at,
      created_by
    )
    values (
      task_row.source_id,
      'meeting-schedule:hermes:' || meeting_key_value || ':' || task_row.id::text,
      'meeting_schedule',
      meeting_external_id_value,
      venue_value,
      meeting_date_value,
      jsonb_build_object(
        'venue', venue_value,
        'meetingDate', meeting_date_value,
        'meetingExternalId', meeting_external_id_value,
        'expectedRaceCount', meeting_item -> 'raceCount',
        'sourceUrl', meeting_item -> 'sourceUrl',
        'calendarEvidence', p_evidence,
        'provider', 'hermes',
        'delegate_to_hermes', true,
        'permitted_sources', jsonb_build_array('raceform.co.za'),
        'change_type', 'new_meeting'
      ),
      now(),
      task_row.created_by
    )
    on conflict (task_key) do nothing;

    if found then
      child_count := child_count + 1;
    end if;
  end loop;

  update public.race_feed_tasks
  set state = 'completed',
      locked_at = null,
      locked_by = null,
      last_error = null,
      last_completed_at = now(),
      updated_at = now()
  where id = task_row.id;

  update public.race_feed_runs
  set status = 'succeeded',
      completed_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from now() - started_at) * 1000))::integer,
      search_query_count = 1,
      evidence_count = jsonb_array_length(p_evidence),
      extracted_payload = jsonb_build_object('meetings', p_meetings),
      error_code = null,
      error_message = null
  where id = p_run_id;

  update public.race_feed_settings
  set last_weekly_discovery_at = now(),
      updated_at = now()
  where singleton = true;

  return jsonb_build_object(
    'status', 'staged',
    'meetingCount', jsonb_array_length(p_meetings),
    'childTaskCount', child_count
  );
end;
$$;

update public.race_source_domains
set direct_fetch_allowed = true,
    can_auto_approve = false,
    reuse_basis = 'Public Raceform pages may be fetched for evidence; publication remains approval-only until commercial reuse permission is documented.',
    updated_at = now()
where domain = 'raceform.co.za';

update public.race_feed_settings
set future_lookahead_days = 7,
    auto_approve_new_meetings = false,
    auto_approve_routine_changes = false,
    auto_approve_results = false,
    updated_at = now()
where singleton = true;

revoke all on function public.queue_hermes_weekly_calendar(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.queue_hermes_weekly_calendar(uuid, date, date, text)
  to service_role;

revoke all on function public.prepare_hermes_race_task(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_hermes_race_task(uuid, uuid)
  to service_role;

revoke all on function public.stage_hermes_weekly_calendar_result(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_hermes_weekly_calendar_result(uuid, uuid, jsonb, jsonb)
  to service_role;
