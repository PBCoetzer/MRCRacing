alter table public.platform_settings
add column if not exists horse_care_rate numeric(5, 2) not null default 10.00,
add column if not exists tipster_rate numeric(5, 2) not null default 70.00;

update public.platform_settings
set
  commission_rate = 20.00,
  horse_care_rate = 10.00,
  tipster_rate = 70.00,
  updated_at = now()
where singleton = true;

alter table public.platform_settings
drop constraint if exists platform_settings_horse_care_rate_check,
drop constraint if exists platform_settings_tipster_rate_check,
drop constraint if exists platform_settings_content_split_total_check;

alter table public.platform_settings
add constraint platform_settings_horse_care_rate_check
check (horse_care_rate between 0 and 100),
add constraint platform_settings_tipster_rate_check
check (tipster_rate between 0 and 100),
add constraint platform_settings_content_split_total_check
check (commission_rate + horse_care_rate + tipster_rate = 100.00);

comment on column public.platform_settings.commission_rate is
  'MRC platform percentage of Purchased Credits consumed by paid content. Credit top-ups and Reward Credits are excluded.';
comment on column public.platform_settings.horse_care_rate is
  'Horse Care percentage of Purchased Credits consumed by paid content. Credit top-ups and Reward Credits are excluded.';
comment on column public.platform_settings.tipster_rate is
  'Tipster percentage of Purchased Credits consumed by paid content. Credit top-ups and Reward Credits are excluded.';

