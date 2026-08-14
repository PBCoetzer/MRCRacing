create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'race_meeting_status'
  ) then
    create type public.race_meeting_status as enum (
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
      'abandoned'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'tip_card_status'
  ) then
    create type public.tip_card_status as enum (
      'draft',
      'coming_soon',
      'published',
      'settled',
      'void'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'content_purchase_type'
  ) then
    create type public.content_purchase_type as enum ('meeting', 'subscription');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'content_purchase_status'
  ) then
    create type public.content_purchase_status as enum (
      'active',
      'disputed',
      'refunded',
      'cancelled'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'purchase_dispute_status'
  ) then
    create type public.purchase_dispute_status as enum ('open', 'approved', 'rejected');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'notification_delivery_status'
  ) then
    create type public.notification_delivery_status as enum (
      'pending',
      'processing',
      'delivered',
      'failed'
    );
  end if;
end $$;

alter table public.profiles
  add column if not exists email_notifications_enabled boolean not null default true;

alter table public.tipsters
  add column if not exists commission_rate_override numeric(5, 2)
    check (
      commission_rate_override is null
      or commission_rate_override between 0 and 100
    );

create table if not exists public.platform_settings (
  singleton boolean primary key default true check (singleton),
  zar_per_coin numeric(12, 2) not null default 1.00 check (zar_per_coin > 0),
  commission_rate numeric(5, 2) not null default 10.00
    check (commission_rate between 0 and 100),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.test_access_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.race_meetings (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  external_id text,
  venue text not null,
  country_code text not null default 'ZA' check (char_length(country_code) = 2),
  meeting_date date not null,
  first_race_at timestamptz not null,
  last_race_at timestamptz,
  status public.race_meeting_status not null default 'scheduled',
  is_test boolean not null default false,
  source_name text not null default 'manual',
  source_url text,
  source_updated_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_name, external_id),
  check (last_race_at is null or last_race_at >= first_race_at)
);

alter table public.fixtures
  add column if not exists meeting_id uuid references public.race_meetings(id) on delete cascade,
  add column if not exists race_number integer check (race_number is null or race_number > 0),
  add column if not exists distance_m integer check (distance_m is null or distance_m > 0),
  add column if not exists race_class text,
  add column if not exists original_starts_at timestamptz;

create unique index if not exists fixtures_meeting_race_number_uidx
on public.fixtures (meeting_id, race_number)
where meeting_id is not null and race_number is not null;

create table if not exists public.race_entries (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  external_id text,
  saddle_number integer not null check (saddle_number > 0),
  horse_name text not null,
  jockey_name text,
  trainer_name text,
  draw integer,
  carried_weight numeric(5, 1),
  odds text,
  status text not null default 'active' check (status in ('active', 'scratched')),
  result_position integer check (result_position is null or result_position > 0),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fixture_id, saddle_number)
);

create table if not exists public.meeting_bet_options (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.race_meetings(id) on delete cascade,
  bet_type text not null check (bet_type in ('pa', 'pick6', 'bipot', 'jackpot', 'other')),
  display_name text not null,
  cutoff_at timestamptz not null,
  leg_count integer not null default 0 check (leg_count >= 0),
  sort_order integer not null default 0,
  external_id text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, display_name)
);

create table if not exists public.meeting_bet_legs (
  bet_option_id uuid not null references public.meeting_bet_options(id) on delete cascade,
  leg_number integer not null check (leg_number > 0),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  primary key (bet_option_id, leg_number),
  unique (bet_option_id, fixture_id)
);

create table if not exists public.tip_cards (
  id uuid primary key default gen_random_uuid(),
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  meeting_id uuid not null references public.race_meetings(id) on delete cascade,
  title text not null,
  summary text,
  coin_price integer not null check (coin_price > 0),
  status public.tip_card_status not null default 'draft',
  revision integer not null default 0 check (revision >= 0),
  listed_at timestamptz,
  published_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipster_id, meeting_id)
);

create table if not exists public.race_tip_selections (
  id uuid primary key default gen_random_uuid(),
  tip_card_id uuid not null references public.tip_cards(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  winner_entry_id uuid references public.race_entries(id),
  place_entry_id uuid references public.race_entries(id),
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tip_card_id, fixture_id)
);

