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
  venue_slug_value text;
  expected_race_count integer;
  incoming_first_race_time time;
  existing_meeting_id uuid;
  existing_first_race_at timestamptz;
  existing_race_count integer;
  latest_schedule_attempt_at timestamptz;
  metadata_changed boolean;
  should_queue boolean;
  child_count integer := 0;
  skipped_count integer := 0;
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

    venue_slug_value := lower(regexp_replace(venue_value, '[^a-zA-Z0-9]+', '-', 'g'));
    meeting_key_value := venue_slug_value || ':' || meeting_date_value::text;
    meeting_external_id_value := coalesce(
      nullif(btrim(meeting_item ->> 'externalId'), ''),
      'za-' || venue_slug_value || '-' || meeting_date_value::text
    );
    expected_race_count := nullif(meeting_item ->> 'raceCount', '')::integer;
    incoming_first_race_time := nullif(meeting_item ->> 'firstRaceTime', '')::time;

    existing_meeting_id := null;
    existing_first_race_at := null;
    existing_race_count := null;

    select meetings.id, meetings.first_race_at, count(fixtures.id)::integer
    into existing_meeting_id, existing_first_race_at, existing_race_count
    from public.race_meetings meetings
    left join public.fixtures fixtures on fixtures.meeting_id = meetings.id
    where not meetings.is_test
      and meetings.meeting_date = meeting_date_value
      and (
        meetings.external_id = meeting_external_id_value
        or meetings.venue_slug = venue_slug_value
      )
    group by meetings.id
    order by (meetings.external_id = meeting_external_id_value) desc
    limit 1;

    select max(tasks.created_at)
    into latest_schedule_attempt_at
    from public.race_feed_tasks tasks
    where tasks.task_type = 'meeting_schedule'
      and tasks.meeting_date = meeting_date_value
      and lower(regexp_replace(coalesce(tasks.venue, ''), '[^a-zA-Z0-9]+', '-', 'g')) = venue_slug_value;

    metadata_changed := existing_meeting_id is not null and (
      (expected_race_count is not null and existing_race_count is distinct from expected_race_count)
      or (
        incoming_first_race_time is not null
        and existing_first_race_at is not null
        and (existing_first_race_at at time zone 'Africa/Johannesburg')::time is distinct from incoming_first_race_time
      )
    );

    should_queue := metadata_changed
      or latest_schedule_attempt_at is null
      or latest_schedule_attempt_at < now() - interval '6 hours';

    if should_queue then
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
          'permitted_sources', jsonb_build_array('formgrids.info', 'raceform.co.za'),
          'change_type', case when existing_meeting_id is null then 'new_meeting' else 'routine_change' end
        ),
        now(),
        task_row.created_by
      )
      on conflict (task_key) do nothing;

      if found then
        child_count := child_count + 1;
      end if;
    else
      skipped_count := skipped_count + 1;
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
    'childTaskCount', child_count,
    'unchangedMeetingCount', skipped_count
  );
end;
$$;

create or replace function app_private.enqueue_race_feed_review_alert(p_proposal_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.race_feed_proposals%rowtype;
  recipient record;
  recipient_count integer := 0;
  incident_key_value text;
  payload_value jsonb;
begin
  select * into proposal_row
  from public.race_feed_proposals
  where id = p_proposal_id;

  if proposal_row.id is null
    or proposal_row.status not in ('pending', 'quarantined') then
    return 0;
  end if;

  incident_key_value := 'race-feed-proposal-review:' || coalesce(
    nullif(proposal_row.proposal_hash, ''),
    proposal_row.meeting_key || ':' || proposal_row.change_type
  );
  payload_value := jsonb_build_object(
    'proposalId', proposal_row.id,
    'meetingVenue', proposal_row.venue,
    'meetingDate', proposal_row.meeting_date,
    'changeType', proposal_row.change_type,
    'confidenceScore', proposal_row.confidence_score,
    'distinctSourceCount', proposal_row.distinct_source_count,
    'approvedSourceCount', proposal_row.approved_source_count,
    'hasCriticalConflict', proposal_row.has_critical_conflict,
    'status', proposal_row.status,
    'adminUrl', 'https://www.mrcracing.co.za/admin/race-feed/#proposals'
  );

  for recipient in
    with recipients as (
      select owners.user_id
      from public.platform_owners owners
      union
      select roles.user_id
      from public.user_roles roles
      where roles.role = 'administrator'
        and not exists (select 1 from public.platform_owners)
    )
    select user_id from recipients
  loop
    perform app_private.enqueue_channel_notification(
      recipient.user_id,
      'race_feed_proposal_review_required',
      'telegram',
      incident_key_value,
      payload_value
    );
    perform app_private.enqueue_in_app_notification(
      recipient.user_id,
      'race_feed_proposal_review_required',
      incident_key_value,
      'Race-feed approval required',
      proposal_row.venue || ' on ' || proposal_row.meeting_date::text ||
        ' is waiting for review at ' || proposal_row.confidence_score::text || '% confidence.'
    );
    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

revoke all on function public.stage_hermes_weekly_calendar_result(uuid, uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.stage_hermes_weekly_calendar_result(uuid, uuid, jsonb, jsonb)
to service_role;

revoke all on function app_private.enqueue_race_feed_review_alert(uuid)
from public, anon, authenticated, service_role;

comment on function public.stage_hermes_weekly_calendar_result(uuid, uuid, jsonb, jsonb) is
  'Stages hourly calendar evidence, immediately queues new or metadata-changed meetings, and limits unchanged meeting detail refreshes to once per six hours.';

comment on function app_private.enqueue_race_feed_review_alert(uuid) is
  'Queues one Telegram and in-app review alert per immutable proposal snapshot hash, preventing repeated notifications for unchanged evidence.';
