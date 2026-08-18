-- Meeting-card sales and first publication close 30 minutes before Race 1.
-- Result polling still begins from each fixture's actual scheduled start.

create or replace function app_private.meeting_card_sales_open(
  p_meeting_status public.race_meeting_status,
  p_first_race_at timestamptz,
  p_reference_time timestamptz default now()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_meeting_status = 'scheduled'
    and p_first_race_at > p_reference_time + interval '30 minutes';
$$;

create or replace function app_private.enforce_tip_card_meeting_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_row public.race_meetings%rowtype;
begin
  select * into meeting_row
  from public.race_meetings
  where id = new.meeting_id;

  if meeting_row.id is null then
    raise exception 'The selected meeting is unavailable.';
  end if;

  if tg_op = 'INSERT'
    and not app_private.meeting_card_sales_open(
      meeting_row.status,
      meeting_row.first_race_at
    )
  then
    raise exception 'Meeting cards close 30 minutes before Race 1.';
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('draft', 'coming_soon')
    and new.status <> 'void'
    and not app_private.meeting_card_sales_open(
      meeting_row.status,
      meeting_row.first_race_at
    )
  then
    raise exception 'This meeting card closed 30 minutes before Race 1.';
  end if;

  return new;
end;
$$;

create or replace function app_private.enforce_meeting_purchase_cutoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_type = 'meeting'
    and not exists (
      select 1
      from public.tip_cards cards
      join public.race_meetings meetings on meetings.id = cards.meeting_id
      where cards.id = new.tip_card_id
        and cards.status in ('coming_soon', 'published')
        and app_private.meeting_card_sales_open(
          meetings.status,
          meetings.first_race_at
        )
    )
  then
    raise exception 'This meeting card closed 30 minutes before Race 1.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.meeting_card_sales_open(
  public.race_meeting_status,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

revoke all on function app_private.enforce_tip_card_meeting_window()
  from public, anon, authenticated;
revoke all on function app_private.enforce_meeting_purchase_cutoff()
  from public, anon, authenticated;

grant execute on function app_private.meeting_card_sales_open(
  public.race_meeting_status,
  timestamptz,
  timestamptz
) to service_role;

comment on function app_private.meeting_card_sales_open(
  public.race_meeting_status,
  timestamptz,
  timestamptz
) is 'Authoritative 30-minute pre-Race-1 cutoff for new cards, first publication, and meeting-card purchases.';
