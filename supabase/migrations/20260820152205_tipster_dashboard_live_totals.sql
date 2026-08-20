-- Return an exact all-time earnings total for the signed-in tipster.
-- The recent-ledger query remains limited for UI performance.

create or replace function public.get_my_tipster_recorded_earnings()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $get_my_tipster_recorded_earnings$
  select coalesce(sum(earnings.net_coins), 0)::numeric(12, 2)
  from public.tipster_earnings earnings
  join public.tipsters tipsters on tipsters.id = earnings.tipster_id
  where tipsters.user_id = (select auth.uid());
$get_my_tipster_recorded_earnings$;

revoke all on function public.get_my_tipster_recorded_earnings()
from public, anon, authenticated;
grant execute on function public.get_my_tipster_recorded_earnings()
to authenticated;

comment on function public.get_my_tipster_recorded_earnings() is
  'Returns the signed-in tipster all-time net Credit earnings, including refund reversals.';
