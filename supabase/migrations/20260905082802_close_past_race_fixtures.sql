create or replace function public.reconcile_race_statuses(
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  completed_fixtures integer := 0;
  completed_meetings integer := 0;
  johannesburg_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  update public.fixtures fixtures
  set status = 'completed'
  where fixtures.status in ('scheduled', 'in_progress', 'delayed')
    and fixtures.starts_at <= now()
    and (
      exists (
        select 1
        from public.race_entries entries
        where entries.fixture_id = fixtures.id
          and entries.result_position = 1
      )
      or (
        fixtures.status = 'in_progress'
        and exists (
          select 1
          from public.race_meetings meetings
          where meetings.id = fixtures.meeting_id
            and not meetings.is_test
            and meetings.status in ('in_progress', 'completed')
            and meetings.meeting_date < johannesburg_today
        )
      )
    );
  get diagnostics completed_fixtures = row_count;

  update public.race_meetings meetings
  set status = 'completed'
  where meetings.status in ('scheduled', 'in_progress')
    and (
      (
        meetings.status = 'in_progress'
        and meetings.meeting_date < johannesburg_today
      )
      or (
        exists (
          select 1
          from public.fixtures fixtures
          where fixtures.meeting_id = meetings.id
        )
        and not exists (
          select 1
          from public.fixtures fixtures
          where fixtures.meeting_id = meetings.id
            and fixtures.status not in ('completed', 'cancelled', 'abandoned')
        )
      )
    );
  get diagnostics completed_meetings = row_count;

  if completed_fixtures > 0 or completed_meetings > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, metadata)
    values (
      p_actor_id,
      'race_statuses_reconciled',
      'race_lifecycle',
      jsonb_build_object(
        'completedFixtures', completed_fixtures,
        'completedMeetings', completed_meetings,
        'johannesburgDate', johannesburg_today
      )
    );
  end if;

  return jsonb_build_object(
    'completedFixtures', completed_fixtures,
    'completedMeetings', completed_meetings,
    'johannesburgDate', johannesburg_today
  );
end;
$$;

revoke all on function public.reconcile_race_statuses(uuid)
from public, anon, authenticated;
grant execute on function public.reconcile_race_statuses(uuid)
to service_role;

comment on function public.reconcile_race_statuses(uuid) is
  'Reconciles fixture completion from winner evidence, closes past in-progress races, and closes meetings that ended before the current Johannesburg date.';

select public.reconcile_race_statuses(null);
