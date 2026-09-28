create or replace function app_private.record_hermes_race_handoff(
  p_job_id uuid,
  p_status text,
  p_proposal_id uuid default null,
  p_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
  source_task_finalized boolean := false;
begin
  if p_status not in ('shadow', 'proposal_created', 'failed', 'not_applicable') then
    raise exception 'Unsupported Hermes race handoff status.';
  end if;

  update app_private.hermes_race_jobs
  set state = case when p_status = 'proposal_created' then 'accepted' else state end,
      handoff_status = p_status,
      proposal_id = p_proposal_id,
      error_code = case when p_status = 'failed' then 'proposal_handoff_failed' else error_code end,
      error_detail = case
        when p_status = 'failed' then left(coalesce(p_error, 'Proposal handoff failed.'), 2000)
        else error_detail
      end,
      updated_at = now()
  where id = p_job_id
    and state in ('returned', 'accepted')
  returning * into job_row;

  if job_row.id is null then
    raise exception 'The Hermes race job cannot be handed off from its current state.';
  end if;

  if p_status in ('shadow', 'proposal_created', 'not_applicable')
    and job_row.source_task_id is not null
    and job_row.source_run_id is not null
  then
    update public.race_feed_tasks
    set state = 'completed',
        locked_at = null,
        locked_by = null,
        last_error = null,
        last_completed_at = now(),
        updated_at = now()
    where id = job_row.source_task_id
      and run_id = job_row.source_run_id
      and state in ('pending', 'running', 'failed');

    source_task_finalized := found;

    if source_task_finalized then
      if p_status in ('shadow', 'not_applicable') then
        update public.race_feed_runs
        set status = 'succeeded',
            completed_at = coalesce(completed_at, now()),
            error_code = null,
            error_message = null
        where id = job_row.source_run_id
          and status in ('running', 'pending_approval', 'failed');
      end if;

      update app_private.hermes_race_jobs
      set state = 'failed',
          error_code = 'superseded_by_successful_handoff',
          error_detail = 'A successful Hermes handoff already completed the source task.',
          completed_at = coalesce(completed_at, now()),
          updated_at = now()
      where source_task_id = job_row.source_task_id
        and id <> job_row.id
        and state = 'queued';
    end if;
  end if;

  insert into app_private.hermes_race_job_events (job_id, event_type, detail)
  values (
    job_row.id,
    'handoff_' || p_status,
    jsonb_build_object(
      'proposal_id', p_proposal_id,
      'error', p_error,
      'source_task_finalized', source_task_finalized
    )
  );

  return to_jsonb(job_row)
    || jsonb_build_object('source_task_finalized', source_task_finalized);
end;
$$;

revoke all on function app_private.record_hermes_race_handoff(uuid, text, uuid, text)
from public, anon, authenticated;

grant execute on function app_private.record_hermes_race_handoff(uuid, text, uuid, text)
to service_role;

with redundant_jobs as (
  update app_private.hermes_race_jobs queued
  set state = 'failed',
      error_code = 'superseded_by_successful_handoff',
      error_detail = 'A successful Hermes handoff already completed the source task.',
      completed_at = coalesce(queued.completed_at, now()),
      updated_at = now()
  where queued.state = 'queued'
    and exists (
      select 1
      from public.race_feed_tasks tasks
      where tasks.id = queued.source_task_id
        and tasks.task_type = 'meeting_schedule'
    )
    and exists (
      select 1
      from app_private.hermes_race_jobs successful
      where successful.source_task_id = queued.source_task_id
        and successful.id <> queued.id
        and successful.completed_at >= now() - interval '6 hours'
        and (
          (successful.state = 'accepted' and successful.handoff_status = 'proposal_created')
          or (
            successful.state = 'returned'
            and successful.handoff_status in ('shadow', 'not_applicable')
          )
        )
    )
  returning queued.source_run_id
)
update public.race_feed_runs runs
set status = 'skipped',
    completed_at = coalesce(runs.completed_at, now()),
    error_code = 'superseded_by_successful_handoff',
    error_message = 'A prior successful Hermes handoff already completed this source task.'
where runs.id in (select source_run_id from redundant_jobs)
  and runs.status in ('running', 'pending_approval');

update public.race_feed_tasks tasks
set state = 'completed',
    locked_at = null,
    locked_by = null,
    last_error = null,
    last_completed_at = coalesce(tasks.last_completed_at, now()),
    updated_at = now()
where tasks.task_type = 'meeting_schedule'
  and tasks.state in ('pending', 'running', 'failed')
  and exists (
    select 1
    from app_private.hermes_race_jobs successful
    where successful.source_task_id = tasks.id
      and successful.completed_at >= now() - interval '6 hours'
      and (
        (successful.state = 'accepted' and successful.handoff_status = 'proposal_created')
        or (
          successful.state = 'returned'
          and successful.handoff_status in ('shadow', 'not_applicable')
        )
      )
  )
  and not exists (
    select 1
    from app_private.hermes_race_jobs active
    where active.source_task_id = tasks.id
      and active.state in ('queued', 'leased')
  );

comment on function app_private.record_hermes_race_handoff(uuid, text, uuid, text) is
  'Records the terminal Hermes handoff and closes the matching race-feed source task so the scheduler cannot enqueue duplicate work.';

