create index if not exists payments_paid_at_admin_idx
on public.payments (paid_at desc, id desc)
where status = 'paid';

create index if not exists tipster_earnings_created_at_admin_idx
on public.tipster_earnings (created_at desc, id desc);

create or replace function public.admin_list_gateway_payments(
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_page integer := greatest(coalesce(p_page, 1), 1);
  requested_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with page_rows as (
    select
      payments.id,
      coalesce(payments.paid_at, payments.created_at) as completed_at,
      users.email::text as account_email,
      coalesce(
        nullif(btrim(profiles.display_name), ''),
        nullif(btrim(concat_ws(' ', profiles.first_name, profiles.last_name)), '')
      ) as account_name,
      payments.amount_cents,
      payments.currency,
      payments.provider,
      payments.status::text as status
    from public.payments payments
    join auth.users users on users.id = payments.user_id
    left join public.profiles profiles on profiles.id = payments.user_id
    where payments.status = 'paid'
    order by payments.paid_at desc nulls last, payments.created_at desc, payments.id desc
    offset (requested_page - 1) * requested_page_size
    limit requested_page_size
  )
  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', page_rows.id,
            'createdAt', page_rows.completed_at,
            'accountEmail', page_rows.account_email,
            'accountName', page_rows.account_name,
            'amountCents', page_rows.amount_cents,
            'currency', page_rows.currency,
            'provider', page_rows.provider,
            'status', page_rows.status
          )
          order by page_rows.completed_at desc, page_rows.id desc
        )
        from page_rows
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from public.payments where status = 'paid'),
    'page', requested_page,
    'pageSize', requested_page_size
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_list_gateway_payments(integer, integer)
from public, anon;

grant execute on function public.admin_list_gateway_payments(integer, integer)
to authenticated;

comment on function public.admin_list_gateway_payments(integer, integer) is
  'Returns only provider-confirmed successful gateway payments to active administrators.';

create or replace function public.admin_list_internal_tipster_ledger(
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_page integer := greatest(coalesce(p_page, 1), 1);
  requested_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with page_rows as (
    select
      earnings.id,
      earnings.purchase_id,
      earnings.created_at,
      purchases.created_at as purchase_created_at,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.commission_rate,
      earnings.entry_type,
      earnings.gross_coins,
      earnings.platform_fee_coins,
      earnings.net_coins,
      client_users.email::text as client_email,
      coalesce(
        nullif(btrim(client_profiles.display_name), ''),
        nullif(btrim(concat_ws(' ', client_profiles.first_name, client_profiles.last_name)), '')
      ) as client_name,
      tipsters.display_name as tipster_name,
      tipster_users.email::text as tipster_email,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label
    from public.tipster_earnings earnings
    join public.content_purchases purchases on purchases.id = earnings.purchase_id
    join auth.users client_users on client_users.id = purchases.user_id
    left join public.profiles client_profiles on client_profiles.id = purchases.user_id
    join public.tipsters tipsters on tipsters.id = earnings.tipster_id
    left join auth.users tipster_users on tipster_users.id = tipsters.user_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    order by earnings.created_at desc, earnings.id desc
    offset (requested_page - 1) * requested_page_size
    limit requested_page_size
  )
  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', page_rows.id,
            'purchaseId', page_rows.purchase_id,
            'createdAt', page_rows.created_at,
            'purchaseCreatedAt', page_rows.purchase_created_at,
            'purchaseType', page_rows.purchase_type,
            'purchaseStatus', page_rows.purchase_status,
            'sourceLabel', page_rows.source_label,
            'entryType', page_rows.entry_type,
            'clientEmail', page_rows.client_email,
            'clientName', page_rows.client_name,
            'tipsterEmail', page_rows.tipster_email,
            'tipsterName', page_rows.tipster_name,
            'grossCredits', page_rows.gross_coins,
            'commissionRate', page_rows.commission_rate,
            'platformFeeCredits', page_rows.platform_fee_coins,
            'tipsterNetCredits', page_rows.net_coins
          )
          order by page_rows.created_at desc, page_rows.id desc
        )
        from page_rows
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from public.tipster_earnings),
    'page', requested_page,
    'pageSize', requested_page_size
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_list_internal_tipster_ledger(integer, integer)
from public, anon;

grant execute on function public.admin_list_internal_tipster_ledger(integer, integer)
to authenticated;

comment on function public.admin_list_internal_tipster_ledger(integer, integer) is
  'Returns the immutable client-to-tipster sale and refund ledger with sanitized account and Credit allocation details to active administrators.';