create table if not exists public.tip_card_multiples (
  id uuid primary key default gen_random_uuid(),
  tip_card_id uuid not null references public.tip_cards(id) on delete cascade,
  bet_option_id uuid not null references public.meeting_bet_options(id) on delete cascade,
  custom_name text,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tip_card_id, bet_option_id)
);

create table if not exists public.tip_card_multiple_selections (
  multiple_id uuid not null references public.tip_card_multiples(id) on delete cascade,
  leg_number integer not null check (leg_number > 0),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  entry_id uuid not null references public.race_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (multiple_id, leg_number, entry_id)
);

create table if not exists public.tip_card_revisions (
  id uuid primary key default gen_random_uuid(),
  tip_card_id uuid not null references public.tip_cards(id) on delete cascade,
  revision integer not null check (revision > 0),
  revision_type text not null check (revision_type in ('publication', 'correction')),
  actor_id uuid references auth.users(id),
  summary text,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (tip_card_id, revision)
);

create table if not exists public.tipster_packages (
  id uuid primary key default gen_random_uuid(),
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  name text not null,
  duration_months integer not null check (duration_months in (1, 3, 6, 12)),
  coin_price integer not null check (coin_price > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipster_id, duration_months)
);

create table if not exists public.content_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipster_id uuid not null references public.tipsters(id),
  purchase_type public.content_purchase_type not null,
  tip_card_id uuid references public.tip_cards(id),
  tipster_package_id uuid references public.tipster_packages(id),
  gross_coins integer not null check (gross_coins > 0),
  commission_rate numeric(5, 2) not null check (commission_rate between 0 and 100),
  platform_fee_coins numeric(12, 2) not null check (platform_fee_coins >= 0),
  tipster_net_coins numeric(12, 2) not null check (tipster_net_coins >= 0),
  status public.content_purchase_status not null default 'active',
  idempotency_key text not null,
  credit_transaction_id uuid not null unique references public.credit_transactions(id),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (
    (purchase_type = 'meeting' and tip_card_id is not null and tipster_package_id is null)
    or
    (purchase_type = 'subscription' and tip_card_id is null and tipster_package_id is not null)
  )
);

create table if not exists public.tipster_subscriptions (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.content_purchases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  package_id uuid not null references public.tipster_packages(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'refunded')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.tip_card_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tip_card_id uuid not null references public.tip_cards(id) on delete cascade,
  source_type public.content_purchase_type not null,
  source_purchase_id uuid references public.content_purchases(id) on delete cascade,
  source_subscription_id uuid references public.tipster_subscriptions(id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (
    (source_type = 'meeting' and source_purchase_id is not null and source_subscription_id is null)
    or
    (source_type = 'subscription' and source_purchase_id is not null and source_subscription_id is not null)
  )
);

create unique index if not exists tip_card_entitlements_meeting_uidx
on public.tip_card_entitlements (user_id, tip_card_id, source_purchase_id)
where source_type = 'meeting';

create unique index if not exists tip_card_entitlements_subscription_uidx
on public.tip_card_entitlements (user_id, tip_card_id, source_subscription_id)
where source_type = 'subscription';

create table if not exists public.tipster_earnings (
  id uuid primary key default gen_random_uuid(),
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  purchase_id uuid not null references public.content_purchases(id) on delete cascade,
  entry_type text not null check (entry_type in ('sale', 'refund')),
  gross_coins numeric(12, 2) not null,
  platform_fee_coins numeric(12, 2) not null,
  net_coins numeric(12, 2) not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_disputes (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.content_purchases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  status public.purchase_dispute_status not null default 'open',
  admin_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists purchase_disputes_one_open_uidx
on public.purchase_disputes (purchase_id)
where status = 'open';

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  channel text not null default 'email'
    check (channel in ('email', 'browser', 'whatsapp', 'telegram')),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status public.notification_delivery_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select pgmq.create('tip_notifications')
where not exists (
  select 1
  from pgmq.list_queues()
  where queue_name = 'tip_notifications'
);

;
