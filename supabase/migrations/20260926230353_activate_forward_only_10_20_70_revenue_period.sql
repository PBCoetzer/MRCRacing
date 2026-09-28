alter table public.platform_settings
add column if not exists revenue_split_effective_at timestamptz;

create table if not exists public.revenue_split_periods (
  id uuid primary key default gen_random_uuid(),
  allocation_version text not null unique,
  starts_at timestamptz not null unique,
  horse_care_rate numeric(5, 2) not null check (horse_care_rate between 0 and 100),
  platform_rate numeric(5, 2) not null check (platform_rate between 0 and 100),
  tipster_rate numeric(5, 2) not null check (tipster_rate between 0 and 100),
  reward_credits_excluded boolean not null default true,
  credit_topups_excluded boolean not null default true,
  opening_reason text not null check (char_length(btrim(opening_reason)) between 10 and 500),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint revenue_split_periods_rate_total_check
    check (horse_care_rate + platform_rate + tipster_rate = 100.00)
);

create table if not exists public.revenue_opening_settlements (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.revenue_split_periods(id),
  beneficiary_type text not null
    check (beneficiary_type in ('horse_care', 'platform', 'tipster')),
  tipster_id uuid references public.tipsters(id),
  amount_credits numeric(14, 2) not null check (amount_credits >= 0),
  source_label text not null check (char_length(btrim(source_label)) between 3 and 200),
  created_at timestamptz not null default now(),
  constraint revenue_opening_settlements_tipster_check check (
    (beneficiary_type = 'tipster' and tipster_id is not null)
    or (beneficiary_type <> 'tipster' and tipster_id is null)
  )
);

