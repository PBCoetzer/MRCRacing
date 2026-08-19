-- Purchased/reward Credit separation, explicit race skips, and SMSFlow outbox support.

-- These existing functions declare table %rowtype variables. PostgreSQL recompiles those
-- declarations while the underlying composite types are altered, before the final function
-- definitions below can be installed. Replace them with transaction-local stubs first; the
-- migration is atomic, so callers can never observe these interim bodies.
create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Credit migration in progress.';
end;
$$;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription$
begin
  raise exception 'Credit migration in progress.';
end;
$purchase_tipster_subscription$;

create or replace function public.admin_adjust_wallet_v2(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $admin_adjust_wallet_v2$
begin
  raise exception 'Credit migration in progress.';
end;
$admin_adjust_wallet_v2$;

create or replace function app_private.refund_content_purchase(
  target_purchase_id uuid,
  refund_reason text,
  refund_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Credit migration in progress.';
end;
$$;

alter table public.wallets
  add column if not exists purchased_balance integer not null default 0,
  add column if not exists reward_balance integer not null default 0;

with wallet_flows as (
  select
    wallets.user_id,
    wallets.balance,
    greatest(coalesce(sum(transactions.amount) filter (
      where transactions.transaction_type = 'purchase'
        and transactions.amount > 0
    ), 0) - coalesce(sum(-transactions.amount) filter (
      where transactions.amount < 0
    ), 0), 0)::integer as remaining_purchased
  from public.wallets wallets
  left join public.credit_transactions transactions
    on transactions.user_id = wallets.user_id
  group by wallets.user_id, wallets.balance
)
update public.wallets wallets
set
  purchased_balance = least(flows.balance, flows.remaining_purchased),
  reward_balance = flows.balance - least(flows.balance, flows.remaining_purchased)
from wallet_flows flows
where flows.user_id = wallets.user_id;

alter table public.wallets
  drop constraint if exists wallets_purchased_balance_check,
  drop constraint if exists wallets_reward_balance_check,
  drop constraint if exists wallets_balance_components_check;

alter table public.wallets
  add constraint wallets_purchased_balance_check check (purchased_balance >= 0),
  add constraint wallets_reward_balance_check check (reward_balance >= 0),
  add constraint wallets_balance_components_check
    check (balance = purchased_balance + reward_balance);

alter table public.credit_transactions
  add column if not exists purchased_amount integer not null default 0,
  add column if not exists reward_amount integer not null default 0,
  add column if not exists purchased_balance_after integer,
  add column if not exists reward_balance_after integer;

update public.credit_transactions
set
  purchased_amount = case when transaction_type = 'purchase' then amount else 0 end,
  reward_amount = case when transaction_type = 'purchase' then 0 else amount end
where purchased_amount = 0 and reward_amount = 0 and amount <> 0;

alter table public.credit_transactions
  drop constraint if exists credit_transactions_amount_components_check;

alter table public.credit_transactions
  add constraint credit_transactions_amount_components_check
    check (amount = purchased_amount + reward_amount);

alter table public.content_purchases
  add column if not exists purchased_coins integer not null default 0,
  add column if not exists reward_coins integer not null default 0;

update public.content_purchases
set purchased_coins = gross_coins, reward_coins = 0
where purchased_coins = 0 and reward_coins = 0;

alter table public.content_purchases
  drop constraint if exists content_purchases_coin_components_check;

alter table public.content_purchases
  add constraint content_purchases_coin_components_check check (
    purchased_coins >= 0
    and reward_coins >= 0
    and gross_coins = purchased_coins + reward_coins
  );

alter table public.race_tip_selections
  add column if not exists selection_status text not null default 'tipped';

alter table public.race_tip_selections
  drop constraint if exists race_tip_selections_selection_status_check,
  add constraint race_tip_selections_selection_status_check
    check (selection_status in ('tipped', 'skipped')),
  drop constraint if exists race_tip_selections_skipped_empty_check,
  add constraint race_tip_selections_skipped_empty_check check (
    selection_status <> 'skipped'
    or (winner_entry_id is null and place_entry_id is null)
  );

alter table public.profiles
  add column if not exists sms_notifications_enabled boolean not null default false,
  add column if not exists sms_notifications_consented_at timestamptz,
  add column if not exists sms_marketing_consented_at timestamptz;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.notification_outbox'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%channel%';

  if constraint_name is not null then
    execute format(
      'alter table public.notification_outbox drop constraint %I',
      constraint_name
    );
  end if;
end;
$$;

alter table public.notification_outbox
  add constraint notification_outbox_channel_check
    check (channel in ('email', 'sms', 'browser', 'whatsapp', 'telegram'));

select pgmq.create('sms_notifications')
where not exists (
  select 1 from pgmq.list_queues() where queue_name = 'sms_notifications'
);

create or replace function app_private.allocate_wallet_spend(
  target_user_id uuid,
  requested_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_row record;
  purchased_used integer;
  reward_used integer;
begin
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

  purchased_used := least(wallet_row.purchased_balance, requested_amount);
  reward_used := requested_amount - purchased_used;

  update public.wallets
  set
    purchased_balance = purchased_balance - purchased_used,
    reward_balance = reward_balance - reward_used,
    balance = balance - requested_amount,
    updated_at = now()
  where user_id = target_user_id
  returning * into wallet_row;

  return jsonb_build_object(
    'purchasedUsed', purchased_used,
    'rewardUsed', reward_used,
    'balance', wallet_row.balance,
    'purchasedBalance', wallet_row.purchased_balance,
    'rewardBalance', wallet_row.reward_balance
  );
end;
$$;

revoke all on function app_private.allocate_wallet_spend(uuid, integer)
from public, anon, authenticated;

create or replace function public.complete_credit_payment(
  p_payment_id uuid,
  p_provider text,
  p_provider_reference text,
  p_sanitized_event jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  wallet_row record;
  transaction_id uuid := gen_random_uuid();
begin
  select * into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'Payment not found.';
  end if;
  if payment_row.provider <> p_provider then
    raise exception 'Payment provider mismatch.';
  end if;

  if payment_row.status = 'paid' then
    select * into wallet_row from public.wallets where user_id = payment_row.user_id;
    return jsonb_build_object(
      'paymentId', payment_row.id,
      'walletBalance', coalesce(wallet_row.balance, 0),
      'purchasedBalance', coalesce(wallet_row.purchased_balance, 0),
      'rewardBalance', coalesce(wallet_row.reward_balance, 0),
      'credits', payment_row.credits,
      'idempotent', true
    );
  end if;

  if payment_row.status <> 'pending' then
    raise exception 'Payment is not pending.';
  end if;
  if payment_row.checkout_expires_at is not null
    and payment_row.checkout_expires_at < now() then
    raise exception 'Payment checkout has expired.';
  end if;

  insert into public.wallets (
    user_id, balance, purchased_balance, reward_balance
  ) values (
    payment_row.user_id, payment_row.credits, payment_row.credits, 0
  )
  on conflict (user_id) do update set
    balance = public.wallets.balance + excluded.balance,
    purchased_balance = public.wallets.purchased_balance + excluded.purchased_balance,
    updated_at = now()
  returning * into wallet_row;

  insert into public.credit_transactions (
    id, user_id, payment_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key
  ) values (
    transaction_id, payment_row.user_id, payment_row.id, 'purchase',
    payment_row.credits, wallet_row.balance, payment_row.credits, 0,
    wallet_row.purchased_balance, wallet_row.reward_balance,
    'Credit package purchase', 'credit-payment:' || payment_row.id::text
  );

  update public.payments set
    status = 'paid',
    provider_reference = nullif(btrim(coalesce(p_provider_reference, '')), ''),
    raw_event = coalesce(p_sanitized_event, '{}'::jsonb),
    paid_at = now()
  where id = payment_row.id;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'credit_payment_completed', 'payment', payment_row.id,
    jsonb_build_object(
      'provider', payment_row.provider,
      'credits', payment_row.credits,
      'creditClass', 'purchased',
      'amountCents', payment_row.amount_cents
    )
  );

  return jsonb_build_object(
    'paymentId', payment_row.id,
    'walletBalance', wallet_row.balance,
    'purchasedBalance', wallet_row.purchased_balance,
    'rewardBalance', wallet_row.reward_balance,
    'credits', payment_row.credits,
    'idempotent', false
  );
end;
$$;

revoke all on function public.complete_credit_payment(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_credit_payment(uuid, text, text, jsonb)
to service_role;

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
  existing_purchase record;
  card_row public.tip_cards%rowtype;
  meeting_row public.race_meetings%rowtype;
  tipster_row public.tipsters%rowtype;
  allocation jsonb;
  purchased_used integer;
  reward_used integer;
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

  select * into meeting_row from public.race_meetings where id = card_row.meeting_id;
  if meeting_row.status <> 'scheduled'
    or meeting_row.first_race_at <= now() + interval '30 minutes' then
    raise exception 'This meeting card is closed 30 minutes before Race 1.';
  end if;
  if meeting_row.is_test and not app_private.user_has_test_access(current_user_id) then
    raise exception 'This test meeting is not available to this account.';
  end if;

  if exists (
    select 1 from public.content_purchases
    where user_id = current_user_id and tip_card_id = card_row.id
      and status in ('active', 'disputed')
  ) then
    raise exception 'This meeting card is already unlocked.';
  end if;

  select * into tipster_row
  from public.tipsters
  where id = card_row.tipster_id and is_verified = true;
  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  allocation := app_private.allocate_wallet_spend(current_user_id, card_row.coin_price);
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
    transaction_id, current_user_id, 'unlock', -card_row.coin_price,
    (allocation ->> 'balance')::integer,
    -purchased_used, -reward_used,
    (allocation ->> 'purchasedBalance')::integer,
    (allocation ->> 'rewardBalance')::integer,
    'Meeting card purchase: ' || card_row.title,
    'meeting-purchase:' || purchase_id::text, current_user_id
  );

  insert into public.content_purchases (
    id, user_id, tipster_id, purchase_type, tip_card_id, gross_coins,
    purchased_coins, reward_coins, commission_rate, platform_fee_coins,
    tipster_net_coins, idempotency_key, credit_transaction_id
  ) values (
    purchase_id, current_user_id, card_row.tipster_id, 'meeting', card_row.id,
    card_row.coin_price, purchased_used, reward_used, commission,
    platform_fee, tipster_net, p_idempotency_key, transaction_id
  );

  insert into public.tip_card_entitlements (
    user_id, tip_card_id, source_type, source_purchase_id
  ) values (current_user_id, card_row.id, 'meeting', purchase_id);

  if purchased_used > 0 then
    insert into public.tipster_earnings (
      tipster_id, purchase_id, entry_type, gross_coins, platform_fee_coins,
      net_coins, idempotency_key
    ) values (
      card_row.tipster_id, purchase_id, 'sale', purchased_used,
      platform_fee, tipster_net, 'sale:' || purchase_id::text
    );
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id, 'meeting_card_purchased', 'content_purchase', purchase_id,
    jsonb_build_object(
      'tipCardId', card_row.id,
      'grossCoins', card_row.coin_price,
      'purchasedCoins', purchased_used,
      'rewardCoins', reward_used,
      'commissionRate', commission
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
    'tipsterNetCoins', tipster_net
  );
end;
$$;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription_final$
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

  allocation := app_private.allocate_wallet_spend(current_user_id, package_row.coin_price);
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
      'commissionRate', commission
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'subscriptionId', subscription_id,
    'startsAt', subscription_start,
    'endsAt', subscription_end,
    'walletBalance', (allocation ->> 'balance')::integer,
    'purchasedBalance', (allocation ->> 'purchasedBalance')::integer,
    'rewardBalance', (allocation ->> 'rewardBalance')::integer,
    'purchasedCoins', purchased_used,
    'rewardCoins', reward_used
  );
end;
$purchase_tipster_subscription_final$;

revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon;
revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon;
grant execute on function public.purchase_meeting_card(uuid, text) to authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text) to authenticated;

create or replace function app_private.refund_content_purchase(
  target_purchase_id uuid,
  refund_reason text,
  refund_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_row record;
  wallet_row record;
  refund_transaction_id uuid := gen_random_uuid();
begin
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

  insert into public.wallets (user_id)
  values (purchase_row.user_id)
  on conflict (user_id) do nothing;

  update public.wallets set
    purchased_balance = purchased_balance + purchase_row.purchased_coins,
    reward_balance = reward_balance + purchase_row.reward_coins,
    balance = balance + purchase_row.gross_coins,
    updated_at = now()
  where user_id = purchase_row.user_id
  returning * into wallet_row;

  insert into public.credit_transactions (
    id, user_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key, created_by
  ) values (
    refund_transaction_id, purchase_row.user_id, 'refund',
    purchase_row.gross_coins, wallet_row.balance,
    purchase_row.purchased_coins, purchase_row.reward_coins,
    wallet_row.purchased_balance, wallet_row.reward_balance,
    refund_reason, 'content-refund:' || purchase_row.id::text, refund_actor_id
  ) on conflict (idempotency_key) do nothing;

  update public.content_purchases set status = 'refunded', refunded_at = now()
  where id = purchase_row.id;
  update public.tip_card_entitlements set revoked_at = now()
  where source_purchase_id = purchase_row.id and revoked_at is null;
  update public.tipster_subscriptions set status = 'refunded'
  where purchase_id = purchase_row.id;

  if purchase_row.purchased_coins > 0 then
    insert into public.tipster_earnings (
      tipster_id, purchase_id, entry_type, gross_coins,
      platform_fee_coins, net_coins, idempotency_key
    ) values (
      purchase_row.tipster_id, purchase_row.id, 'refund',
      -purchase_row.purchased_coins, -purchase_row.platform_fee_coins,
      -purchase_row.tipster_net_coins, 'refund:' || purchase_row.id::text
    ) on conflict (idempotency_key) do nothing;
  end if;

  insert into public.notifications (user_id, title, body)
  values (
    purchase_row.user_id,
    'Credits refunded',
    purchase_row.gross_coins::text || ' Credits were returned to your wallet. ' || refund_reason
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
      'reason', refund_reason,
      'clientUrl', 'https://www.mrcracing.co.za/client/'
    )
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    refund_actor_id, 'content_purchase_refunded', 'content_purchase', purchase_row.id,
    jsonb_build_object(
      'reason', refund_reason,
      'coins', purchase_row.gross_coins,
      'purchasedCoins', purchase_row.purchased_coins,
      'rewardCoins', purchase_row.reward_coins
    )
  );
  return true;
end;
$$;

revoke all on function app_private.refund_content_purchase(uuid, text, uuid)
from public, anon, authenticated;

create or replace function public.admin_adjust_wallet_v2(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $admin_adjust_wallet_v2_final$
declare
  actor_id uuid := (select auth.uid());
  wallet_row record;
  new_balance integer;
  reward_change integer := 0;
  purchased_change integer := 0;
  transaction_id uuid := gen_random_uuid();
  normalized_key text;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'Credit adjustment must be non-zero.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reason of at least ten characters is required.';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'A valid idempotency key is required.';
  end if;

  normalized_key := 'admin-wallet:' || actor_id::text || ':' || btrim(p_idempotency_key);
  if exists (
    select 1 from public.credit_transactions
    where idempotency_key = normalized_key
  ) then
    if exists (
      select 1 from public.credit_transactions
      where idempotency_key = normalized_key
        and (user_id <> p_user_id or amount <> p_amount)
    ) then
      raise exception 'The idempotency key has already been used for another adjustment.';
    end if;
    return (
      select jsonb_build_object(
        'userId', user_id,
        'amount', amount,
        'balance', balance_after,
        'purchasedBalance', purchased_balance_after,
        'rewardBalance', reward_balance_after,
        'transactionId', id,
        'idempotent', true
      )
      from public.credit_transactions
      where idempotency_key = normalized_key
    );
  end if;

  insert into public.wallets (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select * into wallet_row from public.wallets where user_id = p_user_id for update;
  new_balance := wallet_row.balance + p_amount;
  if new_balance < 0 then
    raise exception 'Credit balance cannot become negative.';
  end if;

  if p_amount > 0 then
    reward_change := p_amount;
  else
    reward_change := -least(wallet_row.reward_balance, abs(p_amount));
    purchased_change := p_amount - reward_change;
  end if;

  update public.wallets set
    balance = new_balance,
    purchased_balance = purchased_balance + purchased_change,
    reward_balance = reward_balance + reward_change,
    updated_at = now()
  where user_id = p_user_id
  returning * into wallet_row;

  insert into public.credit_transactions (
    id, user_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key, created_by
  ) values (
    transaction_id, p_user_id,
    case when p_amount > 0 then 'admin_add'::public.credit_transaction_type
      else 'admin_remove'::public.credit_transaction_type end,
    p_amount, wallet_row.balance, purchased_change, reward_change,
    wallet_row.purchased_balance, wallet_row.reward_balance,
    btrim(p_reason), normalized_key, actor_id
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id, 'wallet_adjusted_v2', 'wallet', p_user_id,
    jsonb_build_object(
      'amount', p_amount,
      'balanceAfter', wallet_row.balance,
      'purchasedChange', purchased_change,
      'rewardChange', reward_change,
      'reason', btrim(p_reason),
      'idempotencyKey', btrim(p_idempotency_key),
      'largeAdjustment', abs(p_amount) >= 1000
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'amount', p_amount,
    'balance', wallet_row.balance,
    'purchasedBalance', wallet_row.purchased_balance,
    'rewardBalance', wallet_row.reward_balance,
    'transactionId', transaction_id,
    'idempotent', false
  );
end;
$admin_adjust_wallet_v2_final$;

revoke all on function public.admin_adjust_wallet_v2(uuid, integer, text, text)
from public, anon;
grant execute on function public.admin_adjust_wallet_v2(uuid, integer, text, text)
to authenticated;

create or replace function public.save_tip_card_draft_v2(
  p_card_id uuid,
  p_meeting_id uuid,
  p_title text,
  p_summary text,
  p_coin_price integer,
  p_expected_revision integer,
  p_listing_status public.tip_card_status,
  p_race_selections jsonb default '[]'::jsonb,
  p_multiples jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_card jsonb;
  saved_card_id uuid;
  race_item jsonb;
  multiple_item jsonb;
  target_fixture_id uuid;
  target_status text;
begin
  saved_card := public.save_tip_card_draft(
    p_card_id, p_meeting_id, p_title, p_summary, p_coin_price,
    p_expected_revision, p_listing_status, p_race_selections, p_multiples
  );
  saved_card_id := (saved_card ->> 'id')::uuid;

  for race_item in
    select value from jsonb_array_elements(coalesce(p_race_selections, '[]'::jsonb))
  loop
    target_fixture_id := (race_item ->> 'fixtureId')::uuid;
    target_status := coalesce(nullif(race_item ->> 'selectionStatus', ''), 'tipped');
    if target_status not in ('tipped', 'skipped') then
      raise exception 'Race tip status is invalid.';
    end if;

    if target_status = 'skipped' then
      if nullif(race_item ->> 'winnerEntryId', '') is not null
        or nullif(race_item ->> 'placeEntryId', '') is not null then
        raise exception 'A skipped race cannot include horse selections.';
      end if;

      insert into public.race_tip_selections (
        tip_card_id, fixture_id, winner_entry_id, place_entry_id,
        comments, selection_status
      ) values (
        saved_card_id, target_fixture_id, null, null,
        nullif(btrim(coalesce(race_item ->> 'comments', '')), ''), 'skipped'
      )
      on conflict (tip_card_id, fixture_id) do update set
        winner_entry_id = null,
        place_entry_id = null,
        comments = excluded.comments,
        selection_status = 'skipped',
        updated_at = now();
    else
      update public.race_tip_selections set selection_status = 'tipped'
      where tip_card_id = saved_card_id and fixture_id = target_fixture_id;
    end if;
  end loop;

  for multiple_item in
    select value from jsonb_array_elements(coalesce(p_multiples, '[]'::jsonb))
  loop
    update public.tip_card_multiples
    set tip_text = nullif(btrim(coalesce(multiple_item ->> 'tipText', '')), '')
    where tip_card_id = saved_card_id
      and bet_option_id = (multiple_item ->> 'betOptionId')::uuid;
  end loop;
  return saved_card;
end;
$$;

create or replace function public.revise_tip_card_v2(
  p_card_id uuid,
  p_expected_revision integer,
  p_revision_summary text,
  p_race_changes jsonb default '[]'::jsonb,
  p_multiple_changes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  revised_card jsonb;
  race_item jsonb;
  multiple_item jsonb;
  target_fixture_id uuid;
  target_bet_option_id uuid;
  target_status text;
begin
  select * into card_row from public.tip_cards where id = p_card_id for update;
  if current_tipster_id is null or card_row.id is null
    or card_row.tipster_id <> current_tipster_id then
    raise exception 'Tip card not found.';
  end if;

  for race_item in
    select value from jsonb_array_elements(coalesce(p_race_changes, '[]'::jsonb))
  loop
    if coalesce((race_item ->> 'remove')::boolean, false) then
      continue;
    end if;
    target_status := coalesce(nullif(race_item ->> 'selectionStatus', ''), 'tipped');
    if target_status not in ('tipped', 'skipped') then
      raise exception 'Race tip status is invalid.';
    end if;
    if target_status = 'skipped' and (
      nullif(race_item ->> 'winnerEntryId', '') is not null
      or nullif(race_item ->> 'placeEntryId', '') is not null
    ) then
      raise exception 'A skipped race cannot include horse selections.';
    end if;
  end loop;

  for multiple_item in
    select value from jsonb_array_elements(coalesce(p_multiple_changes, '[]'::jsonb))
  loop
    if coalesce((multiple_item ->> 'remove')::boolean, false) then
      continue;
    end if;
    target_bet_option_id := (multiple_item ->> 'betOptionId')::uuid;
    if not exists (
      select 1 from public.meeting_bet_options
      where id = target_bet_option_id and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Meeting bet correction is invalid.';
    end if;
    insert into public.tip_card_multiples (tip_card_id, bet_option_id, tip_text)
    values (
      card_row.id, target_bet_option_id,
      nullif(btrim(coalesce(multiple_item ->> 'tipText', '')), '')
    )
    on conflict (tip_card_id, bet_option_id) do update
    set tip_text = excluded.tip_text;
  end loop;

  revised_card := public.revise_tip_card(
    p_card_id, p_expected_revision, p_revision_summary,
    p_race_changes, p_multiple_changes
  );

  for race_item in
    select value from jsonb_array_elements(coalesce(p_race_changes, '[]'::jsonb))
  loop
    if coalesce((race_item ->> 'remove')::boolean, false) then
      continue;
    end if;
    target_fixture_id := (race_item ->> 'fixtureId')::uuid;
    target_status := coalesce(nullif(race_item ->> 'selectionStatus', ''), 'tipped');
    update public.race_tip_selections set
      selection_status = target_status,
      winner_entry_id = case when target_status = 'skipped' then null else winner_entry_id end,
      place_entry_id = case when target_status = 'skipped' then null else place_entry_id end,
      updated_at = now()
    where tip_card_id = p_card_id and fixture_id = target_fixture_id;
  end loop;
  return revised_card;
end;
$$;

create or replace function app_private.tip_card_snapshot(target_tip_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', to_jsonb(cards),
    'raceSelections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fixtureId', selections.fixture_id,
        'selectionStatus', selections.selection_status,
        'winnerEntryId', selections.winner_entry_id,
        'placeEntryId', selections.place_entry_id,
        'comments', selections.comments
      ) order by fixtures.race_number)
      from public.race_tip_selections selections
      join public.fixtures fixtures on fixtures.id = selections.fixture_id
      where selections.tip_card_id = cards.id
    ), '[]'::jsonb),
    'multiples', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', multiples.id,
        'betOptionId', multiples.bet_option_id,
        'customName', multiples.custom_name,
        'tipText', multiples.tip_text,
        'comments', multiples.comments,
        'selections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'legNumber', selections.leg_number,
            'fixtureId', selections.fixture_id,
            'entryId', selections.entry_id
          ) order by selections.leg_number, entries.saddle_number)
          from public.tip_card_multiple_selections selections
          join public.race_entries entries on entries.id = selections.entry_id
          where selections.multiple_id = multiples.id
        ), '[]'::jsonb)
      ) order by options.sort_order, options.display_name)
      from public.tip_card_multiples multiples
      join public.meeting_bet_options options on options.id = multiples.bet_option_id
      where multiples.tip_card_id = cards.id
    ), '[]'::jsonb)
  )
  from public.tip_cards cards
  where cards.id = target_tip_card_id;
