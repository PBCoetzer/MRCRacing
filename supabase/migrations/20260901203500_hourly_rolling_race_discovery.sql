create or replace function app_private.queue_hourly_race_calendar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  local_now timestamp := now() at time zone 'Africa/Johannesburg';
  local_date date := local_now::date;
  hour_bucket text := to_char(date_trunc('hour', local_now), 'YYYYMMDDHH24');
  task_row public.race_feed_tasks%rowtype;
begin
  if not pg_try_advisory_xact_lock(hashtext('mrc-hourly-race-calendar:' || hour_bucket)) then
    return jsonb_build_object('status', 'busy');
  end if;

  source_id_value := app_private.ensure_hermes_local_source();

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    task_payload,
    due_at,
    max_attempts
  )
  values (
    source_id_value,
    'weekly-calendar:hermes:hourly:' || hour_bucket,
    'weekly_calendar',
    jsonb_build_object(
      'weekStart', local_date,
      'dateFrom', local_date,
      'dateTo', local_date + 6,
      'lookaheadDays', 7,
      'countryCode', 'ZA',
      'provider', 'hermes',
      'delegate_to_hermes', true,
      'permitted_sources', jsonb_build_array('formgrids.info', 'raceform.co.za'),
      'additionalInformation',
        'Hourly rolling South African calendar discovery. Merge approved sources and queue newly published or changed meetings immediately.'
    ),
    now(),
    20
  )
  on conflict (task_key) do update
  set updated_at = now()
  returning * into task_row;

  return jsonb_build_object(
    'status', case when task_row.attempts = 0 then 'queued' else task_row.state end,
    'taskId', task_row.id,
    'dateFrom', local_date,
    'dateTo', local_date + 6,
    'hourBucket', hour_bucket
  );
end;
$$;

revoke all on function app_private.queue_hourly_race_calendar()
from public, anon, authenticated, service_role;

update public.race_feed_tasks
set state = 'cancelled',
    locked_at = null,
    locked_by = null,
    last_error = 'Superseded by hourly rolling race discovery.',
    updated_at = now()
where state = 'pending'
  and task_type = 'weekly_calendar'
  and task_key not like 'weekly-calendar:hermes:hourly:%';

do $$
begin
  perform cron.unschedule('mrc-daily-race-discovery')
  where exists (
    select 1 from cron.job where jobname = 'mrc-daily-race-discovery'
  );

  perform cron.unschedule('mrc-hourly-race-discovery')
  where exists (
    select 1 from cron.job where jobname = 'mrc-hourly-race-discovery'
  );

  perform cron.schedule(
    'mrc-hourly-race-discovery',
    '32 * * * *',
    'select app_private.queue_hourly_race_calendar();'
  );
end;
$$;

select app_private.queue_hourly_race_calendar();
