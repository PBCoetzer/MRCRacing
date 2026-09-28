begin;

do $guard_compensation$
declare
  effective_at timestamptz;
  new_purchase_count integer;
begin
  select starts_at
  into effective_at
  from public.revenue_split_periods
  where allocation_version = 'content-spend-10-20-70-v2-forward-only';

  if effective_at is null then
    raise exception 'The 10/20/70 activation period was not found.';
  end if;

  select count(*)
  into new_purchase_count
  from public.content_purchases
  where created_at >= effective_at;

  if new_purchase_count <> 0 then
    raise exception 'Compensation refused because % post-activation purchase(s) exist. Use a transaction-specific forward correction.', new_purchase_count;
  end if;
end;
$guard_compensation$;

insert into public.revenue_split_periods (
  allocation_version,
  starts_at,
  horse_care_rate,
  platform_rate,
  tipster_rate,
  opening_reason
)
values (
  'content-spend-legacy-10-0-90-compensation-v1',
  clock_timestamp(),
  0.00,
  10.00,
  90.00,
  'Forward-only compensation after an unsuccessful 10/20/70 activation. No client wallet, purchase, entitlement, subscription, or historical ledger row was rewritten.'
)
on conflict (allocation_version) do nothing;

update public.platform_settings settings
set
  commission_rate = period.platform_rate,
  horse_care_rate = period.horse_care_rate,
  tipster_rate = period.tipster_rate,
  revenue_split_effective_at = period.starts_at,
  updated_at = now()
from public.revenue_split_periods period
where settings.singleton = true
  and period.allocation_version = 'content-spend-legacy-10-0-90-compensation-v1';

alter table public.platform_settings
alter column commission_rate set default 10.00,
alter column horse_care_rate set default 0.00,
alter column tipster_rate set default 90.00;

alter table public.content_purchases
alter column commission_rate set default 10.00,
alter column horse_care_rate set default 0.00,
alter column tipster_rate set default 90.00,
alter column allocation_version set default 'legacy-platform-10-tipster-90-v1';

create or replace function app_private.calculate_content_spend_split(
  p_purchased_credits integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $calculate_compensated_legacy_content_spend_split$
declare
  settings_row record;
  platform_credits numeric(12, 2);
  horse_care_credits numeric(12, 2);
  tipster_credits numeric(12, 2);
begin
  if p_purchased_credits is null or p_purchased_credits < 0 then
    raise exception 'Purchased Credit usage cannot be negative.';
  end if;

  select
    commission_rate,
    horse_care_rate,
    tipster_rate,
    revenue_split_effective_at
  into settings_row
  from public.platform_settings
  where singleton = true;

  if settings_row.commission_rate is null
    or settings_row.horse_care_rate is null
    or settings_row.tipster_rate is null
    or settings_row.commission_rate
      + settings_row.horse_care_rate
      + settings_row.tipster_rate <> 100.00
  then
    raise exception 'The content-spend revenue split is not configured correctly.';
  end if;

  platform_credits := round(
    p_purchased_credits * settings_row.commission_rate / 100.0,
    2
  );
  horse_care_credits := round(
    p_purchased_credits * settings_row.horse_care_rate / 100.0,
    2
  );
  tipster_credits := round(
    p_purchased_credits - platform_credits - horse_care_credits,
    2
  );

  return jsonb_build_object(
    'allocationVersion', 'legacy-platform-10-tipster-90-v1',
    'effectiveAt', settings_row.revenue_split_effective_at,
    'purchasedCreditsUsed', p_purchased_credits,
    'platformRate', settings_row.commission_rate,
    'horseCareRate', settings_row.horse_care_rate,
    'tipsterRate', settings_row.tipster_rate,
    'platformCredits', platform_credits,
    'horseCareCredits', horse_care_credits,
    'tipsterCredits', tipster_credits
  );
end;
$calculate_compensated_legacy_content_spend_split$;

revoke all on function app_private.calculate_content_spend_split(integer)
from public, anon, authenticated, service_role;

create or replace function app_private.record_charity_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $record_compensated_legacy_charity_contribution$
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
$record_compensated_legacy_charity_contribution$;

revoke all on function app_private.record_charity_contribution()
from public, anon, authenticated, service_role;

create or replace function public.get_charity_transparency()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $get_compensated_legacy_charity_transparency$
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
    'outstandingCents', greatest(
      contribution.accrued_cents - remittance.transferred_cents,
      0
    ),
    'lastTransferredOn', remittance.last_transferred_on,
    'contributionRatePercent', 10,
    'basis', 'MRC platform commission on content purchases',
    'updatedAt', now()
  )
  from contribution
  cross join remittance;
$get_compensated_legacy_charity_transparency$;

revoke all on function public.get_charity_transparency() from public;
grant execute on function public.get_charity_transparency() to anon, authenticated;

create or replace function public.get_my_tipster_recorded_earnings()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $get_compensated_legacy_tipster_earnings$
  select coalesce(sum(earnings.net_coins), 0)::numeric(12, 2)
  from public.tipster_earnings earnings
  join public.tipsters tipsters on tipsters.id = earnings.tipster_id
  where tipsters.user_id = (select auth.uid());
$get_compensated_legacy_tipster_earnings$;

revoke all on function public.get_my_tipster_recorded_earnings()
from public, anon, authenticated;
grant execute on function public.get_my_tipster_recorded_earnings()
to authenticated;

revoke all on function public.admin_get_revenue_split_report(integer)
from public, anon, authenticated;

revoke execute on function public.create_credit_checkout_record(uuid, text, jsonb, text)
from service_role;
revoke execute on function public.complete_credit_payment(uuid, text, text, jsonb)
from service_role;
revoke execute on function public.purchase_meeting_card(uuid, text, boolean)
from authenticated;
revoke execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
from authenticated;
revoke execute on function public.admin_refund_purchase(uuid, text)
from authenticated;
revoke execute on function public.process_due_meeting_refunds()
from authenticated, service_role;
revoke execute on function public.admin_adjust_wallet_v2(uuid, integer, text, text)
from authenticated;

do $verify_compensation$
declare
  mismatch_count integer;
  split jsonb;
begin
  select count(*)
  into mismatch_count
  from public.content_purchases purchases
  where purchases.platform_fee_coins
      + purchases.horse_care_coins
      + purchases.tipster_net_coins
      <> purchases.purchased_coins;

  if mismatch_count <> 0 then
    raise exception 'Legacy compensation found % unreconciled historical purchase(s).', mismatch_count;
  end if;

  split := app_private.calculate_content_spend_split(100);
  if split ->> 'platformCredits' <> '10.00'
    or split ->> 'horseCareCredits' <> '0.00'
    or split ->> 'tipsterCredits' <> '90.00'
  then
    raise exception 'Legacy compensation did not restore the 10/0/90 calculation.';
  end if;
end;
$verify_compensation$;

commit;
