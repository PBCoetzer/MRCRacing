create table public.tipster_payout_requests (
  id uuid primary key default gen_random_uuid(),
  tipster_id uuid not null references public.tipsters(id),
  period_id uuid not null references public.revenue_split_periods(id),
  status text not null default 'requested'
    check (status in ('requested', 'paid', 'received')),
  amount_credits numeric(14, 2) not null check (amount_credits > 0),
  requested_through timestamptz not null,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  paid_by uuid references auth.users(id),
  paid_at timestamptz,
  payment_reference text,
  admin_note text,
  received_by uuid references auth.users(id),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tipster_payout_requests_state_check check (
    (
      status = 'requested'
      and paid_by is null
      and paid_at is null
      and payment_reference is null
      and received_by is null
      and received_at is null
    )
    or (
      status = 'paid'
      and paid_by is not null
      and paid_at is not null
      and nullif(btrim(payment_reference), '') is not null
      and received_by is null
      and received_at is null
    )
    or (
      status = 'received'
      and paid_by is not null
      and paid_at is not null
      and nullif(btrim(payment_reference), '') is not null
      and received_by is not null
      and received_at is not null
    )
  )
);

create table public.tipster_payout_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.tipster_payout_requests(id),
  earning_id uuid not null references public.tipster_earnings(id),
  net_credits numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  constraint tipster_payout_request_items_earning_key unique (earning_id)
);

create unique index tipster_payout_requests_open_tipster_key
on public.tipster_payout_requests (tipster_id)
where status in ('requested', 'paid');

create index tipster_payout_requests_tipster_requested_idx
on public.tipster_payout_requests (tipster_id, requested_at desc);

create index tipster_payout_requests_status_requested_idx
on public.tipster_payout_requests (status, requested_at desc);

create index tipster_payout_request_items_request_idx
on public.tipster_payout_request_items (request_id);

drop trigger if exists tipster_payout_requests_set_updated_at
on public.tipster_payout_requests;
create trigger tipster_payout_requests_set_updated_at
before update on public.tipster_payout_requests
for each row execute function public.set_updated_at();

create or replace function app_private.protect_tipster_payout_request()
returns trigger
language plpgsql
set search_path = ''
as $protect_tipster_payout_request$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payout requests are immutable financial records.';
  end if;

  if old.tipster_id is distinct from new.tipster_id
    or old.period_id is distinct from new.period_id
    or old.amount_credits is distinct from new.amount_credits
    or old.requested_through is distinct from new.requested_through
    or old.requested_by is distinct from new.requested_by
    or old.requested_at is distinct from new.requested_at
    or old.created_at is distinct from new.created_at
  then
    raise exception 'Payout request identity and amount are immutable.';
  end if;

  if old.status = 'requested' and new.status not in ('requested', 'paid') then
    raise exception 'A requested payout can only be marked paid.';
  elsif old.status = 'paid' and new.status not in ('paid', 'received') then
    raise exception 'A paid payout can only be confirmed received.';
  elsif old.status = 'received' and new.status <> 'received' then
    raise exception 'A received payout cannot be changed.';
  end if;

  return new;
end;
$protect_tipster_payout_request$;

revoke all on function app_private.protect_tipster_payout_request()
from public, anon, authenticated;

drop trigger if exists tipster_payout_requests_protect
on public.tipster_payout_requests;
create trigger tipster_payout_requests_protect
before update or delete on public.tipster_payout_requests
for each row execute function app_private.protect_tipster_payout_request();

drop trigger if exists tipster_payout_request_items_immutable
on public.tipster_payout_request_items;
create trigger tipster_payout_request_items_immutable
before update or delete on public.tipster_payout_request_items
for each row execute function app_private.reject_immutable_record_change();

alter table public.tipster_payout_requests enable row level security;
alter table public.tipster_payout_request_items enable row level security;

revoke all on public.tipster_payout_requests from anon, authenticated;
revoke all on public.tipster_payout_request_items from anon, authenticated;

comment on table public.tipster_payout_requests is
  'Forward-only Tipster payout workflow for earnings created during the active 10/20/70 revenue period.';
