with settings as (
  select *
  from public.platform_settings
  where singleton = true
), period as (
  select *
  from public.revenue_split_periods
  where allocation_version = 'content-spend-10-20-70-v2-forward-only'
), wallet_checks as (
  select count(*)::integer as invalid_count
  from public.wallets
  where balance < 0
    or purchased_balance < 0
    or reward_balance < 0
    or balance <> purchased_balance + reward_balance
), purchase_checks as (
  select
    count(*) filter (
      where platform_fee_coins + horse_care_coins + tipster_net_coins <> purchased_coins
    )::integer as allocation_mismatch_count,
    count(*) filter (
      where created_at < settings.revenue_split_effective_at
        and allocation_version = 'content-spend-10-20-70-v2-forward-only'
    )::integer as rewritten_history_count,
    count(*) filter (
      where created_at >= settings.revenue_split_effective_at
    )::integer as current_period_purchase_count
  from public.content_purchases
  cross join settings
), opening as (
  select
    coalesce(sum(amount_credits) filter (where beneficiary_type = 'horse_care'), 0)::numeric(14, 2) as horse_care_credits,
    coalesce(sum(amount_credits) filter (where beneficiary_type = 'platform'), 0)::numeric(14, 2) as platform_credits,
    coalesce(sum(amount_credits) filter (where beneficiary_type = 'tipster'), 0)::numeric(14, 2) as tipster_credits
  from public.revenue_opening_settlements
  where period_id = (select id from period)
), expected_opening as (
  select
    (
      select coalesce(sum(entries.amount_cents), 0)::numeric
        / nullif(settings.zar_per_coin * 100, 0)
      from public.charity_contribution_entries entries
      where entries.created_at < settings.revenue_split_effective_at
    )::numeric(14, 2) as horse_care_credits,
    (
      select coalesce(sum(earnings.platform_fee_coins), 0)::numeric(14, 2)
      from public.tipster_earnings earnings
      where earnings.created_at < settings.revenue_split_effective_at
    ) as platform_credits,
    (
      select coalesce(sum(earnings.net_coins), 0)::numeric(14, 2)
      from public.tipster_earnings earnings
      where earnings.created_at < settings.revenue_split_effective_at
    ) as tipster_credits
  from settings
), current_balances as (
  select
    (
      select coalesce(sum(entries.amount_cents), 0)::numeric
        / nullif(settings.zar_per_coin * 100, 0)
      from public.charity_contribution_entries entries
      where entries.created_at >= settings.revenue_split_effective_at
    )::numeric(14, 2) as horse_care_credits,
    (
      select coalesce(sum(earnings.platform_fee_coins), 0)::numeric(14, 2)
      from public.tipster_earnings earnings
      where earnings.created_at >= settings.revenue_split_effective_at
    ) as platform_credits,
    (
      select coalesce(sum(earnings.net_coins), 0)::numeric(14, 2)
      from public.tipster_earnings earnings
      where earnings.created_at >= settings.revenue_split_effective_at
    ) as tipster_credits
  from settings
), checks as (
  select
    wallet_checks.invalid_count = 0 as wallets_valid,
    purchase_checks.allocation_mismatch_count = 0 as allocations_valid,
    purchase_checks.rewritten_history_count = 0 as history_unchanged,
    purchase_checks.current_period_purchase_count = 0 as no_cutover_purchases,
    settings.horse_care_rate = 10.00
      and settings.commission_rate = 20.00
      and settings.tipster_rate = 70.00 as rates_valid,
    app_private.calculate_content_spend_split(100) ->> 'horseCareCredits' = '10.00'
      and app_private.calculate_content_spend_split(100) ->> 'platformCredits' = '20.00'
      and app_private.calculate_content_spend_split(100) ->> 'tipsterCredits' = '70.00' as split_valid,
    opening.horse_care_credits = expected_opening.horse_care_credits
      and opening.platform_credits = expected_opening.platform_credits
      and opening.tipster_credits = expected_opening.tipster_credits as opening_settlement_valid,
    current_balances.horse_care_credits = 0
      and current_balances.platform_credits = 0
      and current_balances.tipster_credits = 0 as current_period_zero,
    not has_function_privilege('service_role', 'public.create_credit_checkout_record(uuid,text,jsonb,text)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.complete_credit_payment(uuid,text,text,jsonb)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text,boolean)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text,boolean,boolean)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.admin_refund_purchase(uuid,text)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.process_due_meeting_refunds()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.admin_adjust_wallet_v2(uuid,integer,text,text)', 'EXECUTE') as financial_freeze_valid
  from settings
  cross join wallet_checks
  cross join purchase_checks
  cross join opening
  cross join expected_opening
  cross join current_balances
)
select jsonb_build_object(
  'passed', wallets_valid and allocations_valid and history_unchanged
    and no_cutover_purchases and rates_valid and split_valid
    and opening_settlement_valid and current_period_zero and financial_freeze_valid,
  'walletsValid', wallets_valid,
  'allocationsValid', allocations_valid,
  'historyUnchanged', history_unchanged,
  'noCutoverPurchases', no_cutover_purchases,
  'ratesValid', rates_valid,
  'splitValid', split_valid,
  'openingSettlementValid', opening_settlement_valid,
  'currentPeriodZero', current_period_zero,
  'financialFreezeValid', financial_freeze_valid
) as activation_verification
from checks;
