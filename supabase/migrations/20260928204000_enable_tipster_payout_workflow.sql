begin;

revoke all on function public.request_my_tipster_payout()
from public, anon, authenticated;
revoke all on function public.confirm_my_tipster_payout_received(uuid)
from public, anon, authenticated;
revoke all on function public.admin_mark_tipster_payout_paid(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.request_my_tipster_payout()
to authenticated;
grant execute on function public.confirm_my_tipster_payout_received(uuid)
to authenticated;
grant execute on function public.admin_mark_tipster_payout_paid(uuid, text, text)
to authenticated;

commit;
