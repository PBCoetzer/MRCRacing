create table if not exists public.admin_email_confirmation_actions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique
    check (char_length(request_id) between 8 and 200),
  actor_id uuid not null,
  user_id uuid not null,
  action text not null
    check (action in ('resend_confirmation', 'verify_email')),
  reason text not null
    check (char_length(btrim(reason)) between 10 and 2000),
  status text not null default 'processing'
    check (status in ('processing', 'succeeded', 'failed')),
  sanitized_error text
    check (sanitized_error is null or char_length(sanitized_error) <= 500),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'processing' and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

create index if not exists admin_email_confirmation_actions_user_created_idx
on public.admin_email_confirmation_actions (user_id, created_at desc);

create or replace function app_private.protect_admin_email_confirmation_actions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Administrator email-confirmation actions cannot be deleted.';
  end if;

  if old.id is distinct from new.id
    or old.request_id is distinct from new.request_id
    or old.actor_id is distinct from new.actor_id
    or old.user_id is distinct from new.user_id
    or old.action is distinct from new.action
    or old.reason is distinct from new.reason
    or old.created_at is distinct from new.created_at
  then
    raise exception 'Administrator email-confirmation action identity is immutable.';
  end if;

  if old.status <> 'processing'
    or new.status not in ('succeeded', 'failed')
  then
    raise exception 'Administrator email-confirmation action is already final.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_admin_email_confirmation_actions
on public.admin_email_confirmation_actions;
create trigger protect_admin_email_confirmation_actions
before update or delete on public.admin_email_confirmation_actions
for each row execute function app_private.protect_admin_email_confirmation_actions();

alter table public.admin_email_confirmation_actions enable row level security;

drop policy if exists admin_email_confirmation_actions_admin_read
on public.admin_email_confirmation_actions;
create policy admin_email_confirmation_actions_admin_read
on public.admin_email_confirmation_actions
for select
to authenticated
using (
  app_private.current_user_account_active()
  and app_private.current_user_has_role('administrator')
);

revoke all on public.admin_email_confirmation_actions
from public, anon, authenticated;
grant select on public.admin_email_confirmation_actions
to authenticated;

revoke all on function app_private.protect_admin_email_confirmation_actions()
from public, anon, authenticated;

comment on table public.admin_email_confirmation_actions is
  'Idempotent server-only staging records for administrator confirmation resends and manual email verification.';
