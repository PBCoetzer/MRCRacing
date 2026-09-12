drop policy if exists auth_email_messages_admin_read
on public.auth_email_messages;
create policy auth_email_messages_admin_read
on public.auth_email_messages
for select
to authenticated
using (
  (select app_private.current_user_account_active())
  and (select app_private.current_user_has_role('administrator'))
);

drop policy if exists auth_email_delivery_events_admin_read
on public.auth_email_delivery_events;
create policy auth_email_delivery_events_admin_read
on public.auth_email_delivery_events
for select
to authenticated
using (
  (select app_private.current_user_account_active())
  and (select app_private.current_user_has_role('administrator'))
);

grant select on public.auth_email_messages to authenticated;
grant select on public.auth_email_delivery_events to authenticated;
