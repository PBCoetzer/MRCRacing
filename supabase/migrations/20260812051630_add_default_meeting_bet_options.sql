create or replace function app_private.ensure_default_meeting_bet_options(
  target_meeting_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_row public.race_meetings%rowtype;
  option_row record;
  affected_rows integer;
  total_affected integer := 0;
begin
  select *
  into meeting_row
  from public.race_meetings
  where id = target_meeting_id;

  if meeting_row.id is null or meeting_row.first_race_at is null then
    return 0;
  end if;

  for option_row in
    select *
    from (
      values
        ('bipot'::text, 'Bipot'::text, 10, 'bipot'::text),
        ('pa'::text, 'PA'::text, 20, 'pa'::text),
        ('pick6'::text, 'Pick 6'::text, 30, 'pick-6'::text),
        ('jackpot'::text, 'Jackpot 1'::text, 40, 'jackpot-1'::text),
        ('jackpot'::text, 'Jackpot 2'::text, 50, 'jackpot-2'::text),
        ('other'::text, 'Other / Multiple'::text, 60, 'other-multiple'::text)
    ) as options(bet_type, display_name, sort_order, external_suffix)
  loop
    insert into public.meeting_bet_options (
      meeting_id,
      bet_type,
      display_name,
      cutoff_at,
      leg_count,
      sort_order,
      external_id,
      source_payload
    )
    values (
      meeting_row.id,
      option_row.bet_type,
      option_row.display_name,
      meeting_row.first_race_at,
      0,
      option_row.sort_order,
      meeting_row.external_id || '-tip-category-' || option_row.external_suffix,
      jsonb_build_object(
        'generatedCategory', true,
        'tipFormat', 'free_text',
        'cutoffBasis', 'meeting_first_race',
        'officialLegsKnown', false
      )
    )
    on conflict (meeting_id, display_name) do update
    set
      cutoff_at = excluded.cutoff_at,
      updated_at = now()
    where public.meeting_bet_options.source_payload ->> 'generatedCategory' = 'true';

    get diagnostics affected_rows = row_count;
    total_affected := total_affected + affected_rows;
  end loop;

  return total_affected;
end;
$$;

create or replace function app_private.ensure_default_meeting_bet_options_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.ensure_default_meeting_bet_options(new.id);
  return new;
end;
$$;

drop trigger if exists ensure_default_meeting_bet_options
on public.race_meetings;

create trigger ensure_default_meeting_bet_options
after insert or update of first_race_at
on public.race_meetings
for each row
execute function app_private.ensure_default_meeting_bet_options_trigger();

select app_private.ensure_default_meeting_bet_options(meeting.id)
from public.race_meetings meeting;

revoke all on function app_private.ensure_default_meeting_bet_options(uuid)
from public, anon, authenticated;
revoke all on function app_private.ensure_default_meeting_bet_options_trigger()
from public, anon, authenticated;

grant execute on function app_private.ensure_default_meeting_bet_options(uuid)
to service_role;

;
