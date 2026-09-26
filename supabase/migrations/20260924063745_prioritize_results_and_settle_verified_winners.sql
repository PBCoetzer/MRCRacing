-- Result refreshes must not wait behind the continuously replenished schedule
-- queue. A verified official winner is also sufficient to settle winner-tip
-- accuracy even when the primary source has not supplied every finishing place.

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
      when 'result_refresh' then 1
      when 'meeting_schedule' then 2
      when 'race_detail' then 3
      when 'weekly_calendar' then 4
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
      last_completed_at = case
        when normalized_status <> 'failed' and not delegated_pending then now()
        else last_completed_at
      end
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

create or replace function app_private.enforce_tip_card_race_outcome_refresh()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  canonical_winner_position integer;
  canonical_winner_status text;
  canonical_place_position integer;
  canonical_official_winner_id uuid;
  canonical_result_summary text;
  canonical_source_updated_at timestamptz;
  canonical_winner_hit boolean;
  canonical_evidence_hash text;
begin
  if tg_op = 'DELETE' then
    raise exception 'This audit record is immutable.';
  end if;

  if new.id is distinct from old.id
    or new.tip_card_id is distinct from old.tip_card_id
    or new.fixture_id is distinct from old.fixture_id
    or new.selected_winner_entry_id is distinct from old.selected_winner_entry_id
    or new.selected_place_entry_id is distinct from old.selected_place_entry_id
    or new.settled_at < old.settled_at then
    raise exception 'This audit record is immutable.';
  end if;

  select
    selected_winner.result_position,
    selected_winner.status,
    selected_place.result_position,
    official_winner.id,
    fixtures.result_summary,
    fixtures.source_updated_at
  into
    canonical_winner_position,
    canonical_winner_status,
    canonical_place_position,
    canonical_official_winner_id,
    canonical_result_summary,
    canonical_source_updated_at
  from public.fixtures fixtures
  left join public.race_entries selected_winner
    on selected_winner.id = old.selected_winner_entry_id
    and selected_winner.fixture_id = fixtures.id
  left join public.race_entries selected_place
    on selected_place.id = old.selected_place_entry_id
    and selected_place.fixture_id = fixtures.id
  left join lateral (
    select entries.id
    from public.race_entries entries
    where entries.fixture_id = fixtures.id
      and entries.result_position = 1
    order by entries.id
    limit 1
  ) official_winner on true
  where fixtures.id = old.fixture_id;

  if not found then
    raise exception 'Outcome fixture no longer exists.';
  end if;

  canonical_winner_hit := case
    when old.selected_winner_entry_id is null then null
    when coalesce(canonical_winner_status, 'active') in ('scratched', 'withdrawn') then null
    when canonical_official_winner_id is null then null
    else old.selected_winner_entry_id = canonical_official_winner_id
  end;

  canonical_evidence_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'fixtureId', old.fixture_id,
          'resultSummary', canonical_result_summary,
          'winnerEntryId', canonical_official_winner_id,
          'selectedWinnerEntryId', old.selected_winner_entry_id,
          'selectedWinnerPosition', canonical_winner_position,
          'winnerHit', canonical_winner_hit,
          'selectedPlaceEntryId', old.selected_place_entry_id,
          'selectedPlacePosition', canonical_place_position,
          'sourceUpdatedAt', canonical_source_updated_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if new.selected_winner_position is distinct from canonical_winner_position
    or new.winner_hit is distinct from canonical_winner_hit
    or new.selected_place_position is distinct from canonical_place_position
    or new.official_winner_entry_id is distinct from canonical_official_winner_id
    or new.result_summary is distinct from canonical_result_summary
    or new.evidence_hash is distinct from canonical_evidence_hash then
    raise exception 'Outcome refresh does not match the canonical official result.';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    null,
    'tip_card_race_outcome_refreshed',
    'tip_card_race_outcome',
    old.id,
    jsonb_build_object(
      'fixtureId', old.fixture_id,
      'previousEvidenceHash', old.evidence_hash,
      'newEvidenceHash', new.evidence_hash,
      'previousWinnerPosition', old.selected_winner_position,
      'newWinnerPosition', new.selected_winner_position,
      'previousWinnerHit', old.winner_hit,
      'newWinnerHit', new.winner_hit,
      'previousPlacePosition', old.selected_place_position,
      'newPlacePosition', new.selected_place_position,
      'previousResultSummary', old.result_summary,
      'newResultSummary', new.result_summary,
      'refreshedAt', new.settled_at
    )
  );

  return new;
