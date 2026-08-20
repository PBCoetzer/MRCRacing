-- Subscriptions consume promotional Reward Credits before purchased Credits.
-- Meeting-card purchases intentionally retain their existing purchased-first order.

create or replace function app_private.allocate_wallet_spend_reward_first(
  target_user_id uuid,
  requested_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $allocate_wallet_spend_reward_first$
declare
  wallet_row record;
  purchased_used integer;
  reward_used integer;
begin
  if target_user_id is null then
    raise exception 'A wallet owner is required.';
  end if;
  if requested_amount is null or requested_amount <= 0 then
    raise exception 'Credit spend must be greater than zero.';
  end if;

  insert into public.wallets (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;

  select * into wallet_row
  from public.wallets
  where user_id = target_user_id
  for update;

  if wallet_row.balance < requested_amount then
    raise exception 'Insufficient Credit balance.';
  end if;

  reward_used := least(wallet_row.reward_balance, requested_amount);
  purchased_used := requested_amount - reward_used;

  update public.wallets
  set
    purchased_balance = purchased_balance - purchased_used,
    reward_balance = reward_balance - reward_used,
    balance = balance - requested_amount,
    updated_at = now()
  where user_id = target_user_id
  returning * into wallet_row;

  return jsonb_build_object(
    'spendPriority', 'reward_first',
    'purchasedUsed', purchased_used,
    'rewardUsed', reward_used,
    'balance', wallet_row.balance,
    'purchasedBalance', wallet_row.purchased_balance,
    'rewardBalance', wallet_row.reward_balance
  );
end;
$allocate_wallet_spend_reward_first$;

revoke all on function app_private.allocate_wallet_spend_reward_first(uuid, integer)
from public, anon, authenticated, service_role;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription_reward_first$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase record;
  package_row public.tipster_packages%rowtype;
  tipster_row public.tipsters%rowtype;
  allocation jsonb;
  purchased_used integer;
  reward_used integer;
  commission numeric(5, 2);
  platform_fee numeric(12, 2);
  tipster_net numeric(12, 2);
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
  where user_id = current_user_id and idempotency_key = p_idempotency_key;
  if existing_purchase.id is not null then
    return jsonb_build_object('purchase', to_jsonb(existing_purchase), 'idempotent', true);
  end if;

  select * into package_row
  from public.tipster_packages
  where id = p_package_id and is_active = true
  for update;
  if package_row.id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  select * into tipster_row
  from public.tipsters
  where id = package_row.tipster_id and is_verified = true;
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

  select coalesce(
    tipster_row.commission_rate_override,
    (select commission_rate from public.platform_settings where singleton = true)
  ) into commission;
  platform_fee := round(purchased_used * commission / 100.0, 2);
  tipster_net := round(purchased_used - platform_fee, 2);

  insert into public.credit_transactions (
    id, user_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key, created_by
  ) values (
    transaction_id, current_user_id, 'unlock', -package_row.coin_price,
    (allocation ->> 'balance')::integer,
    -purchased_used, -reward_used,
    (allocation ->> 'purchasedBalance')::integer,
    (allocation ->> 'rewardBalance')::integer,
    'Tipster subscription: ' || package_row.name,
    'subscription-purchase:' || purchase_id::text, current_user_id
  );

  insert into public.content_purchases (
    id, user_id, tipster_id, purchase_type, tipster_package_id, gross_coins,
    purchased_coins, reward_coins, commission_rate, platform_fee_coins,
    tipster_net_coins, idempotency_key, credit_transaction_id
  ) values (
    purchase_id, current_user_id, package_row.tipster_id, 'subscription',
    package_row.id, package_row.coin_price, purchased_used, reward_used,
    commission, platform_fee, tipster_net, p_idempotency_key, transaction_id
  );

  insert into public.tipster_subscriptions (
    id, purchase_id, user_id, tipster_id, package_id, starts_at, ends_at
  ) values (
    subscription_id, purchase_id, current_user_id, package_row.tipster_id,
    package_row.id, subscription_start, subscription_end
  );

  insert into public.tip_card_entitlements (
    user_id, tip_card_id, source_type, source_purchase_id, source_subscription_id
  )
  select current_user_id, cards.id, 'subscription', purchase_id, subscription_id
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
      tipster_id, purchase_id, entry_type, gross_coins, platform_fee_coins,
      net_coins, idempotency_key
    ) values (
      package_row.tipster_id, purchase_id, 'sale', purchased_used,
      platform_fee, tipster_net, 'sale:' || purchase_id::text
    );
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id, 'tipster_subscription_purchased', 'content_purchase', purchase_id,
    jsonb_build_object(
      'packageId', package_row.id,
      'startsAt', subscription_start,
      'endsAt', subscription_end,
      'grossCoins', package_row.coin_price,
      'purchasedCoins', purchased_used,
      'rewardCoins', reward_used,
      'spendPriority', 'reward_first',
      'commissionRate', commission
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
    'rewardCoins', reward_used
  );
end;
$purchase_tipster_subscription_reward_first$;

revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon;
grant execute on function public.purchase_tipster_subscription(uuid, text)
to authenticated;

comment on function app_private.allocate_wallet_spend_reward_first(uuid, integer) is
  'Atomically spends Reward Credits before purchased Credits for tipster subscriptions.';
