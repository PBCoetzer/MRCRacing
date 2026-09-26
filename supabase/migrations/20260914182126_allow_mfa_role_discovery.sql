create or replace function app_private.current_user_account_visible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.account_is_active((select auth.uid()));
$$;

comment on function app_private.current_user_account_visible() is
  'Allows an active authenticated user to load identity data required to enter or configure MFA.';

revoke all on function app_private.current_user_account_visible()
from public, anon, authenticated;
grant execute on function app_private.current_user_account_visible()
to authenticated;

drop policy if exists user_roles_active_account on public.user_roles;
create policy user_roles_active_account
on public.user_roles
as restrictive
for all
to authenticated
using (app_private.current_user_account_visible())
with check (app_private.current_user_account_visible());