create unique index if not exists revenue_opening_settlements_beneficiary_key
on public.revenue_opening_settlements (
  period_id,
  beneficiary_type,
  coalesce(tipster_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create or replace function app_private.protect_revenue_period_history()
returns trigger
language plpgsql
set search_path = ''
as $protect_revenue_period_history$
begin
  raise exception 'Revenue period and opening-settlement history is immutable.';
end;
$protect_revenue_period_history$;

revoke all on function app_private.protect_revenue_period_history()
from public, anon, authenticated, service_role;

drop trigger if exists protect_revenue_split_periods on public.revenue_split_periods;
create trigger protect_revenue_split_periods
before update or delete on public.revenue_split_periods
for each row execute function app_private.protect_revenue_period_history();

drop trigger if exists protect_revenue_opening_settlements on public.revenue_opening_settlements;
create trigger protect_revenue_opening_settlements
before update or delete on public.revenue_opening_settlements
for each row execute function app_private.protect_revenue_period_history();

alter table public.revenue_split_periods enable row level security;
alter table public.revenue_opening_settlements enable row level security;

revoke all on public.revenue_split_periods from anon, authenticated;
revoke all on public.revenue_opening_settlements from anon, authenticated;

insert into public.revenue_split_periods (
  allocation_version,
  starts_at,
  horse_care_rate,
  platform_rate,
  tipster_rate,
  opening_reason
)
values (
  'content-spend-10-20-70-v2-forward-only',
  clock_timestamp(),
  10.00,
  20.00,
  70.00,
  'All Horse Care, MRC platform, and tipster obligations before this period were confirmed settled before the new 10/20/70 policy started.'
)
on conflict (allocation_version) do nothing;

with period as (
  select id, starts_at
  from public.revenue_split_periods
  where allocation_version = 'content-spend-10-20-70-v2-forward-only'
), settings as (
  select zar_per_coin
  from public.platform_settings
  where singleton = true
), opening_amount as (
  select greatest(
    coalesce(sum(entries.amount_cents), 0)::numeric
      / nullif(settings.zar_per_coin * 100, 0),
    0
  )::numeric(14, 2) as amount_credits
  from public.charity_contribution_entries entries
  cross join settings
  cross join period
  where entries.created_at < period.starts_at
  group by settings.zar_per_coin
)
insert into public.revenue_opening_settlements (
  period_id,
  beneficiary_type,
  amount_credits,
  source_label
)
select
  period.id,
  'horse_care',
  opening_amount.amount_credits,
  'Settled legacy Horse Care contribution history'
from period
cross join opening_amount
on conflict do nothing;

with period as (
  select id, starts_at
  from public.revenue_split_periods
  where allocation_version = 'content-spend-10-20-70-v2-forward-only'
), opening_amount as (
  select greatest(
    coalesce(sum(earnings.platform_fee_coins), 0),
    0
  )::numeric(14, 2) as amount_credits
  from public.tipster_earnings earnings
  cross join period
  where earnings.created_at < period.starts_at
)
insert into public.revenue_opening_settlements (
  period_id,
  beneficiary_type,
  amount_credits,
  source_label
)
select
  period.id,
  'platform',
  opening_amount.amount_credits,
  'Settled legacy MRC platform allocation history'
from period
cross join opening_amount
on conflict do nothing;

with period as (
  select id, starts_at
  from public.revenue_split_periods
  where allocation_version = 'content-spend-10-20-70-v2-forward-only'
), tipster_amounts as (
  select
    earnings.tipster_id,
    greatest(coalesce(sum(earnings.net_coins), 0), 0)::numeric(14, 2) as amount_credits
  from public.tipster_earnings earnings
  cross join period
  where earnings.created_at < period.starts_at
  group by earnings.tipster_id
)
insert into public.revenue_opening_settlements (
  period_id,
  beneficiary_type,
  tipster_id,
  amount_credits,
  source_label
)
select
  period.id,
  'tipster',
  tipster_amounts.tipster_id,
  tipster_amounts.amount_credits,
  'Settled legacy tipster allocation history'
from period
cross join tipster_amounts
on conflict do nothing;

update public.platform_settings settings
set
  commission_rate = period.platform_rate,
  horse_care_rate = period.horse_care_rate,
  tipster_rate = period.tipster_rate,
  revenue_split_effective_at = period.starts_at,
  updated_at = now()
from public.revenue_split_periods period
where settings.singleton = true
  and period.allocation_version = 'content-spend-10-20-70-v2-forward-only';

alter table public.platform_settings
alter column commission_rate set default 20.00,
alter column horse_care_rate set default 10.00,
alter column tipster_rate set default 70.00,
alter column revenue_split_effective_at set not null;

alter table public.content_purchases
alter column commission_rate set default 20.00,
alter column horse_care_rate set default 10.00,
alter column tipster_rate set default 70.00,
alter column allocation_version set default 'content-spend-10-20-70-v2-forward-only';

comment on column public.platform_settings.revenue_split_effective_at is
  'Start of the current forward-only revenue period. Earlier allocations remain immutable settled history.';
comment on table public.revenue_split_periods is
  'Immutable revenue-policy periods. New rates apply only to qualifying content spend recorded on or after the period start.';
comment on table public.revenue_opening_settlements is
  'Immutable opening settlement snapshot confirming obligations paid before a new revenue period starts; client wallets are never changed.';

create or replace function app_private.calculate_content_spend_split(
  p_purchased_credits integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $calculate_forward_content_spend_split$
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
    or settings_row.revenue_split_effective_at is null
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
    'allocationVersion', 'content-spend-10-20-70-v2-forward-only',
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
$calculate_forward_content_spend_split$;

revoke all on function app_private.calculate_content_spend_split(integer)
from public, anon, authenticated, service_role;

revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon, authenticated;
revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated;

revoke all on function public.purchase_meeting_card(uuid, text, boolean)
from public, anon, authenticated;
revoke all on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
from public, anon, authenticated;

create or replace function app_private.record_charity_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $record_forward_horse_care_contribution$
declare
  coin_rate numeric(12, 4);
  contribution_cents integer;
begin
  select zar_per_coin into coin_rate
  from public.platform_settings
  where singleton = true;

  coin_rate := coalesce(coin_rate, 1.0000);

  if tg_op = 'INSERT'
    and new.status <> 'refunded'
    and new.horse_care_coins > 0
  then
    contribution_cents := round(new.horse_care_coins * coin_rate * 100)::integer;

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
      round(new.horse_care_rate * 100)::integer,
      contribution_cents,
      'Horse Care allocation from Purchased Credits used on content',
      new.allocation_version
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
        round(new.horse_care_rate * 100)::integer,
        -contribution_cents,
        'Exact Horse Care reversal for refunded content spend',
        new.allocation_version
      ) on conflict do nothing;
    end if;
  end if;

  return new;
end;
$record_forward_horse_care_contribution$;

revoke all on function app_private.record_charity_contribution()
from public, anon, authenticated, service_role;

create or replace function public.get_charity_transparency()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $get_current_period_charity_transparency$
  with settings as (
    select horse_care_rate, revenue_split_effective_at
    from public.platform_settings
    where singleton = true
  ), current_contribution as (
    select coalesce(sum(entries.amount_cents), 0)::integer as accrued_cents
    from public.charity_contribution_entries entries
    cross join settings
    where entries.created_at >= settings.revenue_split_effective_at
  ), current_remittance as (
    select
      coalesce(sum(remittances.amount_cents), 0)::integer as transferred_cents,
      max(remittances.transferred_on) as last_transferred_on
    from public.charity_remittances remittances
    cross join settings
    where remittances.created_at >= settings.revenue_split_effective_at
  ), lifetime as (
    select
      coalesce((select sum(amount_cents) from public.charity_contribution_entries), 0)::integer as accrued_cents,
      coalesce((select sum(amount_cents) from public.charity_remittances), 0)::integer as transferred_cents
  )
  select jsonb_build_object(
    'accruedCents', current_contribution.accrued_cents,
    'transferredCents', current_remittance.transferred_cents,
    'outstandingCents', greatest(
      current_contribution.accrued_cents - current_remittance.transferred_cents,
      0
    ),
    'lastTransferredOn', current_remittance.last_transferred_on,
    'contributionRatePercent', settings.horse_care_rate,
    'basis', 'Purchased Credits used on meeting cards and subscriptions; Reward Credits excluded',
    'periodStartedAt', settings.revenue_split_effective_at,
    'lifetimeAccruedCents', lifetime.accrued_cents,
    'lifetimeTransferredCents', lifetime.transferred_cents,
    'updatedAt', now()
  )
  from settings
  cross join current_contribution
  cross join current_remittance
  cross join lifetime;
$get_current_period_charity_transparency$;

revoke all on function public.get_charity_transparency() from public;
grant execute on function public.get_charity_transparency() to anon, authenticated;

create or replace function public.get_my_tipster_recorded_earnings()
returns numeric
language sql
stable
security definer
set search_path = ''
as $get_my_current_period_tipster_earnings$
  select coalesce(sum(earnings.net_coins), 0)::numeric(12, 2)
  from public.tipster_earnings earnings
  join public.tipsters tipsters on tipsters.id = earnings.tipster_id
  cross join public.platform_settings settings
  where tipsters.user_id = (select auth.uid())
    and settings.singleton = true
    and earnings.created_at >= settings.revenue_split_effective_at;
$get_my_current_period_tipster_earnings$;

revoke all on function public.get_my_tipster_recorded_earnings()
from public, anon, authenticated;
grant execute on function public.get_my_tipster_recorded_earnings()
to authenticated;

comment on function public.get_my_tipster_recorded_earnings() is
  'Returns the signed-in tipster current-period net Credit balance. Settled history remains in the immutable earnings ledger.';

create or replace function public.admin_get_revenue_split_report(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $admin_get_forward_revenue_split_report$
declare
  current_user_id uuid := (select auth.uid());
  requested_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with settings as (
    select
      commission_rate,
      horse_care_rate,
      tipster_rate,
      revenue_split_effective_at
    from public.platform_settings
    where singleton = true
  ), period_purchases as (
    select purchases.*
    from public.content_purchases purchases
    cross join settings
    where purchases.created_at >= settings.revenue_split_effective_at
      and purchases.status in ('active', 'disputed')
  ), period_earnings as (
    select earnings.*
    from public.tipster_earnings earnings
    cross join settings
    where earnings.created_at >= settings.revenue_split_effective_at
  ), summary as (
    select
      (select count(*)::integer from period_purchases) as purchase_count,
      (
        select count(*)::integer
        from period_purchases
        where status = 'disputed'
      ) as disputed_count,
      (
        select coalesce(sum(gross_coins), 0)::numeric(14, 2)
        from period_purchases
      ) as content_credits_used,
      (
        select coalesce(sum(purchased_coins), 0)::numeric(14, 2)
        from period_purchases
      ) as purchased_credits_used,
      (
        select coalesce(sum(reward_coins), 0)::numeric(14, 2)
        from period_purchases
      ) as reward_credits_excluded,
      coalesce(sum(period_earnings.horse_care_coins), 0)::numeric(14, 2) as horse_care_credits,
      coalesce(sum(period_earnings.platform_fee_coins), 0)::numeric(14, 2) as platform_credits,
      coalesce(sum(period_earnings.net_coins), 0)::numeric(14, 2) as tipster_credits
    from period_earnings
  ), opening as (
    select
      periods.id as period_id,
      periods.starts_at,
      periods.opening_reason,
      coalesce(sum(entries.amount_credits) filter (
        where entries.beneficiary_type = 'horse_care'
      ), 0)::numeric(14, 2) as horse_care_credits,
      coalesce(sum(entries.amount_credits) filter (
        where entries.beneficiary_type = 'platform'
      ), 0)::numeric(14, 2) as platform_credits,
      coalesce(sum(entries.amount_credits) filter (
        where entries.beneficiary_type = 'tipster'
      ), 0)::numeric(14, 2) as tipster_credits
    from public.revenue_split_periods periods
    left join public.revenue_opening_settlements entries
      on entries.period_id = periods.id
    where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only'
    group by periods.id, periods.starts_at, periods.opening_reason
  ), by_tipster_rows as (
    select
      tipsters.id as tipster_id,
      tipsters.display_name,
      count(distinct earnings.purchase_id)::integer as purchase_count,
      coalesce(sum(earnings.gross_coins), 0)::numeric(14, 2) as purchased_credits_used,
      coalesce(sum(earnings.horse_care_coins), 0)::numeric(14, 2) as horse_care_credits,
      coalesce(sum(earnings.platform_fee_coins), 0)::numeric(14, 2) as platform_credits,
      coalesce(sum(earnings.net_coins), 0)::numeric(14, 2) as tipster_credits
    from period_earnings earnings
    join public.tipsters tipsters on tipsters.id = earnings.tipster_id
    group by tipsters.id, tipsters.display_name
  ), by_tipster_with_rewards as (
    select
      rows.*,
      coalesce((
        select sum(purchases.gross_coins)
        from period_purchases purchases
        where purchases.tipster_id = rows.tipster_id
      ), 0)::numeric(14, 2) as content_credits_used,
      coalesce((
        select sum(purchases.reward_coins)
        from period_purchases purchases
        where purchases.tipster_id = rows.tipster_id
      ), 0)::numeric(14, 2) as reward_credits_excluded
    from by_tipster_rows rows
  ), opening_tipsters as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'tipsterId', entries.tipster_id,
          'tipsterName', tipsters.display_name,
          'settledCredits', entries.amount_credits
        )
        order by tipsters.display_name
      ),
      '[]'::jsonb
    ) as items
    from public.revenue_opening_settlements entries
    join opening on opening.period_id = entries.period_id
    join public.tipsters tipsters on tipsters.id = entries.tipster_id
    where entries.beneficiary_type = 'tipster'
  ), recent_rows as (
    select
      purchases.id,
      purchases.created_at,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as status,
      purchases.gross_coins,
      purchases.purchased_coins,
      purchases.reward_coins,
      purchases.horse_care_coins,
      purchases.platform_fee_coins,
      purchases.tipster_net_coins,
      purchases.allocation_version,
      tipsters.display_name as tipster_name,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label
    from public.content_purchases purchases
    cross join settings
    join public.tipsters tipsters on tipsters.id = purchases.tipster_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    where purchases.created_at >= settings.revenue_split_effective_at
    order by purchases.created_at desc, purchases.id desc
    limit requested_limit
  )
  select jsonb_build_object(
    'policy', jsonb_build_object(
      'trigger', 'content_spend',
      'allocationVersion', 'content-spend-10-20-70-v2-forward-only',
      'effectiveAt', settings.revenue_split_effective_at,
      'horseCareRate', settings.horse_care_rate,
      'platformRate', settings.commission_rate,
      'tipsterRate', settings.tipster_rate,
      'rewardCreditsExcluded', true,
      'creditTopUpsExcluded', true
    ),
    'summary', jsonb_build_object(
      'purchaseCount', summary.purchase_count,
      'disputedCount', summary.disputed_count,
      'refundedPurchaseCount', (
        select count(*)
        from public.content_purchases purchases
        where purchases.created_at >= settings.revenue_split_effective_at
          and purchases.status = 'refunded'
      ),
      'historicalPurchaseCount', (
        select count(*)
        from public.content_purchases purchases
        where purchases.created_at < settings.revenue_split_effective_at
      ),
      'contentCreditsUsed', summary.content_credits_used,
      'purchasedCreditsUsed', summary.purchased_credits_used,
      'rewardCreditsExcluded', summary.reward_credits_excluded,
      'horseCareCredits', summary.horse_care_credits,
      'platformCredits', summary.platform_credits,
      'tipsterCredits', summary.tipster_credits,
      'allocatedCredits', summary.horse_care_credits
        + summary.platform_credits
        + summary.tipster_credits,
      'reconciliationDifference', summary.purchased_credits_used
        - summary.horse_care_credits
        - summary.platform_credits
        - summary.tipster_credits
    ),
    'openingSettlement', jsonb_build_object(
      'settledThrough', opening.starts_at,
      'reason', opening.opening_reason,
      'horseCareCredits', opening.horse_care_credits,
      'platformCredits', opening.platform_credits,
      'tipsterCredits', opening.tipster_credits,
      'totalCredits', opening.horse_care_credits
        + opening.platform_credits
        + opening.tipster_credits,
      'tipsters', opening_tipsters.items
    ),
    'byTipster', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'tipsterId', rows.tipster_id,
            'tipsterName', rows.display_name,
            'purchaseCount', rows.purchase_count,
            'contentCreditsUsed', rows.content_credits_used,
            'purchasedCreditsUsed', rows.purchased_credits_used,
            'rewardCreditsExcluded', rows.reward_credits_excluded,
            'horseCareCredits', rows.horse_care_credits,
            'platformCredits', rows.platform_credits,
            'tipsterCredits', rows.tipster_credits
          )
          order by rows.tipster_credits desc, rows.display_name
        )
        from by_tipster_with_rewards rows
      ),
      '[]'::jsonb
    ),
    'recent', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'purchaseId', rows.id,
            'createdAt', rows.created_at,
            'purchaseType', rows.purchase_type,
            'status', rows.status,
            'tipsterName', rows.tipster_name,
            'sourceLabel', rows.source_label,
            'contentCreditsUsed', rows.gross_coins,
            'purchasedCreditsUsed', rows.purchased_coins,
            'rewardCreditsExcluded', rows.reward_coins,
            'horseCareCredits', rows.horse_care_coins,
            'platformCredits', rows.platform_fee_coins,
            'tipsterCredits', rows.tipster_net_coins,
            'allocationVersion', rows.allocation_version
          )
          order by rows.created_at desc, rows.id desc
        )
        from recent_rows rows
      ),
      '[]'::jsonb
    ),
    'generatedAt', now()
  )
  into result
  from settings
  cross join summary
  cross join opening
  cross join opening_tipsters;

  return result;