end;
$$;

create or replace function app_private.refresh_tipster_performance_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with effective_outcomes as (
    select
      outcomes.id,
      outcomes.tip_card_id,
      outcomes.selected_winner_entry_id,
      case
        when outcomes.selected_winner_entry_id is null then null
        when outcomes.winner_hit is not null then outcomes.winner_hit
        when coalesce(selected_winner.status, 'active') in ('scratched', 'withdrawn') then null
        when selected_winner.result_position is not null then selected_winner.result_position = 1
        when outcomes.official_winner_entry_id is not null
          then outcomes.selected_winner_entry_id = outcomes.official_winner_entry_id
        else null
      end as winner_hit,
      outcomes.selected_place_entry_id,
      coalesce(
        selected_place.result_position,
        outcomes.selected_place_position
      ) as selected_place_position
    from public.tip_card_race_outcomes outcomes
    left join public.race_entries selected_winner
      on selected_winner.id = outcomes.selected_winner_entry_id
    left join public.race_entries selected_place
      on selected_place.id = outcomes.selected_place_entry_id
  )
  insert into public.tipster_performance_stats (
    tipster_id,
    published_winner_tips,
    settled_winner_tips,
    winner_hits,
    winner_strike_rate,
    published_place_tips,
    settled_place_tips,
    place_hits,
    place_strike_rate,
    roi_percent,
    updated_at
  )
  select
    tipsters.id,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
        and outcomes.winner_hit is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
        and outcomes.winner_hit
    )::integer,
    case
      when count(outcomes.id) filter (
        where outcomes.selected_winner_entry_id is not null
          and outcomes.winner_hit is not null
      ) = 0 then null
      else round(
        count(outcomes.id) filter (
          where outcomes.selected_winner_entry_id is not null
            and outcomes.winner_hit
        )::numeric
          / count(outcomes.id) filter (
            where outcomes.selected_winner_entry_id is not null
              and outcomes.winner_hit is not null
          )::numeric * 100,
        2
      )
    end,
    count(outcomes.id) filter (
      where outcomes.selected_place_entry_id is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_place_entry_id is not null
        and outcomes.selected_place_position is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_place_entry_id is not null
        and outcomes.selected_place_position between 1 and 3
    )::integer,
    case
      when count(outcomes.id) filter (
        where outcomes.selected_place_entry_id is not null
          and outcomes.selected_place_position is not null
      ) = 0 then null
      else round(
        count(outcomes.id) filter (
          where outcomes.selected_place_entry_id is not null
            and outcomes.selected_place_position between 1 and 3
        )::numeric
          / count(outcomes.id) filter (
            where outcomes.selected_place_entry_id is not null
              and outcomes.selected_place_position is not null
          )::numeric * 100,
        2
      )
    end,
    null::numeric,
    now()
  from public.tipsters tipsters
  left join public.tip_cards cards
    on cards.tipster_id = tipsters.id
    and cards.status = 'settled'
  left join effective_outcomes outcomes
    on outcomes.tip_card_id = cards.id
  where tipsters.is_verified = true
  group by tipsters.id
  on conflict (tipster_id) do update
  set
    published_winner_tips = excluded.published_winner_tips,
    settled_winner_tips = excluded.settled_winner_tips,
    winner_hits = excluded.winner_hits,
    winner_strike_rate = excluded.winner_strike_rate,
    published_place_tips = excluded.published_place_tips,
    settled_place_tips = excluded.settled_place_tips,
    place_hits = excluded.place_hits,
    place_strike_rate = excluded.place_strike_rate,
    roi_percent = excluded.roi_percent,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function app_private.settle_completed_tip_cards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  settled_count integer := 0;
