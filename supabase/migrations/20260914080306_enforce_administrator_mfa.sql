create or replace function app_private.current_user_mfa_satisfied(
  require_enrollment boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2' then true
    when require_enrollment then false
    else not exists (
      select 1
      from auth.mfa_factors factors
      where factors.user_id = (select auth.uid())
        and factors.status = 'verified'
    )
  end;
$$;

comment on function app_private.current_user_mfa_satisfied(boolean) is
  'Requires AAL2 for users with a verified MFA factor and can require MFA enrollment for privileged roles.';

create or replace function app_private.current_user_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.account_is_active((select auth.uid()))
    and app_private.current_user_mfa_satisfied(false);
$$;

create or replace function app_private.current_user_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.current_user_account_active()
    and app_private.current_user_mfa_satisfied(true)
    and exists (
      select 1
      from public.platform_owners
      where user_id = (select auth.uid())
    );
$$;

create or replace function app_private.current_user_has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.current_user_account_active()
    and (
      required_role <> 'administrator'::public.app_role
      or app_private.current_user_mfa_satisfied(true)
    )
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role = required_role
    );
$$;

comment on function app_private.current_user_has_role(public.app_role) is
  'Checks active role membership, requires AAL2 for enrolled users, and always requires AAL2 for administrators.';
