create or replace function app_private.enforce_meeting_purchase_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
begin
  if new.purchase_type <> 'meeting' then
    return new;
  end if;

  select
    cards.tipster_id,
    cards.status,
    cards.published_at,
    meetings.first_race_at
  into card_row
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.id = new.tip_card_id;

  if card_row.tipster_id is null
    or card_row.status <> 'published'
    or card_row.published_at is null
  then
    raise exception 'Meeting cards can only be purchased after the tipster has published the tips.';
  end if;

  if new.tipster_id <> card_row.tipster_id then
    raise exception 'The meeting-card seller does not match the published card.';
  end if;

  if exists (
    select 1
    from public.tipster_subscriptions subscriptions
    join public.content_purchases subscription_purchases
      on subscription_purchases.id = subscriptions.purchase_id
     and subscription_purchases.purchase_type = 'subscription'
     and subscription_purchases.status = 'active'
     and subscription_purchases.refunded_at is null
    where subscriptions.user_id = new.user_id
      and subscriptions.tipster_id = card_row.tipster_id
      and subscriptions.status = 'active'
      and card_row.first_race_at >= subscriptions.starts_at
      and card_row.first_race_at < subscriptions.ends_at
  ) then
    raise exception 'This meeting card is already included in your active subscription.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_meeting_purchase_eligibility
on public.content_purchases;

create trigger enforce_meeting_purchase_eligibility
before insert on public.content_purchases
for each row
execute function app_private.enforce_meeting_purchase_eligibility();

revoke all on function app_private.enforce_meeting_purchase_eligibility()
from public, anon, authenticated;

create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text,
  p_purchase_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_meeting_card_confirmed$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase_id uuid;
  card_row record;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select purchases.id into existing_purchase_id
  from public.content_purchases purchases
  where purchases.user_id = current_user_id
    and purchases.idempotency_key = p_idempotency_key;

  if existing_purchase_id is not null then
    return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
  end if;

  if not coalesce(p_purchase_confirmed, false) then
    raise exception 'Confirm this meeting-card purchase before Credits are deducted.';
  end if;

  select
    cards.tipster_id,
    cards.status,
    cards.published_at,
    meetings.first_race_at
  into card_row
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.id = p_tip_card_id;

  if card_row.tipster_id is null
    or card_row.status <> 'published'
    or card_row.published_at is null
  then
    raise exception 'Meeting cards can only be purchased after the tipster has published the tips.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meeting-purchase:' || current_user_id::text || ':' || p_tip_card_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.tipster_subscriptions subscriptions
    join public.content_purchases subscription_purchases
      on subscription_purchases.id = subscriptions.purchase_id
     and subscription_purchases.purchase_type = 'subscription'
     and subscription_purchases.status = 'active'
     and subscription_purchases.refunded_at is null
    where subscriptions.user_id = current_user_id
      and subscriptions.tipster_id = card_row.tipster_id
      and subscriptions.status = 'active'
      and card_row.first_race_at >= subscriptions.starts_at
      and card_row.first_race_at < subscriptions.ends_at
  ) then
    raise exception 'This meeting card is already included in your active subscription.';
  end if;

  if exists (
    select 1
    from public.content_purchases purchases
    where purchases.user_id = current_user_id
      and purchases.tip_card_id = p_tip_card_id
      and purchases.status in ('active', 'disputed')
  ) then
    raise exception 'You already own this meeting card and cannot purchase it twice.';
  end if;

  return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
end;
$purchase_meeting_card_confirmed$;

revoke all on function public.purchase_meeting_card(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.purchase_meeting_card(uuid, text, boolean)
to authenticated;

comment on function public.purchase_meeting_card(uuid, text, boolean) is
  'Purchases a published meeting card after explicit confirmation, while preventing duplicate purchases and purchases already covered by a subscription.';

create or replace function public.get_my_tipster_earnings_ledger(
  p_limit integer default 20
)
returns table (
  id uuid,
  entry_type text,
  purchase_type text,
  source_label text,
  gross_coins numeric,
  platform_fee_coins numeric,
  net_coins numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is currently restricted.';
  end if;

  return query
  select
    earnings.id,
    earnings.entry_type,
    purchases.purchase_type::text,
    case
      when purchases.purchase_type = 'meeting'
        then coalesce(cards.title, 'Meeting card')
      else coalesce(packages.name, 'Tipster subscription')
    end,
    earnings.gross_coins,
    earnings.platform_fee_coins,
    earnings.net_coins,
    earnings.created_at
  from public.tipster_earnings earnings
  join public.tipsters tipsters
    on tipsters.id = earnings.tipster_id
   and tipsters.user_id = current_user_id
  join public.content_purchases purchases on purchases.id = earnings.purchase_id
  left join public.tip_cards cards on cards.id = purchases.tip_card_id
  left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
  order by earnings.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.get_my_tipster_earnings_ledger(integer)
from public, anon, authenticated;
grant execute on function public.get_my_tipster_earnings_ledger(integer)
to authenticated;

comment on function public.get_my_tipster_earnings_ledger(integer) is
  'Returns the signed-in tipster recent earnings with meeting-card or subscription source labels and no client identity data.';
