revoke execute on function public.purchase_meeting_card(uuid, text, boolean)
from authenticated;

revoke execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
from authenticated;

comment on function public.purchase_meeting_card(uuid, text, boolean) is
  'Temporarily unavailable during the 26 September 2026 financial allocation rollback.';

comment on function public.purchase_tipster_subscription(uuid, text, boolean, boolean) is
  'Temporarily unavailable during the 26 September 2026 financial allocation rollback.';
