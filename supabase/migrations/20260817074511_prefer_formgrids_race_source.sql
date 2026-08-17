insert into public.race_source_domains (
  domain,
  display_name,
  status,
  reliability_score,
  reuse_basis,
  direct_fetch_allowed,
  can_auto_approve,
  last_reviewed_at
)
values (
  'formgrids.info',
  'Formgrids',
  'approved',
  95,
  'Authenticated subscription racecard evidence authorized by the account owner; website publication remains proposal-only and requires the existing approval path.',
  true,
  false,
  now()
)
on conflict (domain) do update
set
  display_name = excluded.display_name,
  status = excluded.status,
  reliability_score = excluded.reliability_score,
  reuse_basis = excluded.reuse_basis,
  direct_fetch_allowed = excluded.direct_fetch_allowed,
  can_auto_approve = excluded.can_auto_approve,
  last_reviewed_at = excluded.last_reviewed_at,
  updated_at = now();

update public.race_source_domains
set status = 'evidence_only',
    reliability_score = 75,
    direct_fetch_allowed = true,
    can_auto_approve = false,
    reuse_basis = 'Fallback public evidence source. Formgrids is authoritative for racecards, runner identity, sex and scratchings; publication remains approval-only.',
    last_reviewed_at = now(),
    updated_at = now()
where domain = 'raceform.co.za';

create or replace function app_private.prefer_formgrids_for_hermes_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail')
    and coalesce(new.task_payload ->> 'provider', '') = 'hermes'
    and coalesce((new.task_payload ->> 'delegate_to_hermes')::boolean, false)
  then
    new.task_payload := jsonb_set(
      new.task_payload,
      '{permitted_sources}',
      jsonb_build_array('formgrids.info', 'raceform.co.za'),
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists prefer_formgrids_for_hermes_task
  on public.race_feed_tasks;
create trigger prefer_formgrids_for_hermes_task
before insert or update of task_payload, task_type
on public.race_feed_tasks
for each row
execute function app_private.prefer_formgrids_for_hermes_task();

update public.race_feed_tasks
set task_payload = jsonb_set(
      task_payload,
      '{permitted_sources}',
      jsonb_build_array('formgrids.info', 'raceform.co.za'),
      true
    ),
    updated_at = now()
where state = 'pending'
  and task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail')
  and coalesce(task_payload ->> 'provider', '') = 'hermes'
  and coalesce((task_payload ->> 'delegate_to_hermes')::boolean, false);

update public.race_feed_settings
set auto_approve_new_meetings = false,
    auto_approve_routine_changes = false,
    auto_approve_results = false,
    updated_at = now()
where singleton = true;
