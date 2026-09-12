drop policy if exists "user_terms_acceptances_select_own" on public.user_terms_acceptances;
drop policy if exists "user_terms_acceptances_admin_read" on public.user_terms_acceptances;
drop policy if exists "user_terms_acceptances_own_or_admin_read" on public.user_terms_acceptances;
create policy "user_terms_acceptances_own_or_admin_read"
on public.user_terms_acceptances for select
to authenticated
using (
  (select auth.uid()) = user_id
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "platform_settings_anon_terms_version_read" on public.platform_settings;
create policy "platform_settings_anon_terms_version_read"
on public.platform_settings for select
to anon
using (true);

grant select (premium_terms_version)
on public.platform_settings to anon;

create or replace function public.get_current_premium_terms_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select settings.premium_terms_version
  from public.platform_settings settings
  where settings.singleton
  limit 1;
$$;

revoke all on function public.get_current_premium_terms_version()
from public;
grant execute on function public.get_current_premium_terms_version()
to anon, authenticated;
