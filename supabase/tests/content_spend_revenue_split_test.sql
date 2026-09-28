begin;
select plan(24);

select is(
  (
    select jsonb_build_array(horse_care_rate, commission_rate, tipster_rate)
    from public.platform_settings
    where singleton = true
  ),
  '[10.00, 20.00, 70.00]'::jsonb,
  'The active forward-only content-spend split is 10/20/70'
);

select ok(
  (
    select revenue_split_effective_at is not null
    from public.platform_settings
    where singleton = true
  ),
  'The current revenue period has an explicit effective timestamp'
);

select has_table(
  'public',
  'revenue_split_periods',
  'Revenue policy periods are retained as immutable history'
);

select has_table(
  'public',
  'revenue_opening_settlements',
  'Opening settlements are retained separately from client wallets'
);

select is(
  (
    select count(*)::bigint
    from public.revenue_split_periods
    where allocation_version = 'content-spend-10-20-70-v2-forward-only'
  ),
  1::bigint,
  'Exactly one current 10/20/70 revenue period is recorded'
);

select ok(
  exists (
    select 1
    from public.revenue_opening_settlements settlements
    join public.revenue_split_periods periods on periods.id = settlements.period_id
    where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only'
      and settlements.beneficiary_type = 'horse_care'
  )
  and exists (
    select 1
    from public.revenue_opening_settlements settlements
    join public.revenue_split_periods periods on periods.id = settlements.period_id
    where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only'
      and settlements.beneficiary_type = 'platform'
  ),
  'The opening settlement records Horse Care and platform history'
);

select is(
  (
    select coalesce(sum(settlements.amount_credits), 0)::numeric(14, 2)
    from public.revenue_opening_settlements settlements
    join public.revenue_split_periods periods on periods.id = settlements.period_id
    where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only'
      and settlements.beneficiary_type = 'tipster'
  ),
  (
    select coalesce(sum(earnings.net_coins), 0)::numeric(14, 2)
    from public.tipster_earnings earnings
    cross join public.platform_settings settings
    where settings.singleton = true
      and earnings.created_at < settings.revenue_split_effective_at
  ),
  'The opening tipster settlement exactly snapshots pre-period earnings'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    cross join public.platform_settings settings
    where settings.singleton = true
      and purchases.created_at < settings.revenue_split_effective_at
      and purchases.allocation_version = 'content-spend-10-20-70-v2-forward-only'
  ),
  0::bigint,
  'Historical purchases are not rewritten into the new policy'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    where purchases.platform_fee_coins
      + purchases.horse_care_coins
      + purchases.tipster_net_coins
      <> purchases.purchased_coins
  ),
  0::bigint,
  'Every historical and current purchase allocation still reconciles exactly'
);

select is(
  app_private.calculate_content_spend_split(100) -> 'platformCredits',
  '20.00'::jsonb,
  'One hundred Purchased Credits allocate twenty Credits to the platform'
);

select is(
  app_private.calculate_content_spend_split(100) -> 'horseCareCredits',
  '10.00'::jsonb,
  'One hundred Purchased Credits allocate ten Credits to Horse Care'
);

select is(
  app_private.calculate_content_spend_split(100) -> 'tipsterCredits',
  '70.00'::jsonb,
  'One hundred Purchased Credits allocate seventy Credits to the tipster'
);

select ok(
  pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure)
    like '%calculate_content_spend_split(purchased_used)%',
  'Meeting-card purchases calculate the split when Credits are used'
);

select ok(
  pg_get_functiondef('public.purchase_tipster_subscription(uuid,text)'::regprocedure)
    like '%calculate_content_spend_split(purchased_used)%',
  'Subscription purchases calculate the split when Credits are used'
);

select ok(
  pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure)
    like '%purchased_used := (allocation ->> ''purchasedUsed'')::integer%'
  and pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure)
    like '%reward_used := (allocation ->> ''rewardUsed'')::integer%'
  and pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure)
    like '%calculate_content_spend_split(purchased_used)%',
  'Mixed meeting-card spend excludes Reward Credits from the revenue split'
);

select ok(
  pg_get_functiondef('public.purchase_tipster_subscription(uuid,text)'::regprocedure)
    like '%allocate_wallet_spend_reward_first%'
  and pg_get_functiondef('public.purchase_tipster_subscription(uuid,text)'::regprocedure)
    like '%calculate_content_spend_split(purchased_used)%',
  'Subscriptions may use Reward Credits first but allocate only Purchased Credits'
);

select is(
  app_private.calculate_content_spend_split(1),
  jsonb_build_object(
    'allocationVersion', 'content-spend-10-20-70-v2-forward-only',
    'effectiveAt', (select revenue_split_effective_at from public.platform_settings where singleton = true),
    'purchasedCreditsUsed', 1,
    'platformRate', 20.00,
    'horseCareRate', 10.00,
    'tipsterRate', 70.00,
    'platformCredits', 0.20,
    'horseCareCredits', 0.10,
    'tipsterCredits', 0.70
  ),
  'A one-Credit spend rounds exactly to 0.10/0.20/0.70'
);

select ok(
  app_private.calculate_content_spend_split(0) ->> 'horseCareCredits' = '0.00'
  and app_private.calculate_content_spend_split(0) ->> 'platformCredits' = '0.00'
  and app_private.calculate_content_spend_split(0) ->> 'tipsterCredits' = '0.00',
  'Reward-only spend creates zero Horse Care, platform, and tipster allocation'
);

select ok(
  pg_get_functiondef('app_private.refund_content_purchase(uuid,text,uuid)'::regprocedure)
    like '%-purchase_row.platform_fee_coins%'
  and pg_get_functiondef('app_private.refund_content_purchase(uuid,text,uuid)'::regprocedure)
    like '%-purchase_row.horse_care_coins%'
  and pg_get_functiondef('app_private.refund_content_purchase(uuid,text,uuid)'::regprocedure)
    like '%-purchase_row.tipster_net_coins%'
  and pg_get_functiondef('app_private.refund_content_purchase(uuid,text,uuid)'::regprocedure)
    like '%on conflict (idempotency_key) do nothing%',
  'Refunds reverse the exact stored allocation and remain idempotent'
);

select ok(
  pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure)
    not like '%commission_rate_override%',
  'Meeting-card allocations cannot bypass the fixed current policy'
);

select ok(
  not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text,boolean)', 'EXECUTE'),
  'Meeting-card spending remains frozen until production verification completes'
);

select ok(
  not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text,boolean,boolean)', 'EXECUTE'),
  'Subscription spending remains frozen until production verification completes'
);

select ok(
  not has_function_privilege('anon', 'public.admin_get_revenue_split_report(integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.admin_get_revenue_split_report(integer)', 'EXECUTE'),
  'Only signed-in users can reach the internally administrator-guarded revenue report'
);

select ok(
  pg_get_functiondef('public.admin_get_revenue_split_report(integer)'::regprocedure)
    like '%current_user_has_role(''administrator'')%',
  'The revenue report enforces administrator authorization and MFA'
);

select * from finish();
rollback;