create or replace function app_private.calculate_content_spend_split(
  p_purchased_credits integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $calculate_content_spend_split$
declare
  settings_row record;
  platform_credits numeric(12, 2);
  horse_care_credits numeric(12, 2);
  tipster_credits numeric(12, 2);
begin
  if p_purchased_credits is null or p_purchased_credits < 0 then
    raise exception 'Purchased Credit usage cannot be negative.';
  end if;

  select commission_rate, horse_care_rate, tipster_rate
  into settings_row
  from public.platform_settings
  where singleton = true;

  if settings_row.commission_rate is null
    or settings_row.horse_care_rate is null
    or settings_row.tipster_rate is null
    or settings_row.commission_rate + settings_row.horse_care_rate + settings_row.tipster_rate <> 100.00
  then
    raise exception 'The content-spend revenue split is not configured correctly.';
  end if;

  platform_credits := round(p_purchased_credits * settings_row.commission_rate / 100.0, 2);
  horse_care_credits := round(p_purchased_credits * settings_row.horse_care_rate / 100.0, 2);
  tipster_credits := round(p_purchased_credits - platform_credits - horse_care_credits, 2);

  return jsonb_build_object(
    'allocationVersion', 'content-spend-10-20-70-v1',
    'purchasedCreditsUsed', p_purchased_credits,
    'platformRate', settings_row.commission_rate,
    'horseCareRate', settings_row.horse_care_rate,
    'tipsterRate', settings_row.tipster_rate,
    'platformCredits', platform_credits,
    'horseCareCredits', horse_care_credits,
    'tipsterCredits', tipster_credits
  );
end;
$calculate_content_spend_split$;

revoke all on function app_private.calculate_content_spend_split(integer)
from public, anon, authenticated, service_role;

alter table public.content_purchases
add column if not exists horse_care_rate numeric(5, 2),
add column if not exists horse_care_coins numeric(12, 2),
add column if not exists tipster_rate numeric(5, 2),
add column if not exists allocation_version text;

update public.content_purchases
set
  commission_rate = 20.00,
  horse_care_rate = 10.00,
  tipster_rate = 70.00,
  platform_fee_coins = round(purchased_coins * 20.00 / 100.0, 2),
  horse_care_coins = round(purchased_coins * 10.00 / 100.0, 2),
  tipster_net_coins = round(
    purchased_coins
      - round(purchased_coins * 20.00 / 100.0, 2)
      - round(purchased_coins * 10.00 / 100.0, 2),
    2
  ),
  allocation_version = 'content-spend-10-20-70-v1';

alter table public.content_purchases
alter column horse_care_rate set not null,
alter column horse_care_rate set default 10.00,
alter column horse_care_coins set not null,
alter column horse_care_coins set default 0,
alter column tipster_rate set not null,
alter column tipster_rate set default 70.00,
alter column allocation_version set not null,
alter column allocation_version set default 'content-spend-10-20-70-v1';

alter table public.content_purchases
drop constraint if exists content_purchases_horse_care_rate_check,
drop constraint if exists content_purchases_tipster_rate_check,
drop constraint if exists content_purchases_horse_care_coins_check,
drop constraint if exists content_purchases_allocation_rate_total_check,
drop constraint if exists content_purchases_allocation_credit_total_check,
drop constraint if exists content_purchases_allocation_version_check;

alter table public.content_purchases
add constraint content_purchases_horse_care_rate_check
check (horse_care_rate between 0 and 100),
add constraint content_purchases_tipster_rate_check
check (tipster_rate between 0 and 100),
add constraint content_purchases_horse_care_coins_check
check (horse_care_coins >= 0),
add constraint content_purchases_allocation_rate_total_check
check (commission_rate + horse_care_rate + tipster_rate = 100.00),
add constraint content_purchases_allocation_credit_total_check
check (platform_fee_coins + horse_care_coins + tipster_net_coins = purchased_coins),
add constraint content_purchases_allocation_version_check
check (btrim(allocation_version) <> '');

comment on column public.content_purchases.purchased_coins is
  'Cash-backed Credits consumed by this content purchase. The 10/20/70 split is calculated only when these Credits are used.';
comment on column public.content_purchases.reward_coins is
  'Promotional Credits consumed for access. Reward Credits are excluded from Horse Care, MRC, and tipster financial allocations.';
comment on column public.content_purchases.allocation_version is
  'Immutable revenue-allocation rule snapshotted when the content purchase is recorded.';

alter table public.tipster_earnings
add column if not exists horse_care_coins numeric(12, 2) not null default 0;

alter table public.tipster_earnings
drop constraint if exists tipster_earnings_entry_type_check;

alter table public.tipster_earnings
add constraint tipster_earnings_entry_type_check
check (entry_type in ('sale', 'refund', 'allocation_adjustment'));

with existing_allocations as (
  select
    purchase_id,
    coalesce(sum(platform_fee_coins), 0)::numeric(12, 2) as platform_fee_coins,
    coalesce(sum(horse_care_coins), 0)::numeric(12, 2) as horse_care_coins,
    coalesce(sum(net_coins), 0)::numeric(12, 2) as tipster_net_coins
  from public.tipster_earnings
  group by purchase_id
)
insert into public.tipster_earnings (
  tipster_id,
  purchase_id,
  entry_type,
  gross_coins,
  platform_fee_coins,
  horse_care_coins,
  net_coins,
  idempotency_key
)
select
  purchases.tipster_id,
  purchases.id,
  'allocation_adjustment',
  0,
  purchases.platform_fee_coins - coalesce(existing.platform_fee_coins, 0),
  purchases.horse_care_coins - coalesce(existing.horse_care_coins, 0),
  purchases.tipster_net_coins - coalesce(existing.tipster_net_coins, 0),
  'content-spend-10-20-70-adjustment:' || purchases.id::text
from public.content_purchases purchases
left join existing_allocations existing on existing.purchase_id = purchases.id
where purchases.status in ('active', 'disputed')
  and purchases.purchased_coins > 0
  and (
    purchases.platform_fee_coins <> coalesce(existing.platform_fee_coins, 0)
    or purchases.horse_care_coins <> coalesce(existing.horse_care_coins, 0)
    or purchases.tipster_net_coins <> coalesce(existing.tipster_net_coins, 0)
  )
on conflict (idempotency_key) do nothing;

comment on column public.tipster_earnings.horse_care_coins is
  'Horse Care allocation from Purchased Credits used on content. Reward Credits are excluded.';

alter table public.charity_contribution_entries
add column if not exists basis_purchased_coins numeric(12, 2),
add column if not exists allocation_version text not null default 'legacy-platform-commission-10pct';

alter table public.charity_contribution_entries
alter column allocation_version set default 'content-spend-10-20-70-v1';

alter table public.charity_contribution_entries
drop constraint if exists charity_contribution_entries_purchase_id_entry_type_key;

create unique index if not exists charity_contribution_entries_purchase_type_reason_key
on public.charity_contribution_entries (
  purchase_id,
  entry_type,
  coalesce(reason, '')
);

with settings as (
  select zar_per_coin
  from public.platform_settings
  where singleton = true
), current_contributions as (
  select
    purchase_id,
    coalesce(sum(amount_cents), 0)::integer as amount_cents
  from public.charity_contribution_entries
  group by purchase_id
), targets as (
  select
    purchases.id as purchase_id,
    purchases.purchased_coins,
    settings.zar_per_coin,
    round(purchases.horse_care_coins * settings.zar_per_coin * 100)::integer as target_cents,
    coalesce(current_contributions.amount_cents, 0) as current_cents
  from public.content_purchases purchases
  cross join settings
  left join current_contributions on current_contributions.purchase_id = purchases.id
  where purchases.status in ('active', 'disputed')
    and purchases.purchased_coins > 0
)
insert into public.charity_contribution_entries (
  purchase_id,
  entry_type,
  basis_platform_fee_coins,
  basis_purchased_coins,
  zar_per_coin,
  contribution_rate_bps,
  amount_cents,
  reason,
  allocation_version
)
select
  targets.purchase_id,
  'adjustment',
  0,
  targets.purchased_coins,
  targets.zar_per_coin,
  1000,
  targets.target_cents - targets.current_cents,
  'Reconcile active content spend to the 10% Horse Care allocation',
  'content-spend-10-20-70-v1'
from targets
where targets.target_cents <> targets.current_cents
on conflict do nothing;

create or replace function app_private.record_charity_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $record_charity_contribution$
declare
  coin_rate numeric(12, 4);
  contribution_cents integer;
begin
  select zar_per_coin into coin_rate
  from public.platform_settings
  where singleton = true;

  coin_rate := coalesce(coin_rate, 1.0000);

  if tg_op = 'INSERT'
    and new.status <> 'refunded'
    and new.horse_care_coins > 0
  then
    contribution_cents := round(new.horse_care_coins * coin_rate * 100)::integer;

    insert into public.charity_contribution_entries (
      purchase_id,
      entry_type,
      basis_platform_fee_coins,
      basis_purchased_coins,
      zar_per_coin,
      contribution_rate_bps,
      amount_cents,
      reason,
      allocation_version
    ) values (
      new.id,
      'accrual',
      new.platform_fee_coins,
      new.purchased_coins,
      coin_rate,
      round(new.horse_care_rate * 100)::integer,
      contribution_cents,
      'Horse Care allocation from Purchased Credits used on content',
      new.allocation_version
    ) on conflict do nothing;
  elsif tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status = 'refunded'
  then
    select coalesce(sum(entries.amount_cents), 0)::integer
    into contribution_cents
    from public.charity_contribution_entries entries
    where entries.purchase_id = new.id;

    if contribution_cents > 0 then
      insert into public.charity_contribution_entries (
        purchase_id,
        entry_type,
        basis_platform_fee_coins,
        basis_purchased_coins,
        zar_per_coin,
        contribution_rate_bps,
        amount_cents,
        reason,
        allocation_version
      ) values (
        new.id,
        'reversal',
        -new.platform_fee_coins,
        -new.purchased_coins,
        coin_rate,
        round(new.horse_care_rate * 100)::integer,
        -contribution_cents,
        'Exact Horse Care reversal for refunded content spend',
        new.allocation_version
      ) on conflict do nothing;
    end if;
  end if;

  return new;
end;
$record_charity_contribution$;

revoke all on function app_private.record_charity_contribution()
from public, anon, authenticated, service_role;

create or replace function public.get_charity_transparency()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $get_charity_transparency$
  with contribution as (
    select coalesce(sum(amount_cents), 0)::integer as accrued_cents
    from public.charity_contribution_entries
  ), remittance as (
    select
      coalesce(sum(amount_cents), 0)::integer as transferred_cents,
      max(transferred_on) as last_transferred_on
    from public.charity_remittances
  ), settings as (
    select horse_care_rate
    from public.platform_settings
    where singleton = true
  )
  select jsonb_build_object(
    'accruedCents', contribution.accrued_cents,
    'transferredCents', remittance.transferred_cents,
    'outstandingCents', greatest(contribution.accrued_cents - remittance.transferred_cents, 0),
    'lastTransferredOn', remittance.last_transferred_on,
    'contributionRatePercent', settings.horse_care_rate,
    'basis', 'Purchased Credits used on meeting cards and subscriptions; Reward Credits excluded',
    'updatedAt', now()
  )
  from contribution
  cross join remittance
  cross join settings;
$get_charity_transparency$;

revoke all on function public.get_charity_transparency() from public;
grant execute on function public.get_charity_transparency() to anon, authenticated;

create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_meeting_card_content_split$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase record;
  card_row public.tip_cards%rowtype;
  meeting_row public.race_meetings%rowtype;
  tipster_row public.tipsters%rowtype;
  allocation jsonb;
  revenue_split jsonb;
  purchased_used integer;
  reward_used integer;
  platform_rate numeric(5, 2);
  horse_care_rate_value numeric(5, 2);
  tipster_rate_value numeric(5, 2);
  platform_fee numeric(12, 2);
  horse_care_amount numeric(12, 2);
  tipster_net numeric(12, 2);
  allocation_version_value text;
  purchase_id uuid := gen_random_uuid();
  transaction_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required.';
  end if;

  select * into existing_purchase
  from public.content_purchases
  where user_id = current_user_id and idempotency_key = p_idempotency_key;

  if existing_purchase.id is not null then
    return jsonb_build_object('purchase', to_jsonb(existing_purchase), 'idempotent', true);
  end if;

  select * into card_row
  from public.tip_cards
  where id = p_tip_card_id
  for update;

  if card_row.id is null or card_row.status not in ('coming_soon', 'published') then
    raise exception 'This meeting card is not available for purchase.';
  end if;

  select * into meeting_row
  from public.race_meetings
  where id = card_row.meeting_id;

  if meeting_row.status <> 'scheduled'
    or meeting_row.first_race_at <= now() + interval '30 minutes'
  then
    raise exception 'This meeting card is closed 30 minutes before Race 1.';
  end if;
  if meeting_row.is_test and not app_private.user_has_test_access(current_user_id) then
    raise exception 'This test meeting is not available to this account.';
  end if;

  if exists (
    select 1
    from public.content_purchases
    where user_id = current_user_id
      and tip_card_id = card_row.id
      and status in ('active', 'disputed')
  ) then
    raise exception 'This meeting card is already unlocked.';
  end if;

  select * into tipster_row
  from public.tipsters
  where id = card_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  allocation := app_private.allocate_wallet_spend(current_user_id, card_row.coin_price);
  purchased_used := (allocation ->> 'purchasedUsed')::integer;
  reward_used := (allocation ->> 'rewardUsed')::integer;
  revenue_split := app_private.calculate_content_spend_split(purchased_used);
  platform_rate := (revenue_split ->> 'platformRate')::numeric;
  horse_care_rate_value := (revenue_split ->> 'horseCareRate')::numeric;
  tipster_rate_value := (revenue_split ->> 'tipsterRate')::numeric;
  platform_fee := (revenue_split ->> 'platformCredits')::numeric;
  horse_care_amount := (revenue_split ->> 'horseCareCredits')::numeric;
  tipster_net := (revenue_split ->> 'tipsterCredits')::numeric;
  allocation_version_value := revenue_split ->> 'allocationVersion';

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    purchased_amount,
    reward_amount,
    purchased_balance_after,
    reward_balance_after,
    reason,
    idempotency_key,
    created_by
  ) values (
    transaction_id,
    current_user_id,
    'unlock',
    -card_row.coin_price,
    (allocation ->> 'balance')::integer,
    -purchased_used,
    -reward_used,
    (allocation ->> 'purchasedBalance')::integer,
    (allocation ->> 'rewardBalance')::integer,
    'Meeting card purchase: ' || card_row.title,
    'meeting-purchase:' || purchase_id::text,
    current_user_id
  );

  insert into public.content_purchases (
    id,
    user_id,
    tipster_id,
    purchase_type,
    tip_card_id,
    gross_coins,
    purchased_coins,
    reward_coins,
    commission_rate,
    horse_care_rate,
    tipster_rate,
    platform_fee_coins,
    horse_care_coins,
    tipster_net_coins,
    allocation_version,
    idempotency_key,
    credit_transaction_id
  ) values (
    purchase_id,
    current_user_id,
    card_row.tipster_id,
    'meeting',
    card_row.id,
    card_row.coin_price,
    purchased_used,
    reward_used,
    platform_rate,
    horse_care_rate_value,
    tipster_rate_value,
    platform_fee,
    horse_care_amount,
    tipster_net,
    allocation_version_value,
    p_idempotency_key,
    transaction_id
  );

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id
  ) values (
    current_user_id,
    card_row.id,
    'meeting',
    purchase_id
  );

  if purchased_used > 0 then
    insert into public.tipster_earnings (
      tipster_id,
      purchase_id,
      entry_type,
      gross_coins,
      platform_fee_coins,
      horse_care_coins,
      net_coins,
      idempotency_key
    ) values (
      card_row.tipster_id,
      purchase_id,
      'sale',
      purchased_used,
      platform_fee,
      horse_care_amount,
      tipster_net,
      'sale:' || purchase_id::text
    );
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    'meeting_card_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'tipCardId', card_row.id,
      'grossCoins', card_row.coin_price,
      'purchasedCoins', purchased_used,
      'rewardCoinsExcluded', reward_used,
      'allocationVersion', allocation_version_value,
      'platformRate', platform_rate,
      'horseCareRate', horse_care_rate_value,
      'tipsterRate', tipster_rate_value
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'walletBalance', (allocation ->> 'balance')::integer,
    'purchasedBalance', (allocation ->> 'purchasedBalance')::integer,
    'rewardBalance', (allocation ->> 'rewardBalance')::integer,
    'grossCoins', card_row.coin_price,
    'purchasedCoins', purchased_used,
    'rewardCoins', reward_used,
    'platformFeeCoins', platform_fee,
    'horseCareCoins', horse_care_amount,
    'tipsterNetCoins', tipster_net,
    'allocationVersion', allocation_version_value
  );