comment on table public.tipster_payout_request_items is
  'Immutable assignment of individual Tipster earning rows to one payout request, preventing duplicate payment.';

create or replace function public.get_my_tipster_finance_dashboard(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_my_tipster_finance_dashboard$
declare
  current_user_id uuid := (select auth.uid());
  current_tipster_id uuid;
  requested_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
  then
    raise exception 'Active Tipster access required.';
  end if;

  select tipsters.id
  into current_tipster_id
  from public.tipsters tipsters
  where tipsters.user_id = current_user_id
    and tipsters.is_verified
  limit 1;

  if current_tipster_id is null then
    raise exception 'A verified Tipster profile is required.';
  end if;

  with period as (
    select periods.*
    from public.revenue_split_periods periods
    where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only'
  ), current_entries as (
    select
      earnings.id,
      earnings.id as earning_id,
      earnings.created_at,
      earnings.entry_type,
      earnings.gross_coins,
      earnings.platform_fee_coins,
      earnings.net_coins,
      earnings.horse_care_coins,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.reward_coins,
      purchases.allocation_version,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label
    from public.tipster_earnings earnings
    join public.content_purchases purchases on purchases.id = earnings.purchase_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    cross join period
    where earnings.tipster_id = current_tipster_id
      and earnings.created_at >= period.starts_at
      and purchases.created_at >= period.starts_at
      and purchases.allocation_version = period.allocation_version
    union all
    select
      purchases.id,
      null::uuid as earning_id,
      purchases.created_at,
      'sale'::text as entry_type,
      0::numeric as gross_coins,
      0::numeric as platform_fee_coins,
      0::numeric as net_coins,
      0::numeric as horse_care_coins,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.reward_coins,
      purchases.allocation_version,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label
    from public.content_purchases purchases
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    cross join period
    where purchases.tipster_id = current_tipster_id
      and purchases.created_at >= period.starts_at
      and purchases.allocation_version = period.allocation_version
      and purchases.purchased_coins = 0
  ), assigned_entries as (
    select
      items.earning_id,
      requests.id as request_id,
      requests.status as payout_status
    from public.tipster_payout_request_items items
    join public.tipster_payout_requests requests on requests.id = items.request_id
    where requests.tipster_id = current_tipster_id
  ), summary as (
    select
      coalesce(sum(entries.net_coins), 0)::numeric(14, 2) as total_earned,
      coalesce(sum(entries.net_coins) filter (
        where entries.earning_id is not null
          and assigned.earning_id is null
      ), 0)::numeric(14, 2) as available_to_request
    from current_entries entries
    left join assigned_entries assigned on assigned.earning_id = entries.earning_id
  ), request_summary as (
    select
      coalesce(sum(amount_credits) filter (where status = 'requested'), 0)::numeric(14, 2) as requested,
      coalesce(sum(amount_credits) filter (where status = 'paid'), 0)::numeric(14, 2) as paid_awaiting_confirmation,
      coalesce(sum(amount_credits) filter (where status = 'received'), 0)::numeric(14, 2) as received
    from public.tipster_payout_requests
    where tipster_id = current_tipster_id
  ), entry_rows as (
    select
      entries.*,
      assigned.request_id,
      case
        when entries.earning_id is null then 'not_applicable'
        else coalesce(assigned.payout_status, 'available')
      end as payout_status
    from current_entries entries
    left join assigned_entries assigned on assigned.earning_id = entries.earning_id
    order by entries.created_at desc, entries.id desc
    limit requested_limit
  ), request_rows as (
    select requests.*
    from public.tipster_payout_requests requests
    where requests.tipster_id = current_tipster_id
    order by requests.requested_at desc, requests.id desc
    limit 50
  )
  select jsonb_build_object(
    'policy', jsonb_build_object(
      'allocationVersion', period.allocation_version,
      'effectiveAt', period.starts_at,
      'horseCareRate', period.horse_care_rate,
      'platformRate', period.platform_rate,
      'tipsterRate', period.tipster_rate,
      'rewardCreditsExcluded', period.reward_credits_excluded
    ),
    'summary', jsonb_build_object(
      'totalEarnedCredits', summary.total_earned,
      'availableToRequestCredits', summary.available_to_request,
      'requestedCredits', request_summary.requested,
      'paidAwaitingConfirmationCredits', request_summary.paid_awaiting_confirmation,
      'receivedCredits', request_summary.received
    ),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rows.id,
        'createdAt', rows.created_at,
        'entryType', rows.entry_type,
        'purchaseType', rows.purchase_type,
        'purchaseStatus', rows.purchase_status,
        'sourceLabel', rows.source_label,
        'purchasedCredits', rows.gross_coins,
        'rewardCreditsExcluded', case
          when rows.entry_type = 'sale' then rows.reward_coins
          when rows.entry_type = 'refund' then -rows.reward_coins
          else 0
        end,
        'horseCareCredits', rows.horse_care_coins,
        'platformCredits', rows.platform_fee_coins,
        'tipsterCredits', rows.net_coins,
        'payoutRequestId', rows.request_id,
        'payoutStatus', rows.payout_status,
        'allocationVersion', rows.allocation_version
      ) order by rows.created_at desc, rows.id desc)
      from entry_rows rows
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId', rows.id,
        'status', rows.status,
        'amountCredits', rows.amount_credits,
        'requestedThrough', rows.requested_through,
        'requestedAt', rows.requested_at,
        'paidAt', rows.paid_at,
        'paymentReference', rows.payment_reference,
        'adminNote', rows.admin_note,
        'receivedAt', rows.received_at
      ) order by rows.requested_at desc, rows.id desc)
      from request_rows rows
    ), '[]'::jsonb),
    'generatedAt', now()
  )
  into result
  from period
  cross join summary
  cross join request_summary;

  return result;
