create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase public.content_purchases%rowtype;
  package_row public.tipster_packages%rowtype;
  tipster_row public.tipsters%rowtype;
  wallet_balance integer;
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

  select *
  into existing_purchase
  from public.content_purchases
  where user_id = current_user_id
    and idempotency_key = p_idempotency_key;

  if existing_purchase.id is not null then
    return jsonb_build_object(
      'purchase', to_jsonb(existing_purchase),
      'idempotent', true
    );
  end if;

  select *
  into package_row
  from public.tipster_packages
  where id = p_package_id
    and is_active = true
  for update;

  if package_row.id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  select *
  into tipster_row
  from public.tipsters
  where id = package_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  select balance
  into wallet_balance
  from public.wallets
  where user_id = current_user_id
  for update;

  if coalesce(wallet_balance, 0) < package_row.coin_price then
    raise exception 'Insufficient coin balance.';
  end if;

  select greatest(
    now(),
    coalesce(max(ends_at), now())
  )
  into subscription_start
  from public.tipster_subscriptions
  where user_id = current_user_id
    and tipster_id = package_row.tipster_id
    and status = 'active';

  subscription_end := subscription_start + make_interval(months => package_row.duration_months);

  select coalesce(
    tipster_row.commission_rate_override,
    (select commission_rate from public.platform_settings where singleton = true)
  )
  into commission;

  platform_fee := round(package_row.coin_price * commission / 100.0, 2);
  tipster_net := round(package_row.coin_price - platform_fee, 2);
  wallet_balance := wallet_balance - package_row.coin_price;

  update public.wallets
  set balance = wallet_balance
  where user_id = current_user_id;

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    reason,
    idempotency_key,
    created_by
  )
  values (
    transaction_id,
    current_user_id,
    'unlock',
    -package_row.coin_price,
    wallet_balance,
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
    commission_rate,
    platform_fee_coins,
    tipster_net_coins,
    idempotency_key,
    credit_transaction_id
  )
  values (
    purchase_id,
    current_user_id,
    package_row.tipster_id,
    'subscription',
    package_row.id,
    package_row.coin_price,
    commission,
    platform_fee,
    tipster_net,
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
  )
  values (
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
    c.id,
    'subscription',
    purchase_id,
    subscription_id
  from public.tip_cards c
  join public.race_meetings m on m.id = c.meeting_id
  where c.tipster_id = package_row.tipster_id
    and c.status in ('coming_soon', 'published')
    and m.first_race_at >= subscription_start
    and m.first_race_at < subscription_end
    and (
      m.is_test = false
      or app_private.user_has_test_access(current_user_id)
    )
  on conflict do nothing;

  insert into public.tipster_earnings (
    tipster_id,
    purchase_id,
    entry_type,
    gross_coins,
    platform_fee_coins,
    net_coins,
    idempotency_key
  )
  values (
    package_row.tipster_id,
    purchase_id,
    'sale',
    package_row.coin_price,
    platform_fee,
    tipster_net,
    'sale:' || purchase_id::text
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'tipster_subscription_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'packageId', package_row.id,
      'startsAt', subscription_start,
      'endsAt', subscription_end,
      'grossCoins', package_row.coin_price,
      'commissionRate', commission
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'subscriptionId', subscription_id,
    'startsAt', subscription_start,
    'endsAt', subscription_end,
    'walletBalance', wallet_balance
  );
end;
$$;

;
