with settings as (
  select
    revenue_split_effective_at as effective_at,
    horse_care_rate,
    commission_rate,
    tipster_rate,
    zar_per_coin
  from public.platform_settings
  where singleton = true
), period as (
  select *
  from public.revenue_split_periods
  where allocation_version = 'content-spend-10-20-70-v2-forward-only'
), opening as (
  select
    coalesce(sum(amount_credits) filter (where beneficiary_type = 'horse_care'), 0)::numeric(14, 2) as horse_care,
    coalesce(sum(amount_credits) filter (where beneficiary_type = 'platform'), 0)::numeric(14, 2) as platform,
    coalesce(sum(amount_credits) filter (where beneficiary_type = 'tipster'), 0)::numeric(14, 2) as tipster
  from public.revenue_opening_settlements
  where period_id = (select id from period)
), purchases as (
  select purchases.*
  from public.content_purchases purchases
  cross join settings
  where purchases.created_at >= settings.effective_at
), purchase_rollup as (
  select
    count(*)::integer as purchase_count,
    coalesce(sum(gross_coins), 0)::numeric(14, 2) as gross,
    coalesce(sum(purchased_coins), 0)::numeric(14, 2) as purchased,
    coalesce(sum(reward_coins), 0)::numeric(14, 2) as reward,
    coalesce(sum(horse_care_coins), 0)::numeric(14, 2) as horse_care,
    coalesce(sum(platform_fee_coins), 0)::numeric(14, 2) as platform,
    coalesce(sum(tipster_net_coins), 0)::numeric(14, 2) as tipster,
    count(*) filter (
      where gross_coins <> purchased_coins + reward_coins
    )::integer as gross_mismatch,
    count(*) filter (
      where horse_care_coins <> round(purchased_coins * 0.10, 2)
        or platform_fee_coins <> round(purchased_coins * 0.20, 2)
        or tipster_net_coins <> round(
          purchased_coins
            - round(purchased_coins * 0.10, 2)
            - round(purchased_coins * 0.20, 2),
          2
        )
    )::integer as split_mismatch,
    count(*) filter (
      where horse_care_coins + platform_fee_coins + tipster_net_coins <> purchased_coins
    )::integer as allocation_mismatch,
    count(*) filter (
      where horse_care_rate <> 10.00
        or commission_rate <> 20.00
        or tipster_rate <> 70.00
        or allocation_version <> 'content-spend-10-20-70-v2-forward-only'
    )::integer as policy_mismatch
  from purchases
), earnings as (
  select
    earnings.purchase_id,
    count(*) filter (where earnings.entry_type = 'sale')::integer as sale_rows,
    coalesce(sum(earnings.gross_coins) filter (where earnings.entry_type = 'sale'), 0)::numeric(14, 2) as gross,
    coalesce(sum(earnings.horse_care_coins) filter (where earnings.entry_type = 'sale'), 0)::numeric(14, 2) as horse_care,
    coalesce(sum(earnings.platform_fee_coins) filter (where earnings.entry_type = 'sale'), 0)::numeric(14, 2) as platform,
    coalesce(sum(earnings.net_coins) filter (where earnings.entry_type = 'sale'), 0)::numeric(14, 2) as tipster
  from public.tipster_earnings earnings
  join purchases on purchases.id = earnings.purchase_id
  group by earnings.purchase_id
), charity as (
  select
    entries.purchase_id,
    count(*) filter (where entries.entry_type = 'accrual')::integer as accrual_rows,
    coalesce(sum(entries.basis_purchased_coins) filter (where entries.entry_type = 'accrual'), 0)::numeric(14, 2) as purchased_basis,
    coalesce(sum(entries.amount_cents) filter (where entries.entry_type = 'accrual'), 0)::integer as amount_cents
  from public.charity_contribution_entries entries
  join purchases on purchases.id = entries.purchase_id
  group by entries.purchase_id
), related_checks as (
  select
    count(*) filter (
      where purchases.purchased_coins > 0
        and (
          coalesce(earnings.sale_rows, 0) <> 1
          or earnings.gross <> purchases.purchased_coins
          or earnings.horse_care <> purchases.horse_care_coins
          or earnings.platform <> purchases.platform_fee_coins
          or earnings.tipster <> purchases.tipster_net_coins
        )
    )::integer as earnings_mismatch,
    count(*) filter (
      where purchases.purchased_coins = 0
        and coalesce(earnings.sale_rows, 0) <> 0
    )::integer as reward_only_earnings,
    count(*) filter (
      where purchases.horse_care_coins > 0
        and (
          coalesce(charity.accrual_rows, 0) <> 1
          or charity.purchased_basis <> purchases.purchased_coins
          or charity.amount_cents <> round(
            purchases.horse_care_coins * settings.zar_per_coin * 100
          )::integer
        )
    )::integer as charity_mismatch,
    count(*) filter (
      where purchases.horse_care_coins = 0
        and coalesce(charity.accrual_rows, 0) <> 0
    )::integer as zero_horse_care_entries,
    count(*) filter (
      where transactions.id is null
        or transactions.amount <> -purchases.gross_coins
        or transactions.purchased_amount <> -purchases.purchased_coins
        or transactions.reward_amount <> -purchases.reward_coins
    )::integer as credit_transaction_mismatch
  from purchases
  cross join settings
  left join earnings on earnings.purchase_id = purchases.id
  left join charity on charity.purchase_id = purchases.id
  left join public.credit_transactions transactions
    on transactions.id = purchases.credit_transaction_id
), wallet_checks as (
  select
    count(*) filter (
      where balance < 0
        or purchased_balance < 0
        or reward_balance < 0
        or balance <> purchased_balance + reward_balance
    )::integer as invalid_count,
    count(*)::integer as wallet_count,
    coalesce(sum(balance), 0)::numeric(14, 2) as balance,
    coalesce(sum(purchased_balance), 0)::numeric(14, 2) as purchased,
    coalesce(sum(reward_balance), 0)::numeric(14, 2) as reward
  from public.wallets
), duplicate_checks as (
  select
    (
      select count(*)
      from (
        select user_id, idempotency_key
        from public.content_purchases
        group by user_id, idempotency_key
        having count(*) > 1
      ) duplicates
    )::integer as purchase_duplicates,
    (
      select count(*)
      from (
        select idempotency_key
        from public.credit_transactions
        where idempotency_key is not null
        group by idempotency_key
        having count(*) > 1
      ) duplicates
    )::integer as transaction_duplicates,
    (
      select count(*)
      from (
        select idempotency_key
        from public.tipster_earnings
        group by idempotency_key
        having count(*) > 1
      ) duplicates
    )::integer as earnings_duplicates,
    (
      select count(*)
      from (
        select purchase_id, allocation_version
        from public.charity_contribution_entries
        where entry_type = 'accrual'
        group by purchase_id, allocation_version
        having count(*) > 1
      ) duplicates
    )::integer as charity_duplicates
), history_checks as (
  select
    (
      select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), ''))
      from public.content_purchases rows
      where rows.created_at < (select effective_at from settings)
    ) = '094c27591a3ba5283b0a6fe0e0b4c8dd' as purchases_unchanged,
    (
      select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), ''))
      from public.tipster_earnings rows
      where rows.created_at < (select effective_at from settings)
    ) = '823eaf5d546464723b0599de07707c31' as earnings_unchanged,
    (
      select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), ''))
      from public.charity_contribution_entries rows
      where rows.created_at < (select effective_at from settings)
    ) = 'd291de98470b0f2c35361ae05c48c9f7' as charity_unchanged
), first_purchase as (
  select jsonb_build_object(
    'id', id,
    'createdAt', created_at,
    'type', purchase_type,
    'status', status,
    'grossCredits', gross_coins,
    'purchasedCredits', purchased_coins,
    'rewardCredits', reward_coins,
    'horseCareCredits', horse_care_coins,
    'platformCredits', platform_fee_coins,
    'tipsterCredits', tipster_net_coins,
    'allocationVersion', allocation_version
  ) as value
  from purchases
  order by created_at, id
  limit 1
)
select jsonb_build_object(
  'checkedAt', clock_timestamp(),
  'effectiveAt', settings.effective_at,
  'oneHourDue', clock_timestamp() >= settings.effective_at + interval '1 hour',
  'twentyFourHourDue', clock_timestamp() >= settings.effective_at + interval '24 hours',
  'firstOrganicPurchase', (select value from first_purchase),
  'summary', jsonb_build_object(
    'purchaseCount', purchase_rollup.purchase_count,
    'grossCredits', purchase_rollup.gross,
    'purchasedCredits', purchase_rollup.purchased,
    'rewardCredits', purchase_rollup.reward,
    'horseCareCredits', purchase_rollup.horse_care,
    'platformCredits', purchase_rollup.platform,
    'tipsterCredits', purchase_rollup.tipster
  ),
  'checks', jsonb_build_object(
    'periodValid',
      period.allocation_version = 'content-spend-10-20-70-v2-forward-only'
      and period.starts_at = settings.effective_at
      and period.horse_care_rate = 10.00
      and period.platform_rate = 20.00
      and period.tipster_rate = 70.00
      and period.reward_credits_excluded
      and period.credit_topups_excluded,
    'openingSettlementValid',
      opening.horse_care = 45.00
      and opening.platform = 465.00
      and opening.tipster = 4185.00,
    'grossCompositionValid',
      purchase_rollup.gross_mismatch = 0
      and purchase_rollup.gross = purchase_rollup.purchased + purchase_rollup.reward,
    'splitValid',
      purchase_rollup.split_mismatch = 0
      and purchase_rollup.allocation_mismatch = 0
      and purchase_rollup.policy_mismatch = 0
      and purchase_rollup.purchased = purchase_rollup.horse_care
        + purchase_rollup.platform
        + purchase_rollup.tipster,
    'relatedEntriesValid',
      related_checks.earnings_mismatch = 0
      and related_checks.reward_only_earnings = 0
      and related_checks.charity_mismatch = 0
      and related_checks.zero_horse_care_entries = 0
      and related_checks.credit_transaction_mismatch = 0,
    'walletsValid',
      wallet_checks.invalid_count = 0
      and wallet_checks.balance = wallet_checks.purchased + wallet_checks.reward,
    'idempotencyValid',
      duplicate_checks.purchase_duplicates = 0
      and duplicate_checks.transaction_duplicates = 0
      and duplicate_checks.earnings_duplicates = 0
      and duplicate_checks.charity_duplicates = 0,
    'historyUnchanged',
      history_checks.purchases_unchanged
      and history_checks.earnings_unchanged
      and history_checks.charity_unchanged
  ),
  'diagnostics', jsonb_build_object(
    'walletCount', wallet_checks.wallet_count,
    'invalidWallets', wallet_checks.invalid_count,
    'earningsMismatch', related_checks.earnings_mismatch,
    'charityMismatch', related_checks.charity_mismatch,
    'creditTransactionMismatch', related_checks.credit_transaction_mismatch,
    'purchaseDuplicates', duplicate_checks.purchase_duplicates,
    'transactionDuplicates', duplicate_checks.transaction_duplicates,
    'earningsDuplicates', duplicate_checks.earnings_duplicates,
    'charityDuplicates', duplicate_checks.charity_duplicates
  )
) as monitor_result
from settings
cross join period
cross join opening
cross join purchase_rollup
cross join related_checks
cross join wallet_checks
cross join duplicate_checks
cross join history_checks;
