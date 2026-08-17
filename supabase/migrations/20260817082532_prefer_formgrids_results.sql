create or replace function app_private.prefer_formgrids_for_hermes_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_type = 'result_refresh'
    or (
      new.task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail')
      and coalesce(new.task_payload ->> 'provider', '') = 'hermes'
      and coalesce((new.task_payload ->> 'delegate_to_hermes')::boolean, false)
    )
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

update public.race_feed_tasks
set task_payload = jsonb_set(
      task_payload,
      '{permitted_sources}',
      jsonb_build_array('formgrids.info', 'raceform.co.za'),
      true
    ),
    updated_at = now()
where state in ('pending', 'failed')
  and task_type = 'result_refresh';

update public.race_feed_settings
set auto_approve_results = false,
    updated_at = now()
where singleton = true;
