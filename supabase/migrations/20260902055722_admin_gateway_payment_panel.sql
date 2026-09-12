create index if not exists payments_created_at_admin_idx
on public.payments (created_at desc, id desc);

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
      payments.created_at,
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
    order by payments.created_at desc, payments.id desc
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
            'createdAt', page_rows.created_at,
            'accountEmail', page_rows.account_email,
            'accountName', page_rows.account_name,
            'amountCents', page_rows.amount_cents,
            'currency', page_rows.currency,
            'provider', page_rows.provider,
            'status', page_rows.status
          )
          order by page_rows.created_at desc, page_rows.id desc
        )
        from page_rows
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from public.payments),
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
  'Returns a paginated administrator-only list of sanitized payment account, amount, gateway, status, and timestamp fields.';
