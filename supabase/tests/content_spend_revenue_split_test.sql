begin;
select plan(14);

select is(
  (
    select jsonb_build_array(horse_care_rate, commission_rate, tipster_rate)
    from public.platform_settings
    where singleton = true
  ),
  '[10.00, 20.00, 70.00]'::jsonb,
  'The configured content-spend split is 10/20/70'
);

select has_column(
  'public',
  'content_purchases',
  'horse_care_coins',
  'Content purchases snapshot the Horse Care allocation'
);

select has_column(
  'public',
  'content_purchases',
  'allocation_version',
  'Content purchases snapshot the allocation rule version'
);

select has_column(
  'public',
  'tipster_earnings',
  'horse_care_coins',
  'Tipster earnings expose the Horse Care allocation'
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
  'Every purchase allocation reconciles exactly to cash-backed Credits used'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    where purchases.reward_coins > 0
      and purchases.platform_fee_coins
        + purchases.horse_care_coins
        + purchases.tipster_net_coins
        <> purchases.purchased_coins
  ),
  0::bigint,
  'Reward Credits do not increase financial allocations'
);

select is(
  (
    select count(*)::bigint
    from public.content_purchases purchases
    left join lateral (
      select
        coalesce(sum(earnings.platform_fee_coins), 0) as platform_fee_coins,
        coalesce(sum(earnings.horse_care_coins), 0) as horse_care_coins,
        coalesce(sum(earnings.net_coins), 0) as tipster_net_coins
      from public.tipster_earnings earnings
      where earnings.purchase_id = purchases.id
    ) ledger on true
    where purchases.status in ('active', 'disputed')
      and purchases.purchased_coins > 0
      and (
        ledger.platform_fee_coins <> purchases.platform_fee_coins
        or ledger.horse_care_coins <> purchases.horse_care_coins
        or ledger.tipster_net_coins <> purchases.tipster_net_coins
      )
  ),
  0::bigint,
  'Active earnings ledgers reconcile to their purchase allocation snapshots'
);

select like(
  pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure),
  '%calculate_content_spend_split(purchased_used)%',
  'Meeting-card purchases calculate the split when Credits are used'
);

select like(
  pg_get_functiondef('public.purchase_tipster_subscription(uuid,text)'::regprocedure),
  '%calculate_content_spend_split(purchased_used)%',
  'Subscription purchases calculate the split when Credits are used'
);

select unlike(
  pg_get_functiondef('public.purchase_meeting_card(uuid,text)'::regprocedure),
  '%commission_rate_override%',
  'Meeting-card allocations do not bypass the fixed 10/20/70 policy'
);

select ok(
  not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text,boolean)', 'EXECUTE'),
  'Clients must use the confirmed meeting-card purchase wrapper'
);

select ok(
  not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text,boolean,boolean)', 'EXECUTE'),
  'Clients must use the confirmed subscription purchase wrapper'
);

select ok(
  not has_function_privilege('anon', 'public.admin_get_revenue_split_report(integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.admin_get_revenue_split_report(integer)', 'EXECUTE'),
  'Only signed-in users can reach the internally administrator-guarded revenue report'
);

select like(
  pg_get_functiondef('public.admin_get_revenue_split_report(integer)'::regprocedure),
  '%current_user_has_role(''administrator'')%',
  'The revenue report enforces administrator authorization and MFA'
);

select * from finish();
rollback;
