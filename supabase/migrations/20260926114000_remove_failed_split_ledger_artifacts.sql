create temporary table rollback_new_content_purchases
on commit drop
as
select distinct logs.entity_id as purchase_id
from public.audit_logs logs
where logs.entity_type = 'content_purchase'
  and logs.action in ('meeting_card_purchased', 'tipster_subscription_purchased')
  and logs.metadata ->> 'allocationVersion' = 'content-spend-10-20-70-v1';

delete from public.tipster_earnings
where idempotency_key like 'content-spend-10-20-70-adjustment:%'
   or idempotency_key like 'rollback-content-spend-10-20-70-20260926:%';

update public.tipster_earnings earnings
set
  platform_fee_coins = purchases.platform_fee_coins,
  horse_care_coins = purchases.horse_care_coins,
  net_coins = purchases.tipster_net_coins
from public.content_purchases purchases
join rollback_new_content_purchases rollback
  on rollback.purchase_id = purchases.id
where earnings.purchase_id = purchases.id
  and earnings.entry_type = 'sale';

alter table public.charity_contribution_entries
disable trigger protect_charity_contribution_entries;

delete from public.charity_contribution_entries
where allocation_version = 'content-spend-10-20-70-v1'
   or reason = 'Rollback to 10% of MRC platform commission';

alter table public.charity_contribution_entries
enable trigger protect_charity_contribution_entries;

insert into public.charity_contribution_entries (
  purchase_id,
  entry_type,
  basis_platform_fee_coins,
  basis_purchased_coins,
  zar_per_coin,
  contribution_rate_bps,
  amount_cents,
  reason,
  allocation_version
)
select
  purchases.id,
  'accrual',
  purchases.platform_fee_coins,
  purchases.purchased_coins,
  settings.zar_per_coin,
  1000,
  round(
    purchases.platform_fee_coins * settings.zar_per_coin * 100 * 1000 / 10000.0
  )::integer,
  '10% of MRC platform commission',
  'legacy-platform-commission-10pct'
from public.content_purchases purchases
join rollback_new_content_purchases rollback
  on rollback.purchase_id = purchases.id
cross join public.platform_settings settings
where settings.singleton = true
  and purchases.status in ('active', 'disputed')
  and purchases.platform_fee_coins > 0
on conflict do nothing;

do $verify_clean_rollback$
declare
  mismatch_count integer;
  artifact_count integer;
begin
  select count(*) into artifact_count
  from public.tipster_earnings
  where idempotency_key like 'content-spend-10-20-70-adjustment:%'
     or idempotency_key like 'rollback-content-spend-10-20-70-20260926:%';

  if artifact_count <> 0 then
    raise exception 'The rollback left % temporary Tipster ledger artifacts.', artifact_count;
  end if;

  select count(*) into artifact_count
  from public.charity_contribution_entries
  where allocation_version = 'content-spend-10-20-70-v1'
     or reason = 'Rollback to 10% of MRC platform commission';

  if artifact_count <> 0 then
    raise exception 'The rollback left % temporary Horse Care ledger artifacts.', artifact_count;
  end if;

  with purchase_totals as (
    select
      tipster_id,
      sum(platform_fee_coins)::numeric(14, 2) as platform_fee_coins,
      sum(horse_care_coins)::numeric(14, 2) as horse_care_coins,
      sum(tipster_net_coins)::numeric(14, 2) as net_coins
    from public.content_purchases
    where status = 'active'
    group by tipster_id
  ), earning_totals as (
    select
      tipster_id,
      sum(platform_fee_coins)::numeric(14, 2) as platform_fee_coins,
      sum(horse_care_coins)::numeric(14, 2) as horse_care_coins,
      sum(net_coins)::numeric(14, 2) as net_coins
    from public.tipster_earnings
    group by tipster_id
  )
  select count(*) into mismatch_count
  from purchase_totals purchases
  left join earning_totals earnings using (tipster_id)
  where purchases.platform_fee_coins <> coalesce(earnings.platform_fee_coins, 0)
     or purchases.horse_care_coins <> coalesce(earnings.horse_care_coins, 0)
     or purchases.net_coins <> coalesce(earnings.net_coins, 0);

  if mismatch_count <> 0 then
    raise exception 'The clean rollback left % Tipster ledger mismatches.', mismatch_count;
  end if;
end;
$verify_clean_rollback$;
