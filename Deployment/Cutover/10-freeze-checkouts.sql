begin;

revoke execute on function public.create_credit_checkout_record(uuid, text, jsonb, text)
from service_role;

comment on function public.create_credit_checkout_record(uuid, text, jsonb, text) is
  'Temporarily frozen for the 2026-09-28 production financial cutover. Existing provider callbacks may still complete.';

commit;

select
  count(*) filter (
    where status = 'pending'
      and checkout_expires_at > now()
  ) as unexpired_pending_checkouts,
  min(checkout_expires_at) filter (
    where status = 'pending'
      and checkout_expires_at > now()
  ) as next_pending_expiry
from public.payments;