end;
$purchase_meeting_card_content_split$;

revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon, authenticated;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription_content_split$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase record;
  package_row public.tipster_packages%rowtype;
  tipster_row public.tipsters%rowtype;
  allocation jsonb;
  revenue_split jsonb;
  purchased_used integer;
  reward_used integer;
  platform_rate numeric(5, 2);
  horse_care_rate_value numeric(5, 2);
  tipster_rate_value numeric(5, 2);
  platform_fee numeric(12, 2);
  horse_care_amount numeric(12, 2);
  tipster_net numeric(12, 2);
  allocation_version_value text;
  purchase_id uuid := gen_random_uuid();
  transaction_id uuid := gen_random_uuid();
  subscription_id uuid := gen_random_uuid();
  subscription_start timestamptz;
  subscription_end timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required.';
  end if;

  select * into existing_purchase
  from public.content_purchases
  where user_id = current_user_id
    and idempotency_key = p_idempotency_key;

  if existing_purchase.id is not null then
    return jsonb_build_object('purchase', to_jsonb(existing_purchase), 'idempotent', true);
  end if;

  select * into package_row
  from public.tipster_packages
  where id = p_package_id
    and is_active = true
  for update;

  if package_row.id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  select * into tipster_row
  from public.tipsters
  where id = package_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  select greatest(now(), coalesce(max(ends_at), now()))
  into subscription_start
  from public.tipster_subscriptions
  where user_id = current_user_id
    and tipster_id = package_row.tipster_id
    and status = 'active';

  subscription_end := subscription_start + make_interval(months => package_row.duration_months);

  allocation := app_private.allocate_wallet_spend_reward_first(
    current_user_id,
    package_row.coin_price
  );
  purchased_used := (allocation ->> 'purchasedUsed')::integer;
  reward_used := (allocation ->> 'rewardUsed')::integer;
  revenue_split := app_private.calculate_content_spend_split(purchased_used);
  platform_rate := (revenue_split ->> 'platformRate')::numeric;
  horse_care_rate_value := (revenue_split ->> 'horseCareRate')::numeric;
  tipster_rate_value := (revenue_split ->> 'tipsterRate')::numeric;
  platform_fee := (revenue_split ->> 'platformCredits')::numeric;
  horse_care_amount := (revenue_split ->> 'horseCareCredits')::numeric;
  tipster_net := (revenue_split ->> 'tipsterCredits')::numeric;
  allocation_version_value := revenue_split ->> 'allocationVersion';

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    purchased_amount,
    reward_amount,
    purchased_balance_after,
    reward_balance_after,
    reason,
    idempotency_key,
    created_by
  ) values (
    transaction_id,
    current_user_id,
    'unlock',
    -package_row.coin_price,
    (allocation ->> 'balance')::integer,
    -purchased_used,
    -reward_used,
    (allocation ->> 'purchasedBalance')::integer,
    (allocation ->> 'rewardBalance')::integer,
    'Tipster subscription: ' || package_row.name,
    'subscription-purchase:' || purchase_id::text,
    current_user_id
  );

  insert into public.content_purchases (
    id,
    user_id,
    tipster_id,
    purchase_type,
    tipster_package_id,
    gross_coins,
    purchased_coins,
    reward_coins,
    commission_rate,
    horse_care_rate,
    tipster_rate,
    platform_fee_coins,
    horse_care_coins,
    tipster_net_coins,
    allocation_version,
    idempotency_key,
    credit_transaction_id
  ) values (
    purchase_id,
    current_user_id,
    package_row.tipster_id,
    'subscription',
    package_row.id,
    package_row.coin_price,
    purchased_used,
    reward_used,
    platform_rate,
    horse_care_rate_value,
    tipster_rate_value,
    platform_fee,
    horse_care_amount,
    tipster_net,
    allocation_version_value,
    p_idempotency_key,
    transaction_id
  );

  insert into public.tipster_subscriptions (
    id,
    purchase_id,
    user_id,
    tipster_id,
    package_id,
    starts_at,
    ends_at
  ) values (
    subscription_id,
    purchase_id,
    current_user_id,
    package_row.tipster_id,
    package_row.id,
    subscription_start,
    subscription_end
  );

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id,
    source_subscription_id
  )
  select
    current_user_id,
    cards.id,
    'subscription',
    purchase_id,
    subscription_id
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.tipster_id = package_row.tipster_id
    and cards.status in ('coming_soon', 'published')
    and meetings.first_race_at >= subscription_start
    and meetings.first_race_at < subscription_end
    and (not meetings.is_test or app_private.user_has_test_access(current_user_id))
  on conflict do nothing;

  if purchased_used > 0 then
    insert into public.tipster_earnings (
      tipster_id,
      purchase_id,
      entry_type,
      gross_coins,
      platform_fee_coins,
      horse_care_coins,
      net_coins,
      idempotency_key
    ) values (
      package_row.tipster_id,
      purchase_id,
      'sale',
      purchased_used,
      platform_fee,
      horse_care_amount,
      tipster_net,
      'sale:' || purchase_id::text
    );
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    'tipster_subscription_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'packageId', package_row.id,
      'startsAt', subscription_start,
      'endsAt', subscription_end,
      'grossCoins', package_row.coin_price,
      'purchasedCoins', purchased_used,
      'rewardCoinsExcluded', reward_used,
      'spendPriority', 'reward_first',
      'allocationVersion', allocation_version_value,
      'platformRate', platform_rate,
      'horseCareRate', horse_care_rate_value,
      'tipsterRate', tipster_rate_value
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'subscriptionId', subscription_id,
    'startsAt', subscription_start,
    'endsAt', subscription_end,
    'spendPriority', 'reward_first',
    'walletBalance', (allocation ->> 'balance')::integer,
    'purchasedBalance', (allocation ->> 'purchasedBalance')::integer,
    'rewardBalance', (allocation ->> 'rewardBalance')::integer,
    'purchasedCoins', purchased_used,
    'rewardCoins', reward_used,
    'platformFeeCoins', platform_fee,
    'horseCareCoins', horse_care_amount,
    'tipsterNetCoins', tipster_net,
    'allocationVersion', allocation_version_value
  );
