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
  purchase_row public.content_purchases%rowtype;
  wallet_balance integer;
  refund_transaction_id uuid := gen_random_uuid();
begin
  select *
  into purchase_row
  from public.content_purchases
  where id = target_purchase_id
  for update;

  if purchase_row.id is null then
    raise exception 'Purchase not found.';
  end if;

  if purchase_row.status = 'refunded' then
    return false;
  end if;

  select balance
  into wallet_balance
  from public.wallets
  where user_id = purchase_row.user_id
  for update;

  wallet_balance := coalesce(wallet_balance, 0) + purchase_row.gross_coins;

  update public.wallets
  set balance = wallet_balance
  where user_id = purchase_row.user_id;

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
    refund_transaction_id,
    purchase_row.user_id,
    'refund',
    purchase_row.gross_coins,
    wallet_balance,
    refund_reason,
    'content-refund:' || purchase_row.id::text,
    refund_actor_id
  )
  on conflict (idempotency_key) do nothing;

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
    purchase_row.tipster_id,
    purchase_row.id,
    'refund',
    -purchase_row.gross_coins,
    -purchase_row.platform_fee_coins,
    -purchase_row.tipster_net_coins,
    'refund:' || purchase_row.id::text
  )
  on conflict (idempotency_key) do nothing;

  insert into public.notifications (user_id, title, body)
  values (
    purchase_row.user_id,
    'Coins refunded',
    purchase_row.gross_coins::text || ' coins were returned to your wallet. ' || refund_reason
  );

  perform app_private.enqueue_notification(
    purchase_row.user_id,
    'purchase_refunded',
    'purchase:' || purchase_row.id::text || ':refund:email',
    jsonb_build_object(
      'template', 'purchase_refunded',
      'purchaseId', purchase_row.id,
      'coins', purchase_row.gross_coins,
      'reason', refund_reason,
      'clientUrl', 'https://www.mrcracing.co.za/client/'
    )
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    refund_actor_id,
    'content_purchase_refunded',
    'content_purchase',
    purchase_row.id,
    jsonb_build_object(
      'reason', refund_reason,
      'coins', purchase_row.gross_coins
    )
  );

  return true;
end;
$$;

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
    select p.id, m.status as meeting_status
    from public.content_purchases p
    join public.tip_cards c on c.id = p.tip_card_id
    join public.race_meetings m on m.id = c.meeting_id
    where p.purchase_type = 'meeting'
      and p.status in ('active', 'disputed')
      and (
        m.status in ('cancelled', 'abandoned')
        or (m.first_race_at <= now() and c.status <> 'published')
      )
  loop
    if app_private.refund_content_purchase(
      purchase_row.id,
      case
        when purchase_row.meeting_status in ('cancelled', 'abandoned')
          then 'The race meeting was cancelled.'
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

;
