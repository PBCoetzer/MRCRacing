-- Cover new foreign keys and keep payment snapshot reads to one RLS policy.

create index if not exists payment_credit_items_package_idx
on public.payment_credit_items (credit_package_id);

create index if not exists tip_card_access_logs_entitlement_idx
on public.tip_card_access_logs (entitlement_id);

drop policy if exists payment_credit_items_own_read
on public.payment_credit_items;
drop policy if exists payment_credit_items_admin_all
on public.payment_credit_items;

create policy payment_credit_items_authorized_read
on public.payment_credit_items for select
to authenticated
using (
  app_private.current_user_has_role('administrator')
  or exists (
    select 1
    from public.payments
    where payments.id = payment_credit_items.payment_id
      and payments.user_id = (select auth.uid())
  )
);
