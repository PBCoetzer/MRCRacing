update public.platform_settings
set
  commission_rate = 10.00,
  horse_care_rate = 0.00,
  tipster_rate = 90.00,
  updated_at = now()
where singleton = true;

alter table public.platform_settings
alter column horse_care_rate set default 0.00,
alter column tipster_rate set default 90.00;

comment on column public.platform_settings.commission_rate is
  'Legacy MRC platform commission percentage of cash-backed Credits used on paid content.';
comment on column public.platform_settings.horse_care_rate is
  'Compatibility field. Horse Care is restored to 10% of the MRC platform commission rather than a separate content-spend allocation.';
comment on column public.platform_settings.tipster_rate is
  'Legacy Tipster percentage of cash-backed Credits used on paid content.';

create or replace function app_private.calculate_content_spend_split(
  p_purchased_credits integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $calculate_legacy_content_spend_split$
declare
  settings_row record;
  platform_credits numeric(12, 2);
  horse_care_credits numeric(12, 2);
  tipster_credits numeric(12, 2);
begin
  if p_purchased_credits is null or p_purchased_credits < 0 then
    raise exception 'Purchased Credit usage cannot be negative.';
  end if;

  select commission_rate, horse_care_rate, tipster_rate
  into settings_row
  from public.platform_settings
  where singleton = true;

  if settings_row.commission_rate is null
    or settings_row.horse_care_rate is null
    or settings_row.tipster_rate is null
    or settings_row.commission_rate + settings_row.horse_care_rate + settings_row.tipster_rate <> 100.00
  then
    raise exception 'The content-spend revenue split is not configured correctly.';
  end if;

  platform_credits := round(p_purchased_credits * settings_row.commission_rate / 100.0, 2);
  horse_care_credits := round(p_purchased_credits * settings_row.horse_care_rate / 100.0, 2);
  tipster_credits := round(p_purchased_credits - platform_credits - horse_care_credits, 2);

  return jsonb_build_object(
    'allocationVersion', 'legacy-platform-10-tipster-90-v1',
    'purchasedCreditsUsed', p_purchased_credits,
    'platformRate', settings_row.commission_rate,
    'horseCareRate', settings_row.horse_care_rate,
    'tipsterRate', settings_row.tipster_rate,
    'platformCredits', platform_credits,
    'horseCareCredits', horse_care_credits,
    'tipsterCredits', tipster_credits
  );
end;
$calculate_legacy_content_spend_split$;

revoke all on function app_private.calculate_content_spend_split(integer)
from public, anon, authenticated, service_role;

update public.content_purchases
set
  commission_rate = 10.00,
  horse_care_rate = 0.00,
  tipster_rate = 90.00,
  platform_fee_coins = round(purchased_coins * 10.00 / 100.0, 2),
  horse_care_coins = 0.00,
  tipster_net_coins = round(
    purchased_coins - round(purchased_coins * 10.00 / 100.0, 2),
    2
  ),
  allocation_version = 'legacy-platform-10-tipster-90-v1';

alter table public.content_purchases
alter column horse_care_rate set default 0.00,
alter column tipster_rate set default 90.00,
alter column allocation_version set default 'legacy-platform-10-tipster-90-v1';

with existing_allocations as (
  select
    purchase_id,
    coalesce(sum(platform_fee_coins), 0)::numeric(12, 2) as platform_fee_coins,
    coalesce(sum(horse_care_coins), 0)::numeric(12, 2) as horse_care_coins,
    coalesce(sum(net_coins), 0)::numeric(12, 2) as tipster_net_coins
  from public.tipster_earnings
  group by purchase_id
)
insert into public.tipster_earnings (
  tipster_id,
  purchase_id,
  entry_type,
  gross_coins,
  platform_fee_coins,
  horse_care_coins,
  net_coins,
  idempotency_key
)
select
  purchases.tipster_id,
  purchases.id,
  'allocation_adjustment',
  0,
  purchases.platform_fee_coins - coalesce(existing.platform_fee_coins, 0),
  purchases.horse_care_coins - coalesce(existing.horse_care_coins, 0),
  purchases.tipster_net_coins - coalesce(existing.tipster_net_coins, 0),
  'rollback-content-spend-10-20-70-20260926:' || purchases.id::text
from public.content_purchases purchases
left join existing_allocations existing on existing.purchase_id = purchases.id
where purchases.status in ('active', 'disputed')
  and purchases.purchased_coins > 0
  and (
    purchases.platform_fee_coins <> coalesce(existing.platform_fee_coins, 0)
    or purchases.horse_care_coins <> coalesce(existing.horse_care_coins, 0)
    or purchases.tipster_net_coins <> coalesce(existing.tipster_net_coins, 0)
  )
on conflict (idempotency_key) do nothing;

with settings as (
  select zar_per_coin
  from public.platform_settings
  where singleton = true
), current_contributions as (
  select
    purchase_id,
    coalesce(sum(amount_cents), 0)::integer as amount_cents
  from public.charity_contribution_entries
  group by purchase_id
), targets as (
  select
    purchases.id as purchase_id,
    purchases.purchased_coins,
    purchases.platform_fee_coins,
    settings.zar_per_coin,
    round(
      purchases.platform_fee_coins * settings.zar_per_coin * 100 * 1000 / 10000.0
    )::integer as target_cents,
    coalesce(current_contributions.amount_cents, 0) as current_cents
  from public.content_purchases purchases
  cross join settings
  left join current_contributions on current_contributions.purchase_id = purchases.id
  where purchases.status in ('active', 'disputed')
    and purchases.purchased_coins > 0
)
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
  targets.purchase_id,
  'adjustment',
  targets.platform_fee_coins,
  targets.purchased_coins,
  targets.zar_per_coin,
  1000,
  targets.target_cents - targets.current_cents,
  'Rollback to 10% of MRC platform commission',
  'legacy-platform-commission-10pct'
from targets
where targets.target_cents <> targets.current_cents
on conflict do nothing;

create or replace function app_private.record_charity_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $record_legacy_charity_contribution$
declare
  coin_rate numeric(12, 4);
  contribution_cents integer;
begin
  select zar_per_coin into coin_rate
  from public.platform_settings
  where singleton = true;

  coin_rate := coalesce(coin_rate, 1.0000);
  contribution_cents := round(
    new.platform_fee_coins * coin_rate * 100 * 1000 / 10000.0
  )::integer;

  if tg_op = 'INSERT'
    and new.status <> 'refunded'
    and new.platform_fee_coins > 0
  then
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
    ) values (
      new.id,
      'accrual',
      new.platform_fee_coins,
      new.purchased_coins,
      coin_rate,
      1000,
      contribution_cents,
      '10% of MRC platform commission',
      'legacy-platform-commission-10pct'
    ) on conflict do nothing;
  elsif tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status = 'refunded'
  then
    select coalesce(sum(entries.amount_cents), 0)::integer
    into contribution_cents
    from public.charity_contribution_entries entries
    where entries.purchase_id = new.id;

    if contribution_cents > 0 then
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
      ) values (
        new.id,
        'reversal',
        -new.platform_fee_coins,
        -new.purchased_coins,
        coin_rate,
        1000,
        -contribution_cents,
        'Contribution reversal for refunded purchase',
        'legacy-platform-commission-10pct'
      ) on conflict do nothing;
    end if;
  end if;

  return new;