end;
$get_my_tipster_finance_dashboard$;

revoke all on function public.get_my_tipster_finance_dashboard(integer)
from public, anon, authenticated;
grant execute on function public.get_my_tipster_finance_dashboard(integer)
to authenticated;

create or replace function public.request_my_tipster_payout()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $request_my_tipster_payout$
declare
  current_user_id uuid := (select auth.uid());
  current_tipster_id uuid;
  current_period_id uuid;
  current_period_started_at timestamptz;
  request_cutoff timestamptz := clock_timestamp();
  available_amount numeric(14, 2);
  new_request_id uuid;
  inserted_amount numeric(14, 2);
  inserted_count integer;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
  then
    raise exception 'Active Tipster access required.';
  end if;

  select tipsters.id
  into current_tipster_id
  from public.tipsters tipsters
  where tipsters.user_id = current_user_id
    and tipsters.is_verified
  for update;

  if current_tipster_id is null then
    raise exception 'A verified Tipster profile is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('tipster-payout:' || current_tipster_id::text, 0)
  );

  if exists (
    select 1
    from public.tipster_payout_requests requests
    where requests.tipster_id = current_tipster_id
      and requests.status in ('requested', 'paid')
  ) then
    raise exception 'An existing payout is still awaiting payment or receipt confirmation.';
  end if;

  select periods.id, periods.starts_at
  into current_period_id, current_period_started_at
  from public.revenue_split_periods periods
  where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only';

  select coalesce(sum(earnings.net_coins), 0)::numeric(14, 2)
  into available_amount
  from public.tipster_earnings earnings
  join public.content_purchases purchases on purchases.id = earnings.purchase_id
  where earnings.tipster_id = current_tipster_id
    and earnings.created_at >= current_period_started_at
    and earnings.created_at <= request_cutoff
    and purchases.created_at >= current_period_started_at
    and purchases.allocation_version = 'content-spend-10-20-70-v2-forward-only'
    and not exists (
      select 1
      from public.tipster_payout_request_items items
      where items.earning_id = earnings.id
    );

  if available_amount <= 0 then
    raise exception 'There is no positive available balance to request.';
  end if;

  insert into public.tipster_payout_requests (
    tipster_id,
    period_id,
    amount_credits,
    requested_through,
    requested_by
  ) values (
    current_tipster_id,
    current_period_id,
    available_amount,
    request_cutoff,
    current_user_id
  )
  returning id into new_request_id;

  insert into public.tipster_payout_request_items (
    request_id,
    earning_id,
    net_credits
  )
  select
    new_request_id,
    earnings.id,
    earnings.net_coins
  from public.tipster_earnings earnings
  join public.content_purchases purchases on purchases.id = earnings.purchase_id
  where earnings.tipster_id = current_tipster_id
    and earnings.created_at >= current_period_started_at
    and earnings.created_at <= request_cutoff
    and purchases.created_at >= current_period_started_at
    and purchases.allocation_version = 'content-spend-10-20-70-v2-forward-only'
    and not exists (
      select 1
      from public.tipster_payout_request_items existing_items
      where existing_items.earning_id = earnings.id
    );

  get diagnostics inserted_count = row_count;

  select coalesce(sum(items.net_credits), 0)::numeric(14, 2)
  into inserted_amount
  from public.tipster_payout_request_items items
  where items.request_id = new_request_id;

  if inserted_count = 0 or inserted_amount <> available_amount then
    raise exception 'The payout request could not reconcile its earning rows.';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    'tipster_payout_requested',
    'tipster_payout_request',
    new_request_id,
    jsonb_build_object(
      'tipsterId', current_tipster_id,
      'amountCredits', available_amount,
      'earningRowCount', inserted_count,
      'allocationVersion', 'content-spend-10-20-70-v2-forward-only'
    )
  );

  return jsonb_build_object(
    'requestId', new_request_id,
    'status', 'requested',
    'amountCredits', available_amount,
    'earningRowCount', inserted_count,
    'requestedAt', request_cutoff
  );