end;
$purchase_tipster_subscription_content_split$;

revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated;

create or replace function app_private.refund_content_purchase(
  target_purchase_id uuid,
  refund_reason text,
  refund_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $refund_content_purchase_content_split$
declare
  current_user_id uuid := (select auth.uid());
  purchase_row record;
  wallet_row record;
  refund_transaction_id uuid := gen_random_uuid();
begin
  if current_user_id is null
    or refund_actor_id is distinct from current_user_id
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator approval is required.';
  end if;

  if not exists (
    select 1
    from public.purchase_disputes disputes
    where disputes.purchase_id = target_purchase_id
      and disputes.status = 'approved'
      and disputes.resolved_by = current_user_id
  ) then
    raise exception 'An approved client refund request is required.';
  end if;

  select * into purchase_row
  from public.content_purchases
  where id = target_purchase_id
  for update;

  if purchase_row.id is null then
    raise exception 'Purchase not found.';
  end if;
  if purchase_row.status = 'refunded' then
    return false;
  end if;
  if purchase_row.status <> 'disputed' then
    raise exception 'Only a disputed purchase can be refunded.';
  end if;

  insert into public.wallets (user_id)
  values (purchase_row.user_id)
  on conflict (user_id) do nothing;

  update public.wallets
  set
    purchased_balance = purchased_balance + purchase_row.purchased_coins,
    reward_balance = reward_balance + purchase_row.reward_coins,
    balance = balance + purchase_row.gross_coins,
    updated_at = now()
  where user_id = purchase_row.user_id
  returning * into wallet_row;

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    purchased_amount,
    reward_amount,
    purchased_balance_after,
    reward_balance_after,
    reason,
    idempotency_key,
    created_by
  ) values (
    refund_transaction_id,
    purchase_row.user_id,
    'refund',
    purchase_row.gross_coins,
    wallet_row.balance,
    purchase_row.purchased_coins,
    purchase_row.reward_coins,
    wallet_row.purchased_balance,
    wallet_row.reward_balance,
    refund_reason,
    'content-refund:' || purchase_row.id::text,
    refund_actor_id
  ) on conflict (idempotency_key) do nothing;

  update public.content_purchases
  set
    status = 'refunded',
    refunded_at = now()
  where id = purchase_row.id;

  update public.tip_card_entitlements
  set revoked_at = now()
  where source_purchase_id = purchase_row.id
    and revoked_at is null;

  update public.tipster_subscriptions
  set status = 'refunded'
  where purchase_id = purchase_row.id;

  if purchase_row.purchased_coins > 0 then
    insert into public.tipster_earnings (
      tipster_id,
      purchase_id,
      entry_type,
      gross_coins,
      platform_fee_coins,
      horse_care_coins,
      net_coins,
      idempotency_key
    ) values (
      purchase_row.tipster_id,
      purchase_row.id,
      'refund',
      -purchase_row.purchased_coins,
      -purchase_row.platform_fee_coins,
      -purchase_row.horse_care_coins,
      -purchase_row.tipster_net_coins,
      'refund:' || purchase_row.id::text
    ) on conflict (idempotency_key) do nothing;
  end if;

  insert into public.notifications (user_id, title, body)
  values (
    purchase_row.user_id,
    'Refund approved',
    purchase_row.gross_coins::text || ' Credits were returned to your wallet after administrator approval.'
  );

  perform app_private.enqueue_notification(
    purchase_row.user_id,
    'purchase_refunded',
    'purchase:' || purchase_row.id::text || ':refund:email',
    jsonb_build_object(
      'template', 'purchase_refunded',
      'purchaseId', purchase_row.id,
      'coins', purchase_row.gross_coins,
      'purchasedCoins', purchase_row.purchased_coins,
      'rewardCoins', purchase_row.reward_coins,
      'reason', 'Your refund request was approved by an administrator.',
      'clientUrl', 'https://www.mrcracing.co.za/client/'
    )
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    refund_actor_id,
    'content_purchase_refunded',
    'content_purchase',
    purchase_row.id,
    jsonb_build_object(
      'reason', refund_reason,
      'coins', purchase_row.gross_coins,
      'purchasedCoins', purchase_row.purchased_coins,
      'rewardCoins', purchase_row.reward_coins,
      'platformCreditsReversed', purchase_row.platform_fee_coins,
      'horseCareCreditsReversed', purchase_row.horse_care_coins,
      'tipsterCreditsReversed', purchase_row.tipster_net_coins,
      'approvalRequired', true
    )
  );

  return true;
