begin;
select plan(13);

select is(
  (
    select count(*)::bigint
    from public.wallets
    where balance < 0
      or purchased_balance < 0
      or reward_balance < 0
      or balance <> purchased_balance + reward_balance
  ),
  0::bigint,
  'Wallet balances are non-negative and their components reconcile'
);

select is(
  (
    select count(*)::bigint
    from public.credit_transactions
    where amount <> purchased_amount + reward_amount
  ),
  0::bigint,
  'Every Credit transaction amount reconciles to its components'
);

select is(
  (
    select count(*)::bigint
    from public.credit_transactions
    where balance_after <> purchased_balance_after + reward_balance_after
      or purchased_balance_after < 0
      or reward_balance_after < 0
  ),
  0::bigint,
  'Every Credit transaction records a valid component balance'
);

select is(
  (
    select count(*)::bigint
    from (
      select payments.id
      from public.payments payments
      left join public.credit_transactions transactions
        on transactions.payment_id = payments.id
      where payments.status = 'paid'
      group by payments.id
      having count(transactions.id) <> 1
    ) invalid_payments
  ),
  0::bigint,
  'Every paid gateway payment has exactly one Credit ledger entry'
);

select is(
  (
    select count(*)::bigint
    from public.payments payments
    join public.credit_transactions transactions
      on transactions.payment_id = payments.id
    where payments.status <> 'paid'
  ),
  0::bigint,
  'Pending and failed gateway payments never create Credits'
);

select is(
  (
    select count(*)::bigint
    from public.payments payments
    join public.credit_transactions transactions
      on transactions.payment_id = payments.id
    where payments.status = 'paid'
      and transactions.amount <> payments.credits
  ),
  0::bigint,
  'Paid gateway payment Credits match the immutable Credit ledger amount'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases
    where purchased_coins < 0
      or reward_coins < 0
      or gross_coins <> purchased_coins + reward_coins
  ),
  0::bigint,
  'Content purchase totals reconcile to purchased and Reward Credits'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases
    where purchased_coins::numeric <> platform_fee_coins + tipster_net_coins
  ),
  0::bigint,
  'Only purchased Credits split into platform fee and tipster earnings'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    where purchases.purchase_type = 'meeting'
      and purchases.status = 'active'
      and not exists (
        select 1
        from public.tip_card_entitlements entitlements
        where entitlements.source_purchase_id = purchases.id
          and entitlements.revoked_at is null
      )
  ),
  0::bigint,
  'Every active meeting purchase has an active entitlement'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    join public.tip_card_entitlements entitlements
      on entitlements.source_purchase_id = purchases.id
    where purchases.status = 'refunded'
      and entitlements.revoked_at is null
  ),
  0::bigint,
  'Refunded purchases retain no active entitlement'
);

select is(
  (
    select count(*)::bigint
    from public.tipster_earnings
    where gross_coins <> platform_fee_coins + net_coins
  ),
  0::bigint,
  'Every tipster earning or reversal balances gross, fee, and net Credits'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    where purchases.status = 'active'
      and purchases.purchased_coins > 0
      and not exists (
        select 1
        from public.tipster_earnings earnings
        where earnings.purchase_id = purchases.id
          and earnings.entry_type = 'sale'
          and earnings.gross_coins = purchases.purchased_coins
      )
  ),
  0::bigint,
  'Purchased-Credit sales create the matching tipster earning entry'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    join public.tipster_earnings earnings on earnings.purchase_id = purchases.id
    where purchases.purchased_coins = 0
      and earnings.entry_type = 'sale'
      and earnings.gross_coins <> 0
  ),
  0::bigint,
  'Reward-only purchases never create tipster earnings'
);

select * from finish();
rollback;