end;
$record_legacy_charity_contribution$;

revoke all on function app_private.record_charity_contribution()
from public, anon, authenticated, service_role;

create or replace function public.get_charity_transparency()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $get_legacy_charity_transparency$
  with contribution as (
    select coalesce(sum(amount_cents), 0)::integer as accrued_cents
    from public.charity_contribution_entries
  ), remittance as (
    select
      coalesce(sum(amount_cents), 0)::integer as transferred_cents,
      max(transferred_on) as last_transferred_on
    from public.charity_remittances
  )
  select jsonb_build_object(
    'accruedCents', contribution.accrued_cents,
    'transferredCents', remittance.transferred_cents,
    'outstandingCents', greatest(contribution.accrued_cents - remittance.transferred_cents, 0),
    'lastTransferredOn', remittance.last_transferred_on,
    'contributionRatePercent', 10,
    'basis', 'MRC platform commission on content purchases',
    'updatedAt', now()
  )
  from contribution cross join remittance;
$get_legacy_charity_transparency$;

revoke all on function public.get_charity_transparency() from public;
grant execute on function public.get_charity_transparency() to anon, authenticated;

revoke all on function public.admin_get_revenue_split_report(integer)
from public, anon, authenticated;

grant execute on function public.purchase_meeting_card(uuid, text, boolean)
to authenticated;

grant execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
to authenticated;

comment on function public.purchase_meeting_card(uuid, text, boolean) is
  'Requires explicit client confirmation before a legacy 10% platform / 90% Tipster meeting-card purchase.';

comment on function public.purchase_tipster_subscription(uuid, text, boolean, boolean) is
  'Requires explicit client confirmations before a legacy 10% platform / 90% Tipster subscription purchase.';

do $verify_compensation$
declare
  mismatch_count integer;
begin
  select count(*) into mismatch_count
  from public.content_purchases purchases
  where purchases.commission_rate <> 10.00
     or purchases.horse_care_rate <> 0.00
     or purchases.tipster_rate <> 90.00
     or purchases.platform_fee_coins + purchases.horse_care_coins + purchases.tipster_net_coins <> purchases.purchased_coins;

  if mismatch_count <> 0 then
    raise exception 'Content purchase compensation left % mismatched rows.', mismatch_count;
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
    raise exception 'Tipster earnings compensation left % mismatched ledgers.', mismatch_count;
  end if;
end;
$verify_compensation$;
