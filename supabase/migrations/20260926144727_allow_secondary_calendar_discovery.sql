create or replace function app_private.prefer_formgrids_for_hermes_task()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  comparison_source text;
begin
  if new.task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh')
    and coalesce(new.task_payload ->> 'provider', '') = 'hermes'
    and coalesce((new.task_payload ->> 'delegate_to_hermes')::boolean, false)
  then
    if coalesce((new.task_payload ->> 'comparison_only')::boolean, false) then
      comparison_source := app_private.normalize_race_source_domain(
        new.task_payload ->> 'comparison_source'
      );
      if comparison_source is null or comparison_source = 'formgrids.info' then
        raise exception 'Comparison tasks require one non-Formgrids source.';
      end if;
      new.task_payload := jsonb_set(
        new.task_payload,
        '{permitted_sources}',
        jsonb_build_array(comparison_source),
        true
      );
    elsif new.task_type = 'weekly_calendar' then
      new.task_payload := jsonb_set(
        jsonb_set(
          new.task_payload,
          '{permitted_sources}',
          jsonb_build_array('formgrids.info', 'raceform.co.za'),
          true
        ),
        '{primary_source}',
        to_jsonb('formgrids.info'::text),
        true
      );
    else
      new.task_payload := jsonb_set(
        jsonb_set(
          new.task_payload,
          '{permitted_sources}',
          jsonb_build_array('formgrids.info'),
          true
        ),
        '{primary_source}',
        to_jsonb('formgrids.info'::text),
        true
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.prefer_formgrids_for_hermes_task()
from public, anon, authenticated, service_role;

update public.race_feed_tasks
set task_payload = jsonb_set(
  jsonb_set(
    task_payload,
    '{permitted_sources}',
    jsonb_build_array('formgrids.info', 'raceform.co.za'),
    true
  ),
  '{primary_source}',
  to_jsonb('formgrids.info'::text),
  true
),
updated_at = now()
where task_type = 'weekly_calendar'
  and coalesce(task_payload ->> 'provider', '') = 'hermes'
  and coalesce((task_payload ->> 'delegate_to_hermes')::boolean, false);

comment on function app_private.prefer_formgrids_for_hermes_task() is
  'Keeps Formgrids authoritative for race facts while allowing Raceform to supplement rolling calendar discovery and dedicated comparison tasks.';