end;
$refund_content_purchase_content_split$;

revoke all on function app_private.refund_content_purchase(uuid, text, uuid)
from public, anon, authenticated, service_role;

drop function if exists public.get_my_tipster_earnings_ledger_v2(integer);

create function public.get_my_tipster_earnings_ledger_v2(
  p_limit integer default 20
)
returns table (
  id uuid,
  entry_type text,
  purchase_type text,
  source_label text,
  purchaser_email text,
  gross_coins numeric,
  platform_fee_coins numeric,
  horse_care_coins numeric,
  net_coins numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $get_my_tipster_earnings_ledger_v2_content_split$
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
    nullif(lower(btrim(purchasers.email)), ''),
    earnings.gross_coins,
    earnings.platform_fee_coins,
    earnings.horse_care_coins,
    earnings.net_coins,
    earnings.created_at
  from public.tipster_earnings earnings
  join public.tipsters tipsters
    on tipsters.id = earnings.tipster_id
   and tipsters.user_id = current_user_id
  join public.content_purchases purchases on purchases.id = earnings.purchase_id
  left join auth.users purchasers on purchasers.id = purchases.user_id
  left join public.tip_cards cards on cards.id = purchases.tip_card_id
  left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
  order by earnings.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$get_my_tipster_earnings_ledger_v2_content_split$;

revoke all on function public.get_my_tipster_earnings_ledger_v2(integer)
from public, anon, authenticated;
grant execute on function public.get_my_tipster_earnings_ledger_v2(integer)
to authenticated;

create or replace function public.admin_list_internal_tipster_ledger(
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $admin_list_internal_tipster_ledger_content_split$
declare
  current_user_id uuid := (select auth.uid());
  requested_page integer := greatest(coalesce(p_page, 1), 1);
  requested_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with page_rows as (
    select
      earnings.id,
      earnings.purchase_id,
      earnings.created_at,
      purchases.created_at as purchase_created_at,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.commission_rate,
      purchases.horse_care_rate,
      purchases.tipster_rate,
      earnings.entry_type,
      case
        when earnings.entry_type = 'allocation_adjustment' then 0
        when earnings.entry_type = 'refund' then -purchases.gross_coins
        else purchases.gross_coins
      end as total_credits,
      case
        when earnings.entry_type = 'allocation_adjustment' then 0
        when earnings.entry_type = 'refund' then -purchases.purchased_coins
        else purchases.purchased_coins
      end as purchased_credits,
      case
        when earnings.entry_type = 'allocation_adjustment' then 0
        when earnings.entry_type = 'refund' then -purchases.reward_coins
        else purchases.reward_coins
      end as reward_credits,
      earnings.gross_coins as earning_gross_credits,
      earnings.platform_fee_coins,
      earnings.horse_care_coins,
      earnings.net_coins,
      client_users.email::text as client_email,
      coalesce(
        nullif(btrim(client_profiles.display_name), ''),
        nullif(btrim(concat_ws(' ', client_profiles.first_name, client_profiles.last_name)), '')
      ) as client_name,
      tipsters.display_name as tipster_name,
      tipster_users.email::text as tipster_email,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label,
      case
        when earnings.idempotency_key like 'legacy-auto-refund-correction-sale:%'
          then 'legacy_refund_correction'
        when earnings.entry_type <> 'refund' then null
        when approved_disputes.id is not null then 'admin_approved'
        when refund_audits.actor_id is null then 'legacy_automatic'
        else 'legacy_manual'
      end as refund_origin
    from public.tipster_earnings earnings
    join public.content_purchases purchases on purchases.id = earnings.purchase_id
    join auth.users client_users on client_users.id = purchases.user_id
    left join public.profiles client_profiles on client_profiles.id = purchases.user_id
    join public.tipsters tipsters on tipsters.id = earnings.tipster_id
    left join auth.users tipster_users on tipster_users.id = tipsters.user_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    left join lateral (
      select disputes.id
      from public.purchase_disputes disputes
      where disputes.purchase_id = purchases.id
        and disputes.status = 'approved'
      order by disputes.resolved_at desc nulls last
      limit 1
    ) approved_disputes on true
    left join lateral (
      select logs.actor_id
      from public.audit_logs logs
      where logs.entity_type = 'content_purchase'
        and logs.entity_id = purchases.id
        and logs.action = 'content_purchase_refunded'
      order by logs.created_at desc
      limit 1
    ) refund_audits on true
    order by earnings.created_at desc, earnings.id desc
    offset (requested_page - 1) * requested_page_size
    limit requested_page_size
  )
  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', page_rows.id,
            'purchaseId', page_rows.purchase_id,
            'createdAt', page_rows.created_at,
            'purchaseCreatedAt', page_rows.purchase_created_at,
            'purchaseType', page_rows.purchase_type,
            'purchaseStatus', page_rows.purchase_status,
            'sourceLabel', page_rows.source_label,
            'entryType', page_rows.entry_type,
            'refundOrigin', page_rows.refund_origin,
            'clientEmail', page_rows.client_email,
            'clientName', page_rows.client_name,
            'tipsterEmail', page_rows.tipster_email,
            'tipsterName', page_rows.tipster_name,
            'grossCredits', page_rows.total_credits,
            'purchasedCredits', page_rows.purchased_credits,
            'rewardCredits', page_rows.reward_credits,
            'earningGrossCredits', page_rows.earning_gross_credits,
            'platformRate', page_rows.commission_rate,
            'horseCareRate', page_rows.horse_care_rate,
            'tipsterRate', page_rows.tipster_rate,
            'commissionRate', page_rows.commission_rate,
            'platformFeeCredits', page_rows.platform_fee_coins,
            'horseCareCredits', page_rows.horse_care_coins,
            'tipsterNetCredits', page_rows.net_coins
          )
          order by page_rows.created_at desc, page_rows.id desc
        )
        from page_rows
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from public.tipster_earnings),
    'page', requested_page,
    'pageSize', requested_page_size
  )
  into result;

  return result;
