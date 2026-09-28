with wallet_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', user_id,
        'balance', balance,
        'purchasedBalance', purchased_balance,
        'rewardBalance', reward_balance,
        'updatedAt', updated_at
      ) order by user_id
    ),
    '[]'::jsonb
  ) as items
  from public.wallets
), fingerprints as (
  select jsonb_build_object(
    'wallets', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.wallets rows),
    'creditTransactions', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.credit_transactions rows),
    'payments', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.payments rows),
    'contentPurchases', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.content_purchases rows),
    'entitlements', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.tip_card_entitlements rows),
    'subscriptions', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.tipster_subscriptions rows),
    'tipsterEarnings', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.tipster_earnings rows),
    'horseCareEntries', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.charity_contribution_entries rows),
    'horseCareRemittances', (select md5(coalesce(string_agg(row_to_json(rows)::text, '|' order by row_to_json(rows)::text), '')) from public.charity_remittances rows)
  ) as value
), aggregates as (
  select jsonb_build_object(
    'wallets', jsonb_build_object(
      'count', (select count(*) from public.wallets),
      'balance', (select coalesce(sum(balance), 0) from public.wallets),
      'purchasedBalance', (select coalesce(sum(purchased_balance), 0) from public.wallets),
      'rewardBalance', (select coalesce(sum(reward_balance), 0) from public.wallets)
    ),
    'creditTransactions', jsonb_build_object(
      'count', (select count(*) from public.credit_transactions),
      'amount', (select coalesce(sum(amount), 0) from public.credit_transactions),
      'purchasedAmount', (select coalesce(sum(purchased_amount), 0) from public.credit_transactions),
      'rewardAmount', (select coalesce(sum(reward_amount), 0) from public.credit_transactions)
    ),
    'payments', jsonb_build_object(
      'count', (select count(*) from public.payments),
      'pending', (select count(*) from public.payments where status = 'pending'),
      'unexpiredPending', (select count(*) from public.payments where status = 'pending' and checkout_expires_at > now()),
      'paid', (select count(*) from public.payments where status = 'paid')
    ),
    'contentPurchases', jsonb_build_object(
      'count', (select count(*) from public.content_purchases),
      'active', (select count(*) from public.content_purchases where status = 'active'),
      'refunded', (select count(*) from public.content_purchases where status = 'refunded'),
      'grossCredits', (select coalesce(sum(gross_coins), 0) from public.content_purchases),
      'purchasedCredits', (select coalesce(sum(purchased_coins), 0) from public.content_purchases),
      'rewardCredits', (select coalesce(sum(reward_coins), 0) from public.content_purchases),
      'horseCareCredits', (select coalesce(sum(horse_care_coins), 0) from public.content_purchases),
      'platformCredits', (select coalesce(sum(platform_fee_coins), 0) from public.content_purchases),
      'tipsterCredits', (select coalesce(sum(tipster_net_coins), 0) from public.content_purchases)
    ),
    'entitlements', jsonb_build_object(
      'count', (select count(*) from public.tip_card_entitlements),
      'active', (select count(*) from public.tip_card_entitlements where revoked_at is null)
    ),
    'subscriptions', jsonb_build_object(
      'count', (select count(*) from public.tipster_subscriptions),
      'active', (select count(*) from public.tipster_subscriptions where status = 'active')
    ),
    'tipsterEarnings', jsonb_build_object(
      'count', (select count(*) from public.tipster_earnings),
      'grossCredits', (select coalesce(sum(gross_coins), 0) from public.tipster_earnings),
      'horseCareCredits', (select coalesce(sum(horse_care_coins), 0) from public.tipster_earnings),
      'platformCredits', (select coalesce(sum(platform_fee_coins), 0) from public.tipster_earnings),
      'tipsterCredits', (select coalesce(sum(net_coins), 0) from public.tipster_earnings)
    ),
    'horseCare', jsonb_build_object(
      'entryCount', (select count(*) from public.charity_contribution_entries),
      'entryCents', (select coalesce(sum(amount_cents), 0) from public.charity_contribution_entries),
      'remittanceCount', (select count(*) from public.charity_remittances),
      'remittedCents', (select coalesce(sum(amount_cents), 0) from public.charity_remittances)
    )
  ) as value
)
select jsonb_build_object(
  'capturedAt', clock_timestamp(),
  'aggregates', aggregates.value,
  'fingerprints', fingerprints.value,
  'wallets', wallet_rows.items
) as financial_manifest
from wallet_rows
cross join fingerprints
cross join aggregates;
