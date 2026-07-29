revoke all on table public.credit_packages from public, anon, authenticated;
grant select on table public.credit_packages to anon;
grant select, insert, update, delete on table public.credit_packages to authenticated;

revoke all on table public.client_tipster_favourites from public, anon, authenticated;
grant select, insert, delete on table public.client_tipster_favourites to authenticated;

revoke all on table public.tipster_performance_stats from public, anon, authenticated;
grant select on table public.tipster_performance_stats to anon, authenticated;

revoke all on table public.payments from public, anon, authenticated;
grant select on table public.payments to authenticated;
grant all on table public.payments to service_role;

revoke all on function public.complete_credit_payment(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_credit_payment(uuid, text, text, jsonb)
to service_role;
