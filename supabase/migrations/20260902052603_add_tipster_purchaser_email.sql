create or replace function public.get_my_tipster_earnings_ledger_v2(
  p_limit integer default 20
)
returns table (
  id uuid,
  entry_type text,
  purchase_type text,
  source_label text,
  purchaser_email text,
  gross_coins numeric,
  platform_fee_coins numeric,
  net_coins numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is currently restricted.';
  end if;

  return query
  select
    earnings.id,
    earnings.entry_type,
    purchases.purchase_type::text,
    case
      when purchases.purchase_type = 'meeting'
        then coalesce(cards.title, 'Meeting card')
      else coalesce(packages.name, 'Tipster subscription')
    end,
    nullif(lower(btrim(purchasers.email)), ''),
    earnings.gross_coins,
    earnings.platform_fee_coins,
    earnings.net_coins,
    earnings.created_at
  from public.tipster_earnings earnings
  join public.tipsters tipsters
    on tipsters.id = earnings.tipster_id
   and tipsters.user_id = current_user_id
  join public.content_purchases purchases on purchases.id = earnings.purchase_id
  left join auth.users purchasers on purchasers.id = purchases.user_id
  left join public.tip_cards cards on cards.id = purchases.tip_card_id
  left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
  order by earnings.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.get_my_tipster_earnings_ledger_v2(integer)
from public, anon, authenticated;
grant execute on function public.get_my_tipster_earnings_ledger_v2(integer)
to authenticated;

comment on function public.get_my_tipster_earnings_ledger_v2(integer) is
  'Returns the signed-in tipster earnings ledger with the purchaser email for that tipster own sales only.';
