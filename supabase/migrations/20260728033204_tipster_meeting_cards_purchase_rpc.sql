create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
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
  card_row public.tip_cards%rowtype;
  meeting_row public.race_meetings%rowtype;
  tipster_row public.tipsters%rowtype;
  wallet_balance integer;
  commission numeric(5, 2);
  platform_fee numeric(12, 2);
  tipster_net numeric(12, 2);
  purchase_id uuid := gen_random_uuid();
  transaction_id uuid := gen_random_uuid();
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
  into card_row
  from public.tip_cards
  where id = p_tip_card_id
  for update;

  if card_row.id is null
    or card_row.status not in ('coming_soon', 'published')
  then
    raise exception 'This meeting card is not available for purchase.';
  end if;

  select *
  into meeting_row
  from public.race_meetings
  where id = card_row.meeting_id;

  if meeting_row.status <> 'scheduled' or meeting_row.last_race_at <= now() then
    raise exception 'This meeting is no longer available for purchase.';
  end if;

  if meeting_row.is_test
    and not app_private.user_has_test_access(current_user_id)
  then
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

  select *
  into tipster_row
  from public.tipsters
  where id = card_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  select balance
  into wallet_balance
  from public.wallets
  where user_id = current_user_id
  for update;

  if coalesce(wallet_balance, 0) < card_row.coin_price then
    raise exception 'Insufficient coin balance.';
  end if;

  select coalesce(
    tipster_row.commission_rate_override,
    (select commission_rate from public.platform_settings where singleton = true)
  )
  into commission;

  platform_fee := round(card_row.coin_price * commission / 100.0, 2);
  tipster_net := round(card_row.coin_price - platform_fee, 2);
  wallet_balance := wallet_balance - card_row.coin_price;

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
    -card_row.coin_price,
    wallet_balance,
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
    commission_rate,
    platform_fee_coins,
    tipster_net_coins,
    idempotency_key,
    credit_transaction_id
  )
  values (
    purchase_id,
    current_user_id,
    card_row.tipster_id,
    'meeting',
    card_row.id,
    card_row.coin_price,
    commission,
    platform_fee,
    tipster_net,
    p_idempotency_key,
    transaction_id
  );

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id
  )
  values (
    current_user_id,
    card_row.id,
    'meeting',
    purchase_id
  );

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
    card_row.tipster_id,
    purchase_id,
    'sale',
    card_row.coin_price,
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
    'meeting_card_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'tipCardId', card_row.id,
      'grossCoins', card_row.coin_price,
      'commissionRate', commission
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'walletBalance', wallet_balance,
    'grossCoins', card_row.coin_price,
    'platformFeeCoins', platform_fee,
    'tipsterNetCoins', tipster_net
  );
end;
$$;

;
