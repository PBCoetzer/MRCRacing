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
    and exists (
      select 1
      from public.race_entries entries
      where entries.fixture_id = fixtures.id
        and entries.result_position = 1
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
  'Reconciles stale fixture statuses from winner evidence and closes meetings that ended before the current Johannesburg date.';

create or replace function app_private.complete_fixture_from_winner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_id_value uuid;
begin
  if new.result_position is distinct from 1 then
    return new;
  end if;

  select fixtures.meeting_id
  into meeting_id_value
  from public.fixtures fixtures
  where fixtures.id = new.fixture_id;

  update public.fixtures
  set status = 'completed'
  where id = new.fixture_id
    and starts_at <= now()
    and status in ('scheduled', 'in_progress', 'delayed');

  if meeting_id_value is not null then
    update public.race_meetings meetings
    set status = 'completed'
    where meetings.id = meeting_id_value
      and meetings.status in ('scheduled', 'in_progress')
      and exists (
        select 1
        from public.fixtures fixtures
        where fixtures.meeting_id = meetings.id
      )
      and not exists (
        select 1
        from public.fixtures fixtures
        where fixtures.meeting_id = meetings.id
          and fixtures.status not in ('completed', 'cancelled', 'abandoned')
      );
  end if;

  return new;
end;
$$;

revoke all on function app_private.complete_fixture_from_winner()
from public, anon, authenticated;

drop trigger if exists complete_fixture_from_winner on public.race_entries;
create trigger complete_fixture_from_winner
after insert or update of result_position on public.race_entries
for each row
execute function app_private.complete_fixture_from_winner();

select public.reconcile_race_statuses(null);