$$;

revoke all on function public.save_tip_card_draft_v2(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) from public, anon;
revoke all on function public.revise_tip_card_v2(
  uuid, integer, text, jsonb, jsonb
) from public, anon;
grant execute on function public.save_tip_card_draft_v2(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) to authenticated;
grant execute on function public.revise_tip_card_v2(
  uuid, integer, text, jsonb, jsonb
) to authenticated;
revoke all on function app_private.tip_card_snapshot(uuid)
from public, anon, authenticated;

create or replace function app_private.enqueue_sms_notification(
  target_user_id uuid,
  target_event_type text,
  target_dedupe_key text,
  target_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_id uuid;
begin
  insert into public.notification_outbox (
    user_id, event_type, channel, dedupe_key, payload
  ) values (
    target_user_id, target_event_type, 'sms', target_dedupe_key, target_payload
  )
  on conflict (dedupe_key) do nothing
  returning id into outbox_id;

  if outbox_id is null then
    select id into outbox_id from public.notification_outbox
    where dedupe_key = target_dedupe_key;
  else
    perform pgmq.send(
      'sms_notifications', jsonb_build_object('outboxId', outbox_id)
    );
  end if;
  return outbox_id;
end;
$$;

create or replace function app_private.queue_tip_card_notifications(
  target_tip_card_id uuid,
  target_revision integer,
  target_event_type text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
  recipient record;
  recipient_count integer := 0;
  event_title text;
  event_body text;
  client_url text;
begin
  select
    cards.id, cards.tipster_id, cards.title, cards.revision, cards.meeting_id,
    tipsters.display_name as tipster_name,
    meetings.venue, meetings.meeting_date, meetings.first_race_at
  into card_row
  from public.tip_cards cards
  join public.tipsters tipsters on tipsters.id = cards.tipster_id
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.id = target_tip_card_id;

  insert into public.tip_card_entitlements (
    user_id, tip_card_id, source_type, source_purchase_id, source_subscription_id
  )
  select subscriptions.user_id, card_row.id, 'subscription',
    subscriptions.purchase_id, subscriptions.id
  from public.tipster_subscriptions subscriptions
  where subscriptions.tipster_id = card_row.tipster_id
    and subscriptions.status = 'active'
    and card_row.first_race_at >= subscriptions.starts_at
    and card_row.first_race_at < subscriptions.ends_at
  on conflict do nothing;

  event_title := case when target_event_type = 'tip_card_corrected'
    then 'Tip card correction published' else 'Your meeting tips are ready' end;
  event_body := case when target_event_type = 'tip_card_corrected'
    then card_row.tipster_name || ' updated the ' || card_row.venue || ' meeting card.'
    else card_row.tipster_name || ' published tips for ' || card_row.venue || '.' end;
  client_url := 'https://www.mrcracing.co.za/client/?card=' || card_row.id::text;

  for recipient in
    select distinct
      entitlements.user_id,
      profiles.email_notifications_enabled,
      profiles.sms_notifications_enabled,
      profiles.phone
    from public.tip_card_entitlements entitlements
    join public.profiles profiles on profiles.id = entitlements.user_id
    where entitlements.tip_card_id = card_row.id
      and entitlements.revoked_at is null
  loop
    insert into public.notifications (user_id, title, body)
    values (recipient.user_id, event_title, event_body);

    if recipient.email_notifications_enabled then
      perform app_private.enqueue_notification(
        recipient.user_id,
        target_event_type,
        'tip-card:' || card_row.id::text || ':revision:' || target_revision::text ||
          ':user:' || recipient.user_id::text || ':email',
        jsonb_build_object(
          'template', target_event_type,
          'tipCardId', card_row.id,
          'revision', target_revision,
          'tipsterName', card_row.tipster_name,
          'meetingVenue', card_row.venue,
          'meetingDate', card_row.meeting_date,
          'cardTitle', card_row.title,
          'clientUrl', client_url
        )
      );
    end if;

    if recipient.sms_notifications_enabled
      and nullif(btrim(coalesce(recipient.phone, '')), '') is not null then
      perform app_private.enqueue_sms_notification(
        recipient.user_id,
        target_event_type,
        'tip-card:' || card_row.id::text || ':revision:' || target_revision::text ||
          ':user:' || recipient.user_id::text || ':sms',
        jsonb_build_object(
          'tipCardId', card_row.id,
          'revision', target_revision,
          'message', left(event_body || ' View your card: ' || client_url, 320)
        )
      );
    end if;
    recipient_count := recipient_count + 1;
  end loop;
  return recipient_count;
end;
$$;

create or replace function public.claim_sms_notification_jobs(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jobs jsonb;
begin
  with queue_messages as (
    select * from pgmq.read(
      'sms_notifications', 120, greatest(1, least(coalesce(p_limit, 20), 100))
    )
  ),
  claimed as (
    update public.notification_outbox outbox set
      status = 'processing', attempt_count = attempt_count + 1, locked_at = now()
    from queue_messages queue
    where outbox.id = (queue.message ->> 'outboxId')::uuid
      and outbox.channel = 'sms'
      and (
        outbox.status in ('pending', 'failed')
        or (outbox.status = 'processing' and outbox.locked_at < now() - interval '2 minutes')
      )
      and outbox.available_at <= now()
      and outbox.attempt_count < 8
    returning
      outbox.id, outbox.user_id, outbox.event_type, outbox.dedupe_key,
      outbox.payload, outbox.attempt_count, queue.msg_id as queue_message_id
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into jobs from claimed;
  return jobs;
end;
$$;

create or replace function public.complete_sms_notification_job(
  p_outbox_id uuid,
  p_queue_message_id bigint,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox set
    status = 'delivered', provider_message_id = nullif(p_provider_message_id, ''),
    delivered_at = now(), locked_at = null, last_error = null
  where id = p_outbox_id and channel = 'sms';
  perform pgmq.delete('sms_notifications', p_queue_message_id);
end;
$$;

create or replace function public.fail_sms_notification_job(
  p_outbox_id uuid,
  p_queue_message_id bigint,
  p_error text,
  p_retry_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_delay integer := greatest(30, least(coalesce(p_retry_seconds, 300), 86400));
  current_attempt_count integer;
begin
  update public.notification_outbox set
    status = 'failed', available_at = now() + make_interval(secs => retry_delay),
    locked_at = null, last_error = left(coalesce(p_error, 'Unknown SMS delivery error'), 1000)
  where id = p_outbox_id and channel = 'sms';
  select attempt_count into current_attempt_count
  from public.notification_outbox where id = p_outbox_id;
  perform pgmq.delete('sms_notifications', p_queue_message_id);
  if coalesce(current_attempt_count, 0) < 8 then
    perform pgmq.send(
      'sms_notifications', jsonb_build_object('outboxId', p_outbox_id), retry_delay
    );
  end if;
end;
$$;

revoke all on function app_private.enqueue_sms_notification(uuid, text, text, jsonb)
from public, anon, authenticated;
revoke all on function app_private.queue_tip_card_notifications(uuid, integer, text)
from public, anon, authenticated;
revoke all on function public.claim_sms_notification_jobs(integer)
from public, anon, authenticated;
revoke all on function public.complete_sms_notification_job(uuid, bigint, text)
from public, anon, authenticated;
revoke all on function public.fail_sms_notification_job(uuid, bigint, text, integer)
from public, anon, authenticated;
grant execute on function public.claim_sms_notification_jobs(integer) to service_role;
grant execute on function public.complete_sms_notification_job(uuid, bigint, text) to service_role;
grant execute on function public.fail_sms_notification_job(uuid, bigint, text, integer) to service_role;
