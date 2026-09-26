-- Allow a single explicitly approved race source to publish complete,
-- conflict-free proposals. Single-source proposals are capped at 70 percent
-- confidence by design, so the approval threshold must match that safety cap.
update public.race_feed_settings
set confidence_threshold = 70,
    minimum_approved_sources = 1,
    auto_approve_new_meetings = true,
    auto_approve_routine_changes = true,
    auto_approve_results = true,
    updated_at = now()
where singleton = true;

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
    select count(*)::integer, (array_agg(id order by id))[1]
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

    update public.race_feed_proposals proposals
    set status = 'rejected',
        reviewed_at = now(),
        review_note = 'Automatically superseded after the meeting was verified as postponed from ' ||
          candidate_row.meeting_date::text || ' to ' || incoming_date::text || '.',
        updated_at = now()
    where proposals.status in ('pending', 'quarantined')
      and proposals.source_task_id in (
        select tasks.id
        from public.race_feed_tasks tasks
        where tasks.meeting_id = candidate_row.id
          and tasks.task_type = 'result_refresh'
      );

    update app_private.hermes_race_jobs jobs
    set state = 'failed',
        error_code = 'meeting_postponed',
        error_detail = 'The result task was superseded by a verified meeting postponement.',
        completed_at = coalesce(jobs.completed_at, now()),
        updated_at = now()
    where jobs.state = 'queued'
      and jobs.source_task_id in (
        select tasks.id
        from public.race_feed_tasks tasks
        where tasks.meeting_id = candidate_row.id
          and tasks.task_type = 'result_refresh'
      );

    update public.race_feed_tasks tasks
    set state = 'cancelled',
        locked_at = null,
        locked_by = null,
        last_error = 'Superseded by verified postponement to ' || incoming_date::text || '.',
        updated_at = now()
    where tasks.meeting_id = candidate_row.id
      and tasks.task_type = 'result_refresh'
      and tasks.state in ('pending', 'failed');

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

grant execute on function app_private.reconcile_postponed_race_meetings(uuid, uuid, jsonb)
to service_role;

comment on function app_private.reconcile_postponed_race_meetings(uuid, uuid, jsonb) is
  'Reuses one unresolved nearby meeting with an 80 percent runner match, rejects obsolete result proposals, and preserves cards and entitlements across postponements.';

update public.race_feed_tasks
set due_at = least(due_at, now()),
    locked_at = null,
    locked_by = null,
    updated_at = now()
where task_type = 'meeting_schedule'
  and state = 'pending'
  and due_at < now();