begin
  update public.tip_cards cards
  set status = 'settled'
  from public.race_meetings meetings
  where meetings.id = cards.meeting_id
    and meetings.status = 'completed'
    and cards.status = 'published'
    and exists (
      select 1
      from public.fixtures fixtures
      where fixtures.meeting_id = meetings.id
    )
    and not exists (
      select 1
      from public.fixtures fixtures
      where fixtures.meeting_id = meetings.id
        and (
          fixtures.status not in ('completed', 'cancelled', 'abandoned')
          or (
            fixtures.status = 'completed'
            and (
              select count(*)
              from public.race_entries official_winner
              where official_winner.fixture_id = fixtures.id
                and official_winner.result_position = 1
            ) <> 1
          )
        )
    );
  get diagnostics settled_count = row_count;

  insert into public.tip_card_race_outcomes (
    tip_card_id,
    fixture_id,
    selected_winner_entry_id,
    selected_winner_position,
    winner_hit,
    selected_place_entry_id,
    selected_place_position,
    official_winner_entry_id,
    result_summary,
    evidence_hash,
    settled_at
  )
  select
    cards.id,
    fixtures.id,
    selections.winner_entry_id,
    selected_winner.result_position,
    case
      when fixtures.status <> 'completed' then null
      when selections.winner_entry_id is null then null
      when coalesce(selected_winner.status, 'active') in ('scratched', 'withdrawn') then null
      when official_winner.id is null then null
      else selections.winner_entry_id = official_winner.id
    end,
    selections.place_entry_id,
    selected_place.result_position,
    official_winner.id,
    fixtures.result_summary,
    encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'fixtureId', fixtures.id,
            'resultSummary', fixtures.result_summary,
            'winnerEntryId', official_winner.id,
            'selectedWinnerEntryId', selections.winner_entry_id,
            'selectedWinnerPosition', selected_winner.result_position,
            'winnerHit', case
              when fixtures.status <> 'completed' then null
              when selections.winner_entry_id is null then null
              when coalesce(selected_winner.status, 'active') in ('scratched', 'withdrawn') then null
              when official_winner.id is null then null
              else selections.winner_entry_id = official_winner.id
            end,
            'selectedPlaceEntryId', selections.place_entry_id,
            'selectedPlacePosition', selected_place.result_position,
            'sourceUpdatedAt', fixtures.source_updated_at
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    now()
  from public.tip_cards cards
  join public.race_meetings meetings
    on meetings.id = cards.meeting_id
  join public.fixtures fixtures
    on fixtures.meeting_id = meetings.id
  left join public.race_tip_selections selections
    on selections.tip_card_id = cards.id
    and selections.fixture_id = fixtures.id
  left join public.race_entries selected_winner
    on selected_winner.id = selections.winner_entry_id
  left join public.race_entries selected_place
    on selected_place.id = selections.place_entry_id
  left join lateral (
    select entries.id
    from public.race_entries entries
    where entries.fixture_id = fixtures.id
      and entries.result_position = 1
    order by entries.id
    limit 1
  ) official_winner on true
  where cards.status = 'settled'
    and meetings.status = 'completed'
    and fixtures.status in ('completed', 'cancelled', 'abandoned')
    and (
      fixtures.status in ('cancelled', 'abandoned')
      or (fixtures.status = 'completed' and official_winner.id is not null)
    )
  on conflict (tip_card_id, fixture_id) do update
  set
    selected_winner_entry_id = excluded.selected_winner_entry_id,
    selected_winner_position = excluded.selected_winner_position,
    winner_hit = excluded.winner_hit,
    selected_place_entry_id = excluded.selected_place_entry_id,
    selected_place_position = excluded.selected_place_position,
    official_winner_entry_id = excluded.official_winner_entry_id,
    result_summary = excluded.result_summary,
    evidence_hash = excluded.evidence_hash,
    settled_at = excluded.settled_at
  where public.tip_card_race_outcomes.selected_winner_entry_id
      is distinct from excluded.selected_winner_entry_id
    or public.tip_card_race_outcomes.selected_winner_position
      is distinct from excluded.selected_winner_position
    or public.tip_card_race_outcomes.winner_hit
      is distinct from excluded.winner_hit
    or public.tip_card_race_outcomes.selected_place_entry_id
      is distinct from excluded.selected_place_entry_id
    or public.tip_card_race_outcomes.selected_place_position
      is distinct from excluded.selected_place_position
    or public.tip_card_race_outcomes.official_winner_entry_id
      is distinct from excluded.official_winner_entry_id
    or public.tip_card_race_outcomes.result_summary
      is distinct from excluded.result_summary
    or public.tip_card_race_outcomes.evidence_hash
      is distinct from excluded.evidence_hash;

  perform app_private.refresh_tipster_performance_stats();
  return settled_count;