end;
$admin_get_forward_revenue_split_report$;

revoke all on function public.admin_get_revenue_split_report(integer)
from public, anon, authenticated;
grant execute on function public.admin_get_revenue_split_report(integer)
to authenticated;

comment on function public.admin_get_revenue_split_report(integer) is
  'Returns the MFA-protected current 10/20/70 revenue period, opening settled history, and forward-only Credit-use allocations.';

do $verify_forward_only_revenue_period$
declare
  effective_at timestamptz;
  mismatch_count integer;
begin
  select revenue_split_effective_at
  into effective_at
  from public.platform_settings
  where singleton = true;

  if effective_at is null then
    raise exception 'The forward-only revenue period has no effective timestamp.';
  end if;

  select count(*) into mismatch_count
  from public.content_purchases purchases
  where purchases.created_at < effective_at
    and purchases.allocation_version = 'content-spend-10-20-70-v2-forward-only';

  if mismatch_count <> 0 then
    raise exception 'The forward-only migration rewrote % historical purchase(s).', mismatch_count;
  end if;

  select count(*) into mismatch_count
  from public.content_purchases purchases
  where purchases.platform_fee_coins
      + purchases.horse_care_coins
      + purchases.tipster_net_coins
      <> purchases.purchased_coins;

  if mismatch_count <> 0 then
    raise exception 'Revenue activation found % unreconciled purchase allocation(s).', mismatch_count;
  end if;
end;
$verify_forward_only_revenue_period$;
