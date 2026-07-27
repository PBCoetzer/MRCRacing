create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('client', 'tipster', 'administrator');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'tip_status'
  ) then
    create type public.tip_status as enum ('draft', 'scheduled', 'published', 'settled', 'void');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'tip_visibility'
  ) then
    create type public.tip_visibility as enum ('free', 'premium');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'payment_status'
  ) then
    create type public.payment_status as enum ('pending', 'paid', 'failed', 'cancelled', 'refunded');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'credit_transaction_type'
  ) then
    create type public.credit_transaction_type as enum ('purchase', 'unlock', 'refund', 'admin_add', 'admin_remove', 'reversal');
  end if;
end $$;

create schema if not exists app_private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_path text,
  accepted_terms_at timestamptz,
  confirmed_over_18_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function app_private.current_user_has_role(required_role public.app_role)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = required_role
  );
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    phone,
    accepted_terms_at,
    confirmed_over_18_at
  )
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case
      when lower(coalesce(new.raw_user_meta_data ->> 'accepted_terms', 'false')) = 'true'
      then now()
      else null
    end,
    case
      when lower(coalesce(new.raw_user_meta_data ->> 'confirmed_over_18', 'false')) = 'true'
      then now()
      else null
    end
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'client')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

create table if not exists public.tipsters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  biography text,
  photo_path text,
  is_verified boolean not null default false,
  ranking integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.fixtures (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  external_id text,
  league text,
  title text not null,
  venue text,
  starts_at timestamptz not null,
  status text not null default 'scheduled',
  result_summary text,
  source_name text not null default 'manual',
  source_url text,
  source_updated_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  sport_id uuid not null references public.sports(id),
  fixture_id uuid references public.fixtures(id),
  title text not null,
  bookmaker text,
  odds numeric(10, 2),
  confidence integer not null check (confidence between 1 and 10),
  prediction text not null,
  analysis text not null,
  visibility public.tip_visibility not null default 'premium',
  credit_cost integer not null default 1 check (credit_cost >= 0),
  status public.tip_status not null default 'draft',
  result text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'ZAR',
  credits integer not null check (credits > 0),
  status public.payment_status not null default 'pending',
  idempotency_key text not null unique,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid references public.payments(id),
  tip_id uuid references public.tips(id),
  transaction_type public.credit_transaction_type not null,
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason text,
  idempotency_key text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tip_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  tip_id uuid not null references public.tips(id) on delete cascade,
  credit_transaction_id uuid not null unique references public.credit_transactions(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, tip_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_name text not null,
  status text not null default 'inactive',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  bucket text not null,
  path text not null,
  alt_text text,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_tipsters_updated_at on public.tipsters;
create trigger set_tipsters_updated_at
before update on public.tipsters
for each row execute function public.set_updated_at();

drop trigger if exists set_fixtures_updated_at on public.fixtures;
create trigger set_fixtures_updated_at
before update on public.fixtures
for each row execute function public.set_updated_at();

drop trigger if exists set_tips_updated_at on public.tips;
create trigger set_tips_updated_at
before update on public.tips
for each row execute function public.set_updated_at();

drop trigger if exists set_wallets_updated_at on public.wallets;
create trigger set_wallets_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_user();

create index if not exists fixtures_sport_starts_at_idx on public.fixtures (sport_id, starts_at);
create unique index if not exists fixtures_source_external_id_uidx on public.fixtures (source_name, external_id);
create index if not exists fixtures_upcoming_idx on public.fixtures (starts_at) where result_summary is null;
create index if not exists fixtures_results_history_idx on public.fixtures (starts_at desc) where result_summary is not null;
create index if not exists tips_tipster_status_idx on public.tips (tipster_id, status);
create index if not exists tips_fixture_idx on public.tips (fixture_id);
create index if not exists tips_sport_idx on public.tips (sport_id);
create index if not exists announcements_created_by_idx on public.announcements (created_by);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists credit_transactions_user_created_idx on public.credit_transactions (user_id, created_at desc);
create index if not exists credit_transactions_created_by_idx on public.credit_transactions (created_by);
create index if not exists credit_transactions_payment_idx on public.credit_transactions (payment_id);
create index if not exists credit_transactions_tip_idx on public.credit_transactions (tip_id);
create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists media_assets_owner_idx on public.media_assets (owner_id);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists tip_unlocks_tip_idx on public.tip_unlocks (tip_id);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.tipsters enable row level security;
alter table public.sports enable row level security;
alter table public.fixtures enable row level security;
alter table public.tips enable row level security;
alter table public.wallets enable row level security;
alter table public.payments enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.tip_unlocks enable row level security;
alter table public.subscriptions enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.media_assets enable row level security;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;
revoke all on function app_private.current_user_has_role(public.app_role) from public;
revoke all on function app_private.handle_new_user() from public;
grant execute on function app_private.current_user_has_role(public.app_role) to authenticated;

grant usage on schema public to anon, authenticated;
grant usage on type public.app_role to authenticated;
grant usage on type public.tip_status to anon, authenticated;
grant usage on type public.tip_visibility to anon, authenticated;
grant usage on type public.payment_status to authenticated;
grant usage on type public.credit_transaction_type to authenticated;

grant select on public.tipsters, public.sports, public.fixtures, public.tips, public.announcements to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.user_roles to authenticated;
grant insert, update, delete on public.tipsters, public.sports, public.fixtures, public.tips, public.wallets, public.payments, public.credit_transactions, public.tip_unlocks, public.subscriptions, public.announcements, public.notifications, public.media_assets to authenticated;
grant select on public.user_roles, public.wallets, public.payments, public.credit_transactions, public.tip_unlocks, public.subscriptions, public.notifications, public.audit_logs, public.media_assets to authenticated;
grant insert on public.audit_logs to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
on public.profiles for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
create policy "user_roles_select_own_or_admin"
on public.user_roles for select
to authenticated
using ((select auth.uid()) = user_id or app_private.current_user_has_role('administrator'));

drop policy if exists "user_roles_admin_all" on public.user_roles;
create policy "user_roles_admin_all"
on public.user_roles for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tipsters_public_read_verified" on public.tipsters;
create policy "tipsters_public_read_verified"
on public.tipsters for select
to anon, authenticated
using (is_verified = true);

drop policy if exists "tipsters_select_own" on public.tipsters;
create policy "tipsters_select_own"
on public.tipsters for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tipsters_insert_own" on public.tipsters;
create policy "tipsters_insert_own"
on public.tipsters for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "tipsters_update_own" on public.tipsters;
create policy "tipsters_update_own"
on public.tipsters for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "tipsters_admin_all" on public.tipsters;
create policy "tipsters_admin_all"
on public.tipsters for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "sports_active_public_read" on public.sports;
create policy "sports_active_public_read"
on public.sports for select
to anon, authenticated
using (is_active = true);

drop policy if exists "sports_admin_all" on public.sports;
create policy "sports_admin_all"
on public.sports for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "fixtures_public_read" on public.fixtures;
create policy "fixtures_public_read"
on public.fixtures for select
to anon, authenticated
using (true);

drop policy if exists "fixtures_admin_all" on public.fixtures;
create policy "fixtures_admin_all"
on public.fixtures for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tips_free_public_read" on public.tips;
create policy "tips_free_public_read"
on public.tips for select
to anon, authenticated
using (status = 'published' and visibility = 'free');

drop policy if exists "tips_unlocked_client_read" on public.tips;
create policy "tips_unlocked_client_read"
on public.tips for select
to authenticated
using (
  status = 'published'
  and exists (
    select 1
    from public.tip_unlocks
    where tip_unlocks.tip_id = tips.id
      and tip_unlocks.user_id = (select auth.uid())
  )
);

drop policy if exists "tips_select_own_tipster" on public.tips;
create policy "tips_select_own_tipster"
on public.tips for select
to authenticated
using (
  exists (
    select 1
    from public.tipsters
    where tipsters.id = tips.tipster_id
      and tipsters.user_id = (select auth.uid())
  )
);

drop policy if exists "tips_manage_own_tipster" on public.tips;
create policy "tips_manage_own_tipster"
on public.tips for all
to authenticated
using (
  exists (
    select 1
    from public.tipsters
    where tipsters.id = tips.tipster_id
      and tipsters.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.tipsters
    where tipsters.id = tips.tipster_id
      and tipsters.user_id = (select auth.uid())
  )
);

drop policy if exists "tips_admin_all" on public.tips;
create policy "tips_admin_all"
on public.tips for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own"
on public.wallets for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "wallets_admin_all" on public.wallets;
create policy "wallets_admin_all"
on public.wallets for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
on public.payments for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all"
on public.payments for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own"
on public.credit_transactions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "credit_transactions_admin_all" on public.credit_transactions;
create policy "credit_transactions_admin_all"
on public.credit_transactions for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tip_unlocks_select_own" on public.tip_unlocks;
create policy "tip_unlocks_select_own"
on public.tip_unlocks for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tip_unlocks_admin_all" on public.tip_unlocks;
create policy "tip_unlocks_admin_all"
on public.tip_unlocks for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
on public.subscriptions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "subscriptions_admin_all" on public.subscriptions;
create policy "subscriptions_admin_all"
on public.subscriptions for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "announcements_public_read" on public.announcements;
create policy "announcements_public_read"
on public.announcements for select
to anon, authenticated
using (is_published = true);

drop policy if exists "announcements_admin_all" on public.announcements;
create policy "announcements_admin_all"
on public.announcements for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "notifications_admin_all" on public.notifications;
create policy "notifications_admin_all"
on public.notifications for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read"
on public.audit_logs for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists "audit_logs_admin_insert" on public.audit_logs;
create policy "audit_logs_admin_insert"
on public.audit_logs for insert
to authenticated
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "media_assets_select_own" on public.media_assets;
create policy "media_assets_select_own"
on public.media_assets for select
to authenticated
using ((select auth.uid()) = owner_id or app_private.current_user_has_role('administrator'));

drop policy if exists "media_assets_insert_own" on public.media_assets;
create policy "media_assets_insert_own"
on public.media_assets for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "media_assets_update_own" on public.media_assets;
create policy "media_assets_update_own"
on public.media_assets for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "media_assets_admin_all" on public.media_assets;
create policy "media_assets_admin_all"
on public.media_assets for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

insert into public.sports (name, slug)
values
  ('Horse Racing', 'horse-racing')
on conflict (slug) do nothing;

update public.sports
set is_active = (slug = 'horse-racing');