end;
$$;

-- Jobs created before the Formgrids-primary migration retain their original
-- permitted source list. Align only pending primary jobs; comparison jobs keep
-- their explicitly isolated secondary source.
update app_private.hermes_race_jobs
set permitted_sources = jsonb_build_array('formgrids.info'),
    task_payload = jsonb_set(
      jsonb_set(
        coalesce(task_payload, '{}'::jsonb),
        '{permitted_sources}',
        jsonb_build_array('formgrids.info'),
        true
      ),
      '{primary_source}',
      to_jsonb('formgrids.info'::text),
      true
    ),
    available_at = case when task_type = 'result_refresh' then now() else available_at end,
    updated_at = now()
where state in ('queued', 'returned')
  and task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh')
  and not coalesce((task_payload ->> 'comparison_only')::boolean, false);

-- Formgrids published Durbanville Race 8's official winner, but the queued
-- result job was never claimed. This guarded repair records only the verified
-- winner; unknown finishing positions remain null for later primary-source
-- enrichment.
do $$
declare
  target_fixture_id uuid;
  target_winner_id uuid;
  existing_winner_count integer := 0;
  source_url_value text := 'https://www.formgrids.info/subscriber/fgRaceResults.aspx?rd=2026-09-23,Durbanville,8,ZA';
begin
  select fixtures.id
  into target_fixture_id
  from public.race_meetings meetings
  join public.fixtures fixtures on fixtures.meeting_id = meetings.id
  where lower(btrim(meetings.venue)) = 'durbanville'
    and meetings.meeting_date = date '2026-09-23'
    and fixtures.race_number = 8
    and not meetings.is_test
  limit 1;

  if target_fixture_id is null then
    return;
  end if;

  select count(*)::integer
  into existing_winner_count
  from public.race_entries entries
  where entries.fixture_id = target_fixture_id
    and entries.result_position = 1;

  if existing_winner_count = 0 then
    select entries.id
    into target_winner_id
    from public.race_entries entries
    where entries.fixture_id = target_fixture_id
      and lower(regexp_replace(entries.horse_name, '[^a-z0-9]+', '', 'gi')) = 'scottishlinks'
    limit 1;

    if target_winner_id is not null then
      update public.race_entries entries
      set result_position = 1,
          source_name = 'Formgrids',
          source_updated_at = now(),
          source_payload = case
            when jsonb_typeof(entries.source_payload) = 'object' then entries.source_payload
            else '{}'::jsonb
          end || jsonb_build_object(
            'resultPosition', 1,
            'resultSourceName', 'Formgrids',
            'resultSourceUrl', source_url_value,
            'resultRecordedBy', '20260924063745_prioritize_results_and_settle_verified_winners'
          ),
          updated_at = now()
      where entries.id = target_winner_id;

      update public.fixtures fixtures
      set result_summary = 'SCOTTISH LINKS won in 98.51s.',
          source_name = 'Formgrids',
          source_url = source_url_value,
          source_updated_at = now(),
          source_payload = case
            when jsonb_typeof(fixtures.source_payload) = 'object' then fixtures.source_payload
            else '{}'::jsonb
          end || jsonb_build_object(
            'resultWinner', jsonb_build_object(
              'entryId', target_winner_id,
              'horseName', 'SCOTTISH LINKS',
              'position', 1
            ),
            'resultTimeSeconds', 98.51,
            'resultSourceName', 'Formgrids',
            'resultSourceUrl', source_url_value,
            'resultRecordedBy', '20260924063745_prioritize_results_and_settle_verified_winners'
          ),
          updated_at = now()
      where fixtures.id = target_fixture_id;
    end if;
  end if;

  perform app_private.settle_completed_tip_cards();
end;
$$;

comment on function app_private.claim_hermes_race_job(text) is
  'Claims result refreshes before schedule discovery so completed meetings cannot be starved by continuously replenished schedule work.';

comment on function app_private.settle_completed_tip_cards() is
  'Settles cards once every completed race has one verified official winner; exact place positions may be enriched later without blocking winner accuracy.';