end;
$admin_list_internal_tipster_ledger_content_split$;

revoke all on function public.admin_list_internal_tipster_ledger(integer, integer)
from public, anon, authenticated;
grant execute on function public.admin_list_internal_tipster_ledger(integer, integer)
to authenticated;

create or replace function public.admin_get_revenue_split_report(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $admin_get_revenue_split_report$
declare
  current_user_id uuid := (select auth.uid());
  requested_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with eligible_purchases as (
    select *
    from public.content_purchases
    where status in ('active', 'disputed')
  ), summary as (
    select
      count(*)::integer as purchase_count,
      count(*) filter (where status = 'disputed')::integer as disputed_count,
      coalesce(sum(gross_coins), 0)::numeric(14, 2) as content_credits_used,
      coalesce(sum(purchased_coins), 0)::numeric(14, 2) as purchased_credits_used,
      coalesce(sum(reward_coins), 0)::numeric(14, 2) as reward_credits_excluded,
      coalesce(sum(horse_care_coins), 0)::numeric(14, 2) as horse_care_credits,
      coalesce(sum(platform_fee_coins), 0)::numeric(14, 2) as platform_credits,
      coalesce(sum(tipster_net_coins), 0)::numeric(14, 2) as tipster_credits
    from eligible_purchases
  ), by_tipster_rows as (
    select
      tipsters.id as tipster_id,
      tipsters.display_name,
      count(*)::integer as purchase_count,
      coalesce(sum(purchases.gross_coins), 0)::numeric(14, 2) as content_credits_used,
      coalesce(sum(purchases.purchased_coins), 0)::numeric(14, 2) as purchased_credits_used,
      coalesce(sum(purchases.reward_coins), 0)::numeric(14, 2) as reward_credits_excluded,
      coalesce(sum(purchases.horse_care_coins), 0)::numeric(14, 2) as horse_care_credits,
      coalesce(sum(purchases.platform_fee_coins), 0)::numeric(14, 2) as platform_credits,
      coalesce(sum(purchases.tipster_net_coins), 0)::numeric(14, 2) as tipster_credits
    from eligible_purchases purchases
    join public.tipsters tipsters on tipsters.id = purchases.tipster_id
    group by tipsters.id, tipsters.display_name
  ), recent_rows as (
    select
      purchases.id,
      purchases.created_at,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as status,
      purchases.gross_coins,
      purchases.purchased_coins,
      purchases.reward_coins,
      purchases.horse_care_coins,
      purchases.platform_fee_coins,
      purchases.tipster_net_coins,
      purchases.allocation_version,
      tipsters.display_name as tipster_name,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label
    from public.content_purchases purchases
    join public.tipsters tipsters on tipsters.id = purchases.tipster_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    order by purchases.created_at desc, purchases.id desc
    limit requested_limit
  )
  select jsonb_build_object(
    'policy', jsonb_build_object(
      'trigger', 'content_spend',
      'allocationVersion', 'content-spend-10-20-70-v1',
      'horseCareRate', settings.horse_care_rate,
      'platformRate', settings.commission_rate,
      'tipsterRate', settings.tipster_rate,
      'rewardCreditsExcluded', true,
      'creditTopUpsExcluded', true
    ),
    'summary', jsonb_build_object(
      'purchaseCount', summary.purchase_count,
      'disputedCount', summary.disputed_count,
      'refundedPurchaseCount', (
        select count(*)
        from public.content_purchases
        where status = 'refunded'
      ),
      'contentCreditsUsed', summary.content_credits_used,
      'purchasedCreditsUsed', summary.purchased_credits_used,
      'rewardCreditsExcluded', summary.reward_credits_excluded,
      'horseCareCredits', summary.horse_care_credits,
      'platformCredits', summary.platform_credits,
      'tipsterCredits', summary.tipster_credits,
      'allocatedCredits', summary.horse_care_credits + summary.platform_credits + summary.tipster_credits,
      'reconciliationDifference', summary.purchased_credits_used - summary.horse_care_credits - summary.platform_credits - summary.tipster_credits
    ),
    'byTipster', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'tipsterId', rows.tipster_id,
            'tipsterName', rows.display_name,
            'purchaseCount', rows.purchase_count,
            'contentCreditsUsed', rows.content_credits_used,
            'purchasedCreditsUsed', rows.purchased_credits_used,
            'rewardCreditsExcluded', rows.reward_credits_excluded,
            'horseCareCredits', rows.horse_care_credits,
            'platformCredits', rows.platform_credits,
            'tipsterCredits', rows.tipster_credits
          )
          order by rows.tipster_credits desc, rows.display_name
        )
        from by_tipster_rows rows
      ),
      '[]'::jsonb
    ),
    'recent', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'purchaseId', rows.id,
            'createdAt', rows.created_at,
            'purchaseType', rows.purchase_type,
            'status', rows.status,
            'tipsterName', rows.tipster_name,
            'sourceLabel', rows.source_label,
            'contentCreditsUsed', rows.gross_coins,
            'purchasedCreditsUsed', rows.purchased_coins,
            'rewardCreditsExcluded', rows.reward_coins,
            'horseCareCredits', rows.horse_care_coins,
            'platformCredits', rows.platform_fee_coins,
            'tipsterCredits', rows.tipster_net_coins,
            'allocationVersion', rows.allocation_version
          )
          order by rows.created_at desc, rows.id desc
        )
        from recent_rows rows
      ),
      '[]'::jsonb
    ),
    'generatedAt', now()
  )
  into result
  from public.platform_settings settings
  cross join summary
  where settings.singleton = true;

  return result;
end;
$admin_get_revenue_split_report$;

revoke all on function public.admin_get_revenue_split_report(integer)
from public, anon, authenticated;
grant execute on function public.admin_get_revenue_split_report(integer)
to authenticated;

comment on function public.admin_get_revenue_split_report(integer) is
  'Returns an MFA-protected administrator report for the 10/20/70 split applied only when Purchased Credits are used on meeting cards or subscriptions.';