end;
$request_my_tipster_payout$;

revoke all on function public.request_my_tipster_payout()
from public, anon, authenticated;

comment on function public.request_my_tipster_payout() is
  'Creates a reconciled current-period Tipster payout request. Execute remains frozen until production cutover verification completes.';

create or replace function public.confirm_my_tipster_payout_received(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $confirm_my_tipster_payout_received$
declare
  current_user_id uuid := (select auth.uid());
  payout_row public.tipster_payout_requests%rowtype;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
  then
    raise exception 'Active Tipster access required.';
  end if;

  select requests.*
  into payout_row
  from public.tipster_payout_requests requests
  join public.tipsters tipsters on tipsters.id = requests.tipster_id
  where requests.id = p_request_id
    and tipsters.user_id = current_user_id
  for update of requests;

  if payout_row.id is null then
    raise exception 'Payout request not found.';
  end if;

  if payout_row.status <> 'paid' then
    raise exception 'Only a paid payout can be confirmed received.';
  end if;

  update public.tipster_payout_requests
  set
    status = 'received',
    received_by = current_user_id,
    received_at = now()
  where id = payout_row.id
  returning * into payout_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    'tipster_payout_received',
    'tipster_payout_request',
    payout_row.id,
    jsonb_build_object(
      'tipsterId', payout_row.tipster_id,
      'amountCredits', payout_row.amount_credits,
      'paymentReference', payout_row.payment_reference
    )
  );

  return jsonb_build_object(
    'requestId', payout_row.id,
    'status', payout_row.status,
    'amountCredits', payout_row.amount_credits,
    'receivedAt', payout_row.received_at
  );
end;
$confirm_my_tipster_payout_received$;

revoke all on function public.confirm_my_tipster_payout_received(uuid)
from public, anon, authenticated;

comment on function public.confirm_my_tipster_payout_received(uuid) is
  'Lets the owning Tipster confirm receipt after administrator payment. Execute remains frozen until production cutover verification completes.';

