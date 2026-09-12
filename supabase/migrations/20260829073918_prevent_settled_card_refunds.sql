create or replace function app_private.refund_due_meeting_purchases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_row record;
  refund_count integer := 0;
begin
  for purchase_row in
    select
      purchases.id,
      meetings.status as meeting_status,
      cards.status as card_status,
      cards.published_at
    from public.content_purchases purchases
    join public.tip_cards cards on cards.id = purchases.tip_card_id
    join public.race_meetings meetings on meetings.id = cards.meeting_id
    where purchases.purchase_type = 'meeting'
      and purchases.status in ('active', 'disputed')
      and (
        meetings.status in ('cancelled', 'abandoned')
        or cards.status = 'void'
        or (
          meetings.first_race_at <= now()
          and cards.published_at is null
        )
      )
  loop
    if app_private.refund_content_purchase(
      purchase_row.id,
      case
        when purchase_row.meeting_status in ('cancelled', 'abandoned')
          then 'The race meeting was cancelled.'
        when purchase_row.card_status = 'void'
          and purchase_row.published_at is not null
          then 'The published meeting card was withdrawn.'
        else 'The meeting card was not published before Race 1.'
      end,
      null
    ) then
      refund_count := refund_count + 1;
    end if;
  end loop;

  return refund_count;
end;
$$;

comment on function app_private.refund_due_meeting_purchases() is
  'Refunds only one-off meeting purchases for cancelled or abandoned meetings, void cards, or cards never published before Race 1. Published settled cards are never treated as unpublished.';