create or replace function public.admin_get_tipster_payout_dashboard(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $admin_get_tipster_payout_dashboard$
declare
  current_user_id uuid := (select auth.uid());
  requested_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with period as (
    select periods.*
    from public.revenue_split_periods periods
    where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only'
  ), current_entries as (
    select earnings.*
    from public.tipster_earnings earnings
    join public.content_purchases purchases on purchases.id = earnings.purchase_id
    cross join period
    where earnings.created_at >= period.starts_at
      and purchases.created_at >= period.starts_at
      and purchases.allocation_version = period.allocation_version
  ), allocated as (
    select items.earning_id, requests.status
    from public.tipster_payout_request_items items
    join public.tipster_payout_requests requests on requests.id = items.request_id
  ), tipster_rows as (
    select
      tipsters.id,
      tipsters.display_name,
      count(entries.id)::integer as entry_count,
      coalesce(sum(entries.net_coins), 0)::numeric(14, 2) as total_earned,
      coalesce(sum(entries.net_coins) filter (
        where allocated.earning_id is null
      ), 0)::numeric(14, 2) as available,
      coalesce(sum(entries.net_coins) filter (
        where allocated.status = 'requested'
      ), 0)::numeric(14, 2) as requested,
      coalesce(sum(entries.net_coins) filter (
        where allocated.status = 'paid'
      ), 0)::numeric(14, 2) as paid,
      coalesce(sum(entries.net_coins) filter (
        where allocated.status = 'received'
      ), 0)::numeric(14, 2) as received
    from public.tipsters tipsters
    left join current_entries entries on entries.tipster_id = tipsters.id
    left join allocated on allocated.earning_id = entries.id
    where tipsters.is_verified
    group by tipsters.id, tipsters.display_name
  ), request_rows as (
    select
      requests.*,
      tipsters.display_name,
      count(items.id)::integer as earning_row_count
    from public.tipster_payout_requests requests
    join public.tipsters tipsters on tipsters.id = requests.tipster_id
    left join public.tipster_payout_request_items items on items.request_id = requests.id
    group by requests.id, tipsters.display_name
    order by requests.requested_at desc, requests.id desc
    limit requested_limit
  )
  select jsonb_build_object(
    'byTipster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipsterId', rows.id,
        'tipsterName', rows.display_name,
        'entryCount', rows.entry_count,
        'totalEarnedCredits', rows.total_earned,
        'availableCredits', rows.available,
        'requestedCredits', rows.requested,
        'paidAwaitingConfirmationCredits', rows.paid,
        'receivedCredits', rows.received
      ) order by rows.display_name)
      from tipster_rows rows
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId', rows.id,
        'tipsterId', rows.tipster_id,
        'tipsterName', rows.display_name,
        'status', rows.status,
        'amountCredits', rows.amount_credits,
        'earningRowCount', rows.earning_row_count,
        'requestedThrough', rows.requested_through,
        'requestedAt', rows.requested_at,
        'paidAt', rows.paid_at,
        'paymentReference', rows.payment_reference,
        'adminNote', rows.admin_note,
        'receivedAt', rows.received_at
      ) order by rows.requested_at desc, rows.id desc)
      from request_rows rows
    ), '[]'::jsonb),
    'generatedAt', now()
  )
  into result;

  return result;
end;
$admin_get_tipster_payout_dashboard$;

revoke all on function public.admin_get_tipster_payout_dashboard(integer)
from public, anon, authenticated;
grant execute on function public.admin_get_tipster_payout_dashboard(integer)
to authenticated;

create or replace function public.admin_mark_tipster_payout_paid(
  p_request_id uuid,
  p_payment_reference text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $admin_mark_tipster_payout_paid$
declare
  current_user_id uuid := (select auth.uid());
  normalized_reference text := nullif(btrim(p_payment_reference), '');
  normalized_note text := nullif(btrim(p_admin_note), '');
  payout_row public.tipster_payout_requests%rowtype;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  if normalized_reference is null or char_length(normalized_reference) > 160 then
    raise exception 'A payment reference of 1 to 160 characters is required.';
  end if;

  if normalized_note is not null and char_length(normalized_note) > 500 then
    raise exception 'The administrator note cannot exceed 500 characters.';
  end if;

  select requests.*
  into payout_row
  from public.tipster_payout_requests requests
  where requests.id = p_request_id
  for update;

  if payout_row.id is null then
    raise exception 'Payout request not found.';
  end if;

  if payout_row.status <> 'requested' then
    raise exception 'Only a requested payout can be marked paid.';
  end if;

  update public.tipster_payout_requests
  set
    status = 'paid',
    paid_by = current_user_id,
    paid_at = now(),
    payment_reference = normalized_reference,
    admin_note = normalized_note
  where id = payout_row.id
  returning * into payout_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    current_user_id,
    'tipster_payout_marked_paid',
    'tipster_payout_request',
    payout_row.id,
    jsonb_build_object(
      'tipsterId', payout_row.tipster_id,
      'amountCredits', payout_row.amount_credits,
      'paymentReference', payout_row.payment_reference
    )
  );

  return jsonb_build_object(
    'requestId', payout_row.id,
    'status', payout_row.status,
    'amountCredits', payout_row.amount_credits,
    'paidAt', payout_row.paid_at,
    'paymentReference', payout_row.payment_reference
  );
end;
$admin_mark_tipster_payout_paid$;

revoke all on function public.admin_mark_tipster_payout_paid(uuid, text, text)
from public, anon, authenticated;

comment on function public.admin_mark_tipster_payout_paid(uuid, text, text) is
  'Records administrator payment evidence for a requested Tipster payout. Execute remains frozen until production cutover verification completes.';

create or replace function public.admin_get_current_revenue_ledger(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tipster_id uuid default null,
  p_limit integer default 5000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $admin_get_current_revenue_ledger$
declare
  current_user_id uuid := (select auth.uid());
  period_row public.revenue_split_periods%rowtype;
  requested_from timestamptz;
  requested_to timestamptz;
  requested_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 10000);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  select periods.*
  into period_row
  from public.revenue_split_periods periods
  where periods.allocation_version = 'content-spend-10-20-70-v2-forward-only';

  requested_from := greatest(coalesce(p_from, period_row.starts_at), period_row.starts_at);
  requested_to := coalesce(p_to, now() + interval '1 second');

  if requested_to <= requested_from then
    raise exception 'The report end must be after the report start.';
  end if;

  with ledger_rows as (
    select
      earnings.id as ledger_id,
      earnings.created_at,
      earnings.entry_type,
      purchases.id as purchase_id,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.gross_coins,
      purchases.purchased_coins,
      purchases.reward_coins,
      purchases.allocation_version,
      tipsters.id as tipster_id,
      tipsters.display_name as tipster_name,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label,
      earnings.gross_coins as purchased_credits,
      case
        when earnings.entry_type = 'sale' then purchases.gross_coins
        when earnings.entry_type = 'refund' then -purchases.gross_coins
        else 0
      end as content_credits,
      case
        when earnings.entry_type = 'sale' then purchases.reward_coins
        when earnings.entry_type = 'refund' then -purchases.reward_coins
        else 0
      end as reward_credits,
      earnings.horse_care_coins,
      earnings.platform_fee_coins,
      earnings.net_coins as tipster_credits,
      payout_requests.id as payout_request_id,
      payout_requests.status as payout_status
    from public.tipster_earnings earnings
    join public.content_purchases purchases on purchases.id = earnings.purchase_id
    join public.tipsters tipsters on tipsters.id = earnings.tipster_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    left join public.tipster_payout_request_items payout_items
      on payout_items.earning_id = earnings.id
    left join public.tipster_payout_requests payout_requests
      on payout_requests.id = payout_items.request_id
    where earnings.created_at >= requested_from
      and earnings.created_at < requested_to
      and purchases.created_at >= period_row.starts_at
      and purchases.allocation_version = period_row.allocation_version
      and (p_tipster_id is null or earnings.tipster_id = p_tipster_id)
    union all
    select
      purchases.id as ledger_id,
      purchases.created_at,
      'sale'::text as entry_type,
      purchases.id as purchase_id,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.gross_coins,
      purchases.purchased_coins,
      purchases.reward_coins,
      purchases.allocation_version,
      tipsters.id as tipster_id,
      tipsters.display_name as tipster_name,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label,
      0::numeric as purchased_credits,
      purchases.gross_coins as content_credits,
      purchases.reward_coins as reward_credits,
      0::numeric as horse_care_coins,
      0::numeric as platform_fee_coins,
      0::numeric as tipster_credits,
      null::uuid as payout_request_id,
      null::text as payout_status
    from public.content_purchases purchases
    join public.tipsters tipsters on tipsters.id = purchases.tipster_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    where purchases.created_at >= requested_from
      and purchases.created_at < requested_to
      and purchases.created_at >= period_row.starts_at
      and purchases.allocation_version = period_row.allocation_version
      and purchases.purchased_coins = 0
      and (p_tipster_id is null or purchases.tipster_id = p_tipster_id)
    order by created_at desc, ledger_id desc
    limit requested_limit
  ), summary as (
    select
      count(*)::integer as transaction_count,
      count(distinct purchase_id)::integer as purchase_count,
      coalesce(sum(content_credits), 0)::numeric(14, 2) as content_credits,
      coalesce(sum(purchased_credits), 0)::numeric(14, 2) as purchased_credits,
      coalesce(sum(reward_credits), 0)::numeric(14, 2) as reward_credits,
      coalesce(sum(horse_care_coins), 0)::numeric(14, 2) as horse_care_credits,
      coalesce(sum(platform_fee_coins), 0)::numeric(14, 2) as platform_credits,
      coalesce(sum(tipster_credits), 0)::numeric(14, 2) as tipster_credits
    from ledger_rows
  )
  select jsonb_build_object(
    'policy', jsonb_build_object(
      'allocationVersion', period_row.allocation_version,
      'effectiveAt', period_row.starts_at,
      'horseCareRate', period_row.horse_care_rate,
      'platformRate', period_row.platform_rate,
      'tipsterRate', period_row.tipster_rate,
      'rewardCreditsExcluded', period_row.reward_credits_excluded
    ),
    'filters', jsonb_build_object(
      'from', requested_from,
      'toExclusive', requested_to,
      'tipsterId', p_tipster_id,
      'limit', requested_limit
    ),
    'summary', jsonb_build_object(
      'transactionCount', summary.transaction_count,
      'purchaseCount', summary.purchase_count,
      'contentCredits', summary.content_credits,
      'purchasedCredits', summary.purchased_credits,
      'rewardCreditsExcluded', summary.reward_credits,
      'horseCareCredits', summary.horse_care_credits,
      'platformCredits', summary.platform_credits,
      'tipsterCredits', summary.tipster_credits,
      'reconciliationDifference', summary.purchased_credits
        - summary.horse_care_credits
        - summary.platform_credits
        - summary.tipster_credits
    ),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ledgerId', rows.ledger_id,
        'createdAt', rows.created_at,
        'entryType', rows.entry_type,
        'purchaseId', rows.purchase_id,
        'purchaseType', rows.purchase_type,
        'purchaseStatus', rows.purchase_status,
        'tipsterId', rows.tipster_id,
        'tipsterName', rows.tipster_name,
        'sourceLabel', rows.source_label,
        'contentCredits', rows.content_credits,
        'purchasedCredits', rows.purchased_credits,
        'rewardCreditsExcluded', rows.reward_credits,
        'horseCareCredits', rows.horse_care_coins,
        'platformCredits', rows.platform_fee_coins,
        'tipsterCredits', rows.tipster_credits,
        'payoutRequestId', rows.payout_request_id,
        'payoutStatus', case
          when rows.purchased_credits = 0 then 'not_applicable'
          else coalesce(rows.payout_status, 'available')
        end,
        'allocationVersion', rows.allocation_version
      ) order by rows.created_at desc, rows.ledger_id desc)
      from ledger_rows rows
    ), '[]'::jsonb),
    'generatedAt', now()
  )
  into result
  from summary;

  return result;
end;
$admin_get_current_revenue_ledger$;

revoke all on function public.admin_get_current_revenue_ledger(
  timestamptz,
  timestamptz,
  uuid,
  integer
)
from public, anon, authenticated;
grant execute on function public.admin_get_current_revenue_ledger(
  timestamptz,
  timestamptz,
  uuid,
  integer
)
to authenticated;

comment on function public.get_my_tipster_finance_dashboard(integer) is
  'Returns only the signed-in Tipster current 10/20/70 period earnings, payout assignments, and payment status.';
comment on function public.admin_get_tipster_payout_dashboard(integer) is
  'Returns administrator-only current-period Tipster balances and payout requests.';
comment on function public.admin_get_current_revenue_ledger(timestamptz, timestamptz, uuid, integer) is
  'Exports administrator-only transaction detail for the forward 10/20/70 period; pre-period settled history is excluded.';
