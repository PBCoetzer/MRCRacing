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

insert into public.profiles (
  id,
  display_name,
  phone
)
select
  u.id,
  nullif(u.raw_user_meta_data ->> 'display_name', ''),
  nullif(u.raw_user_meta_data ->> 'phone', '')
from auth.users u
on conflict (id) do nothing;

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

create or replace function app_private.current_tipster_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.tipsters
  where user_id = (select auth.uid())
    and is_verified = true
  limit 1;
$$;

create or replace function app_private.user_has_test_access(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.current_user_has_role('administrator')
    or app_private.current_user_has_role('tipster')
    or exists (
      select 1
      from public.test_access_users
      where user_id = target_user_id
    );
$$;

create or replace function app_private.can_view_meeting(target_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.race_meetings
    where id = target_meeting_id
      and (
        is_test = false
        or app_private.user_has_test_access((select auth.uid()))
      )
  );
$$;

create or replace function app_private.user_can_access_tip_card(
  target_tip_card_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tip_card_entitlements e
    join public.tip_cards c on c.id = e.tip_card_id
    where e.tip_card_id = target_tip_card_id
      and e.user_id = target_user_id
      and e.revoked_at is null
      and c.status = 'published'
  );
$$;

create or replace function app_private.tip_card_snapshot(target_tip_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', to_jsonb(c),
    'raceSelections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fixtureId', r.fixture_id,
          'winnerEntryId', r.winner_entry_id,
          'placeEntryId', r.place_entry_id,
          'comments', r.comments
        )
        order by f.race_number
      )
      from public.race_tip_selections r
      join public.fixtures f on f.id = r.fixture_id
      where r.tip_card_id = c.id
    ), '[]'::jsonb),
    'multiples', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'betOptionId', m.bet_option_id,
          'customName', m.custom_name,
          'comments', m.comments,
          'selections', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'legNumber', s.leg_number,
                'fixtureId', s.fixture_id,
                'entryId', s.entry_id
              )
              order by s.leg_number, e.saddle_number
            )
            from public.tip_card_multiple_selections s
            join public.race_entries e on e.id = s.entry_id
            where s.multiple_id = m.id
          ), '[]'::jsonb)
        )
        order by o.sort_order, o.display_name
      )
      from public.tip_card_multiples m
      join public.meeting_bet_options o on o.id = m.bet_option_id
      where m.tip_card_id = c.id
    ), '[]'::jsonb)
  )
  from public.tip_cards c
  where c.id = target_tip_card_id;
$$;

create or replace function app_private.multiple_is_complete(target_multiple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with multiple_data as (
    select m.id, o.bet_type, o.leg_count
    from public.tip_card_multiples m
    join public.meeting_bet_options o on o.id = m.bet_option_id
    where m.id = target_multiple_id
  ),
  selected as (
    select
      count(distinct s.leg_number)::integer as selected_legs,
      bool_and(s.entry_id is not null) as all_have_entries
    from public.tip_card_multiple_selections s
    where s.multiple_id = target_multiple_id
  )
  select case
    when d.bet_type = 'other'
      then coalesce(s.selected_legs, 0) >= 2 and coalesce(s.all_have_entries, false)
    else
      coalesce(s.selected_legs, 0) = d.leg_count
      and d.leg_count > 0
      and coalesce(s.all_have_entries, false)
  end
  from multiple_data d
  cross join selected s;
$$;

create or replace function app_private.enqueue_notification(
  target_user_id uuid,
  target_event_type text,
  target_dedupe_key text,
  target_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_id uuid;
  was_inserted boolean := false;
begin
  insert into public.notification_outbox (
    user_id,
    event_type,
    dedupe_key,
    payload
  )
  values (
    target_user_id,
    target_event_type,
    target_dedupe_key,
    target_payload
  )
  on conflict (dedupe_key) do nothing
  returning id into outbox_id;

  was_inserted := outbox_id is not null;

  if not was_inserted then
    select id
    into outbox_id
    from public.notification_outbox
    where dedupe_key = target_dedupe_key;
  else
    perform pgmq.send(
      'tip_notifications',
      jsonb_build_object('outboxId', outbox_id)
    );
  end if;

  return outbox_id;
end;
$$;

create or replace function app_private.queue_tip_card_notifications(
  target_tip_card_id uuid,
  target_revision integer,
  target_event_type text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
  recipient record;
  recipient_count integer := 0;
  event_title text;
  event_body text;
begin
  select
    c.id,
    c.tipster_id,
    c.title,
    c.revision,
    c.meeting_id,
    t.display_name as tipster_name,
    m.venue,
    m.meeting_date,
    m.first_race_at
  into card_row
  from public.tip_cards c
  join public.tipsters t on t.id = c.tipster_id
  join public.race_meetings m on m.id = c.meeting_id
  where c.id = target_tip_card_id;

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id,
    source_subscription_id
  )
  select
    s.user_id,
    card_row.id,
    'subscription',
    s.purchase_id,
    s.id
  from public.tipster_subscriptions s
  where s.tipster_id = card_row.tipster_id
    and s.status = 'active'
    and card_row.first_race_at >= s.starts_at
    and card_row.first_race_at < s.ends_at
  on conflict do nothing;

  event_title := case
    when target_event_type = 'tip_card_corrected'
      then 'Tip card correction published'
    else 'Your meeting tips are ready'
  end;

  event_body := case
    when target_event_type = 'tip_card_corrected'
      then card_row.tipster_name || ' updated the ' || card_row.venue || ' meeting card.'
    else card_row.tipster_name || ' published tips for ' || card_row.venue || '.'
  end;

  for recipient in
    select distinct e.user_id
    from public.tip_card_entitlements e
    join public.profiles p on p.id = e.user_id
    where e.tip_card_id = card_row.id
      and e.revoked_at is null
      and p.email_notifications_enabled = true
  loop
    insert into public.notifications (user_id, title, body)
    values (recipient.user_id, event_title, event_body);

    perform app_private.enqueue_notification(
      recipient.user_id,
      target_event_type,
      'tip-card:' || card_row.id::text ||
        ':revision:' || target_revision::text ||
        ':user:' || recipient.user_id::text ||
        ':email',
      jsonb_build_object(
        'template', target_event_type,
        'tipCardId', card_row.id,
        'revision', target_revision,
        'tipsterName', card_row.tipster_name,
        'meetingVenue', card_row.venue,
        'meetingDate', card_row.meeting_date,
        'cardTitle', card_row.title,
        'clientUrl', 'https://www.mrcracing.co.za/client/?card=' || card_row.id::text
      )
    );

    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

create or replace function app_private.validate_entry_for_fixture(
  target_entry_id uuid,
  target_fixture_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_entry_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.race_entries
    where id = target_entry_id
      and fixture_id = target_fixture_id
      and status = 'active'
  ) then
    raise exception 'Selected runner does not belong to this race or is scratched.';
  end if;
end;
$$;

create or replace function public.save_tip_card_draft(
  p_card_id uuid,
  p_meeting_id uuid,
  p_title text,
  p_summary text,
  p_coin_price integer,
  p_expected_revision integer,
  p_listing_status public.tip_card_status,
  p_race_selections jsonb default '[]'::jsonb,
  p_multiples jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  race_item jsonb;
  multiple_item jsonb;
  leg_item jsonb;
  entry_value jsonb;
  v_fixture_id uuid;
  v_winner_entry_id uuid;
  v_place_entry_id uuid;
  v_bet_option_id uuid;
  v_multiple_id uuid;
  v_leg_number integer;
  v_leg_fixture_id uuid;
begin
  if current_tipster_id is null then
    raise exception 'A verified tipster profile is required.';
  end if;

  if p_listing_status not in ('draft', 'coming_soon') then
    raise exception 'Draft cards may only be saved as draft or coming soon.';
  end if;

  if p_coin_price is null or p_coin_price <= 0 then
    raise exception 'Coin price must be greater than zero.';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'A meeting card title is required.';
  end if;

  if not exists (
    select 1
    from public.race_meetings
    where id = p_meeting_id
      and status = 'scheduled'
  ) then
    raise exception 'The selected meeting is unavailable.';
  end if;

  if p_card_id is null then
    insert into public.tip_cards (
      tipster_id,
      meeting_id,
      title,
      summary,
      coin_price,
      status,
      revision,
      listed_at
    )
    values (
      current_tipster_id,
      p_meeting_id,
      btrim(p_title),
      nullif(btrim(coalesce(p_summary, '')), ''),
      p_coin_price,
      p_listing_status,
      1,
      case when p_listing_status = 'coming_soon' then now() else null end
    )
    returning * into card_row;
  else
    select *
    into card_row
    from public.tip_cards
    where id = p_card_id
    for update;

    if card_row.id is null or card_row.tipster_id <> current_tipster_id then
      raise exception 'Tip card not found.';
    end if;

    if card_row.status not in ('draft', 'coming_soon') then
      raise exception 'Published cards must use the correction workflow.';
    end if;

    if card_row.meeting_id <> p_meeting_id then
      raise exception 'A tip card cannot be moved to another meeting.';
    end if;

    if card_row.revision <> p_expected_revision then
      raise exception 'Tip card changed in another session. Reload before saving.';
    end if;

    update public.tip_cards
    set
      title = btrim(p_title),
      summary = nullif(btrim(coalesce(p_summary, '')), ''),
      coin_price = p_coin_price,
      status = p_listing_status,
      revision = revision + 1,
      listed_at = case
        when p_listing_status = 'coming_soon' then coalesce(listed_at, now())
        else null
      end
    where id = card_row.id
    returning * into card_row;
  end if;

  delete from public.race_tip_selections
  where tip_card_id = card_row.id;

  delete from public.tip_card_multiples
  where tip_card_id = card_row.id;

  for race_item in
    select value
    from jsonb_array_elements(coalesce(p_race_selections, '[]'::jsonb))
  loop
    v_fixture_id := (race_item ->> 'fixtureId')::uuid;
    v_winner_entry_id := nullif(race_item ->> 'winnerEntryId', '')::uuid;
    v_place_entry_id := nullif(race_item ->> 'placeEntryId', '')::uuid;

    if not exists (
      select 1
      from public.fixtures
      where id = v_fixture_id
        and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Race selection is not part of this meeting.';
    end if;

    perform app_private.validate_entry_for_fixture(v_winner_entry_id, v_fixture_id);
    perform app_private.validate_entry_for_fixture(v_place_entry_id, v_fixture_id);

    if v_winner_entry_id is not null
      or v_place_entry_id is not null
      or nullif(btrim(coalesce(race_item ->> 'comments', '')), '') is not null
    then
      insert into public.race_tip_selections (
        tip_card_id,
        fixture_id,
        winner_entry_id,
        place_entry_id,
        comments
      )
      values (
        card_row.id,
        v_fixture_id,
        v_winner_entry_id,
        v_place_entry_id,
        nullif(btrim(coalesce(race_item ->> 'comments', '')), '')
      );
    end if;
  end loop;

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiples, '[]'::jsonb))
  loop
    v_bet_option_id := (multiple_item ->> 'betOptionId')::uuid;

    if not exists (
      select 1
      from public.meeting_bet_options
      where id = v_bet_option_id
        and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Meeting bet option is invalid.';
    end if;

    insert into public.tip_card_multiples (
      tip_card_id,
      bet_option_id,
      custom_name,
      comments
    )
    values (
      card_row.id,
      v_bet_option_id,
      nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
      nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
    )
    returning id into v_multiple_id;

    for leg_item in
      select value
      from jsonb_array_elements(coalesce(multiple_item -> 'legs', '[]'::jsonb))
    loop
      v_leg_number := (leg_item ->> 'legNumber')::integer;
      v_leg_fixture_id := (leg_item ->> 'fixtureId')::uuid;

      if not exists (
        select 1
        from public.fixtures
        where id = v_leg_fixture_id
          and meeting_id = card_row.meeting_id
      ) then
        raise exception 'Meeting bet leg is not part of this meeting.';
      end if;

      if exists (
        select 1
        from public.meeting_bet_options o
        where o.id = v_bet_option_id
          and o.bet_type <> 'other'
      ) and not exists (
        select 1
        from public.meeting_bet_legs l
        where l.bet_option_id = v_bet_option_id
          and l.leg_number = v_leg_number
          and l.fixture_id = v_leg_fixture_id
      ) then
        raise exception 'Meeting bet leg does not match the official leg mapping.';
      end if;

      for entry_value in
        select value
        from jsonb_array_elements(coalesce(leg_item -> 'entryIds', '[]'::jsonb))
      loop
        perform app_private.validate_entry_for_fixture(
          trim(both '"' from entry_value::text)::uuid,
          v_leg_fixture_id
        );

        insert into public.tip_card_multiple_selections (
          multiple_id,
          leg_number,
          fixture_id,
          entry_id
        )
        values (
          v_multiple_id,
          v_leg_number,
          v_leg_fixture_id,
          trim(both '"' from entry_value::text)::uuid
        )
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    (select auth.uid()),
    'tip_card_draft_saved',
    'tip_card',
    card_row.id,
    jsonb_build_object('revision', card_row.revision, 'status', card_row.status)
  );

  return to_jsonb(card_row);
end;
$$;

create or replace function public.publish_tip_card(
  p_card_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  meeting_row public.race_meetings%rowtype;
begin
  select *
  into card_row
  from public.tip_cards
  where id = p_card_id
  for update;

  if current_tipster_id is null
    or card_row.id is null
    or card_row.tipster_id <> current_tipster_id
  then
    raise exception 'Tip card not found.';
  end if;

  if card_row.status not in ('draft', 'coming_soon') then
    raise exception 'This tip card is already published or closed.';
  end if;

  if card_row.revision <> p_expected_revision then
    raise exception 'Tip card changed in another session. Reload before publishing.';
  end if;

  select *
  into meeting_row
  from public.race_meetings
  where id = card_row.meeting_id;

  if meeting_row.status <> 'scheduled' or meeting_row.first_race_at <= now() then
    raise exception 'The first publication must happen before Race 1 starts.';
  end if;

  if not exists (
    select 1
    from public.tip_card_multiples m
    where m.tip_card_id = card_row.id
      and app_private.multiple_is_complete(m.id)
  ) then
    raise exception 'Complete at least one PA, Pick 6, Bipot, Jackpot, or Other meeting bet before publishing.';
  end if;

  update public.tip_cards
  set
    status = 'published',
    revision = revision + 1,
    published_at = now(),
    listed_at = coalesce(listed_at, now())
  where id = card_row.id
  returning * into card_row;

  insert into public.tip_card_revisions (
    tip_card_id,
    revision,
    revision_type,
    actor_id,
    summary,
    snapshot
  )
  values (
    card_row.id,
    card_row.revision,
    'publication',
    (select auth.uid()),
    'Initial meeting card publication',
    app_private.tip_card_snapshot(card_row.id)
  );

  perform app_private.queue_tip_card_notifications(
    card_row.id,
    card_row.revision,
    'tip_card_published'
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    (select auth.uid()),
    'tip_card_published',
    'tip_card',
    card_row.id,
    jsonb_build_object('revision', card_row.revision)
  );

  return to_jsonb(card_row);
end;
$$;

create or replace function public.revise_tip_card(
  p_card_id uuid,
  p_expected_revision integer,
  p_revision_summary text,
  p_race_changes jsonb default '[]'::jsonb,
  p_multiple_changes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  race_item jsonb;
  multiple_item jsonb;
  leg_item jsonb;
  entry_value jsonb;
  fixture_row public.fixtures%rowtype;
  v_winner_entry_id uuid;
  v_place_entry_id uuid;
  bet_option_row public.meeting_bet_options%rowtype;
  v_multiple_id uuid;
  v_leg_number integer;
  v_leg_fixture_id uuid;
begin
  if nullif(btrim(coalesce(p_revision_summary, '')), '') is null then
    raise exception 'A correction summary is required.';
  end if;

  select *
  into card_row
  from public.tip_cards
  where id = p_card_id
  for update;

  if current_tipster_id is null
    or card_row.id is null
    or card_row.tipster_id <> current_tipster_id
  then
    raise exception 'Tip card not found.';
  end if;

  if card_row.status <> 'published' then
    raise exception 'Only published cards can use the correction workflow.';
  end if;

  if card_row.revision <> p_expected_revision then
    raise exception 'Tip card changed in another session. Reload before publishing the correction.';
  end if;

  for race_item in
    select value
    from jsonb_array_elements(coalesce(p_race_changes, '[]'::jsonb))
  loop
    select *
    into fixture_row
    from public.fixtures
    where id = (race_item ->> 'fixtureId')::uuid
      and meeting_id = card_row.meeting_id;

    if fixture_row.id is null then
      raise exception 'Race correction is not part of this meeting.';
    end if;

    if fixture_row.starts_at <= now() then
      raise exception 'Race % is locked because it has started.', fixture_row.race_number;
    end if;

    if coalesce((race_item ->> 'remove')::boolean, false) then
      delete from public.race_tip_selections
      where tip_card_id = card_row.id
        and fixture_id = fixture_row.id;
    else
      v_winner_entry_id := nullif(race_item ->> 'winnerEntryId', '')::uuid;
      v_place_entry_id := nullif(race_item ->> 'placeEntryId', '')::uuid;

      perform app_private.validate_entry_for_fixture(v_winner_entry_id, fixture_row.id);
      perform app_private.validate_entry_for_fixture(v_place_entry_id, fixture_row.id);

      insert into public.race_tip_selections (
        tip_card_id,
        fixture_id,
        winner_entry_id,
        place_entry_id,
        comments
      )
      values (
        card_row.id,
        fixture_row.id,
        v_winner_entry_id,
        v_place_entry_id,
        nullif(btrim(coalesce(race_item ->> 'comments', '')), '')
      )
      on conflict (tip_card_id, fixture_id) do update
      set
        winner_entry_id = excluded.winner_entry_id,
        place_entry_id = excluded.place_entry_id,
        comments = excluded.comments;
    end if;
  end loop;

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiple_changes, '[]'::jsonb))
  loop
    select *
    into bet_option_row
    from public.meeting_bet_options
    where id = (multiple_item ->> 'betOptionId')::uuid
      and meeting_id = card_row.meeting_id;

    if bet_option_row.id is null then
      raise exception 'Meeting bet correction is invalid.';
    end if;

    if bet_option_row.cutoff_at <= now() then
      raise exception '% is locked because its betting cutoff has passed.', bet_option_row.display_name;
    end if;

    select id
    into v_multiple_id
    from public.tip_card_multiples
    where tip_card_id = card_row.id
      and bet_option_id = bet_option_row.id;

    if coalesce((multiple_item ->> 'remove')::boolean, false) then
      delete from public.tip_card_multiples
      where id = v_multiple_id;
      continue;
    end if;

    if v_multiple_id is null then
      insert into public.tip_card_multiples (
        tip_card_id,
        bet_option_id,
        custom_name,
        comments
      )
      values (
        card_row.id,
        bet_option_row.id,
        nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
        nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
      )
      returning id into v_multiple_id;
    else
      update public.tip_card_multiples
      set
        custom_name = nullif(btrim(coalesce(multiple_item ->> 'customName', '')), ''),
        comments = nullif(btrim(coalesce(multiple_item ->> 'comments', '')), '')
      where id = v_multiple_id;

      delete from public.tip_card_multiple_selections s
      where s.multiple_id = v_multiple_id;
    end if;

    for leg_item in
      select value
      from jsonb_array_elements(coalesce(multiple_item -> 'legs', '[]'::jsonb))
    loop
      v_leg_number := (leg_item ->> 'legNumber')::integer;
      v_leg_fixture_id := (leg_item ->> 'fixtureId')::uuid;

      if not exists (
        select 1
        from public.fixtures
        where id = v_leg_fixture_id
          and meeting_id = card_row.meeting_id
          and starts_at > now()
      ) then
        raise exception 'Meeting bet contains a locked or invalid race.';
      end if;

      if bet_option_row.bet_type <> 'other' and not exists (
        select 1
        from public.meeting_bet_legs l
        where l.bet_option_id = bet_option_row.id
          and l.leg_number = v_leg_number
          and l.fixture_id = v_leg_fixture_id
      ) then
        raise exception 'Meeting bet leg does not match the official leg mapping.';
      end if;

      for entry_value in
        select value
        from jsonb_array_elements(coalesce(leg_item -> 'entryIds', '[]'::jsonb))
      loop
        perform app_private.validate_entry_for_fixture(
          trim(both '"' from entry_value::text)::uuid,
          v_leg_fixture_id
        );

        insert into public.tip_card_multiple_selections (
          multiple_id,
          leg_number,
          fixture_id,
          entry_id
        )
        values (
          v_multiple_id,
          v_leg_number,
          v_leg_fixture_id,
          trim(both '"' from entry_value::text)::uuid
        )
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  if not exists (
    select 1
    from public.tip_card_multiples m
    where m.tip_card_id = card_row.id
      and app_private.multiple_is_complete(m.id)
  ) then
    raise exception 'A published card must retain at least one complete meeting bet.';
  end if;

  update public.tip_cards
  set revision = revision + 1
  where id = card_row.id
  returning * into card_row;

  insert into public.tip_card_revisions (
    tip_card_id,
    revision,
    revision_type,
    actor_id,
    summary,
    snapshot
  )
  values (
    card_row.id,
    card_row.revision,
    'correction',
    (select auth.uid()),
    btrim(p_revision_summary),
    app_private.tip_card_snapshot(card_row.id)
  );

  perform app_private.queue_tip_card_notifications(
    card_row.id,
    card_row.revision,
    'tip_card_corrected'
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    (select auth.uid()),
    'tip_card_corrected',
    'tip_card',
    card_row.id,
    jsonb_build_object(
      'revision', card_row.revision,
      'summary', btrim(p_revision_summary)
    )
  );

  return to_jsonb(card_row);
end;
$$;

create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase public.content_purchases%rowtype;
  card_row public.tip_cards%rowtype;
  meeting_row public.race_meetings%rowtype;
  tipster_row public.tipsters%rowtype;
  wallet_balance integer;
  commission numeric(5, 2);
  platform_fee numeric(12, 2);
  tipster_net numeric(12, 2);
  purchase_id uuid := gen_random_uuid();
  transaction_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required.';
  end if;

  select *
  into existing_purchase
  from public.content_purchases
  where user_id = current_user_id
    and idempotency_key = p_idempotency_key;

  if existing_purchase.id is not null then
    return jsonb_build_object(
      'purchase', to_jsonb(existing_purchase),
      'idempotent', true
    );
  end if;

  select *
  into card_row
  from public.tip_cards
  where id = p_tip_card_id
  for update;

  if card_row.id is null
    or card_row.status not in ('coming_soon', 'published')
  then
    raise exception 'This meeting card is not available for purchase.';
  end if;

  select *
  into meeting_row
  from public.race_meetings
  where id = card_row.meeting_id;

  if meeting_row.status <> 'scheduled' or meeting_row.last_race_at <= now() then
    raise exception 'This meeting is no longer available for purchase.';
  end if;

  if meeting_row.is_test
    and not app_private.user_has_test_access(current_user_id)
  then
    raise exception 'This test meeting is not available to this account.';
  end if;

  if exists (
    select 1
    from public.content_purchases
    where user_id = current_user_id
      and tip_card_id = card_row.id
      and status in ('active', 'disputed')
  ) then
    raise exception 'This meeting card is already unlocked.';
  end if;

  select *
  into tipster_row
  from public.tipsters
  where id = card_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  select balance
  into wallet_balance
  from public.wallets
  where user_id = current_user_id
  for update;

  if coalesce(wallet_balance, 0) < card_row.coin_price then
    raise exception 'Insufficient coin balance.';
  end if;

  select coalesce(
    tipster_row.commission_rate_override,
    (select commission_rate from public.platform_settings where singleton = true)
  )
  into commission;

  platform_fee := round(card_row.coin_price * commission / 100.0, 2);
  tipster_net := round(card_row.coin_price - platform_fee, 2);
  wallet_balance := wallet_balance - card_row.coin_price;

  update public.wallets
  set balance = wallet_balance
  where user_id = current_user_id;

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    reason,
    idempotency_key,
    created_by
  )
  values (
    transaction_id,
    current_user_id,
    'unlock',
    -card_row.coin_price,
    wallet_balance,
    'Meeting card purchase: ' || card_row.title,
    'meeting-purchase:' || purchase_id::text,
    current_user_id
  );

  insert into public.content_purchases (
    id,
    user_id,
    tipster_id,
    purchase_type,
    tip_card_id,
    gross_coins,
    commission_rate,
    platform_fee_coins,
    tipster_net_coins,
    idempotency_key,
    credit_transaction_id
  )
  values (
    purchase_id,
    current_user_id,
    card_row.tipster_id,
    'meeting',
    card_row.id,
    card_row.coin_price,
    commission,
    platform_fee,
    tipster_net,
    p_idempotency_key,
    transaction_id
  );

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id
  )
  values (
    current_user_id,
    card_row.id,
    'meeting',
    purchase_id
  );

  insert into public.tipster_earnings (
    tipster_id,
    purchase_id,
    entry_type,
    gross_coins,
    platform_fee_coins,
    net_coins,
    idempotency_key
  )
  values (
    card_row.tipster_id,
    purchase_id,
    'sale',
    card_row.coin_price,
    platform_fee,
    tipster_net,
    'sale:' || purchase_id::text
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'meeting_card_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'tipCardId', card_row.id,
      'grossCoins', card_row.coin_price,
      'commissionRate', commission
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'walletBalance', wallet_balance,
    'grossCoins', card_row.coin_price,
    'platformFeeCoins', platform_fee,
    'tipsterNetCoins', tipster_net
  );
end;
$$;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase public.content_purchases%rowtype;
  package_row public.tipster_packages%rowtype;
  tipster_row public.tipsters%rowtype;
  wallet_balance integer;
  commission numeric(5, 2);
  platform_fee numeric(12, 2);
  tipster_net numeric(12, 2);
  purchase_id uuid := gen_random_uuid();
  transaction_id uuid := gen_random_uuid();
  subscription_id uuid := gen_random_uuid();
  subscription_start timestamptz;
  subscription_end timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required.';
  end if;

  select *
  into existing_purchase
  from public.content_purchases
  where user_id = current_user_id
    and idempotency_key = p_idempotency_key;

  if existing_purchase.id is not null then
    return jsonb_build_object(
      'purchase', to_jsonb(existing_purchase),
      'idempotent', true
    );
  end if;

  select *
  into package_row
  from public.tipster_packages
  where id = p_package_id
    and is_active = true
  for update;

  if package_row.id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  select *
  into tipster_row
  from public.tipsters
  where id = package_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  select balance
  into wallet_balance
  from public.wallets
  where user_id = current_user_id
  for update;

  if coalesce(wallet_balance, 0) < package_row.coin_price then
    raise exception 'Insufficient coin balance.';
  end if;

  select greatest(
    now(),
    coalesce(max(ends_at), now())
  )
  into subscription_start
  from public.tipster_subscriptions
  where user_id = current_user_id
    and tipster_id = package_row.tipster_id
    and status = 'active';

  subscription_end := subscription_start + make_interval(months => package_row.duration_months);

  select coalesce(
    tipster_row.commission_rate_override,
    (select commission_rate from public.platform_settings where singleton = true)
  )
  into commission;

  platform_fee := round(package_row.coin_price * commission / 100.0, 2);
  tipster_net := round(package_row.coin_price - platform_fee, 2);
  wallet_balance := wallet_balance - package_row.coin_price;

  update public.wallets
  set balance = wallet_balance
  where user_id = current_user_id;

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    reason,
    idempotency_key,
    created_by
  )
  values (
    transaction_id,
    current_user_id,
    'unlock',
    -package_row.coin_price,
    wallet_balance,
    'Tipster subscription: ' || package_row.name,
    'subscription-purchase:' || purchase_id::text,
    current_user_id
  );

  insert into public.content_purchases (
    id,
    user_id,
    tipster_id,
    purchase_type,
    tipster_package_id,
    gross_coins,
    commission_rate,
    platform_fee_coins,
    tipster_net_coins,
    idempotency_key,
    credit_transaction_id
  )
  values (
    purchase_id,
    current_user_id,
    package_row.tipster_id,
    'subscription',
    package_row.id,
    package_row.coin_price,
    commission,
    platform_fee,
    tipster_net,
    p_idempotency_key,
    transaction_id
  );

  insert into public.tipster_subscriptions (
    id,
    purchase_id,
    user_id,
    tipster_id,
    package_id,
    starts_at,
    ends_at
  )
  values (
    subscription_id,
    purchase_id,
    current_user_id,
    package_row.tipster_id,
    package_row.id,
    subscription_start,
    subscription_end
  );

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id,
    source_subscription_id
  )
  select
    current_user_id,
    c.id,
    'subscription',
    purchase_id,
    subscription_id
  from public.tip_cards c
  join public.race_meetings m on m.id = c.meeting_id
  where c.tipster_id = package_row.tipster_id
    and c.status in ('coming_soon', 'published')
    and m.first_race_at >= subscription_start
    and m.first_race_at < subscription_end
    and (
      m.is_test = false
      or app_private.user_has_test_access(current_user_id)
    )
  on conflict do nothing;

  insert into public.tipster_earnings (
    tipster_id,
    purchase_id,
    entry_type,
    gross_coins,
    platform_fee_coins,
    net_coins,
    idempotency_key
  )
  values (
    package_row.tipster_id,
    purchase_id,
    'sale',
    package_row.coin_price,
    platform_fee,
    tipster_net,
    'sale:' || purchase_id::text
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'tipster_subscription_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'packageId', package_row.id,
      'startsAt', subscription_start,
      'endsAt', subscription_end,
      'grossCoins', package_row.coin_price,
      'commissionRate', commission
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'subscriptionId', subscription_id,
    'startsAt', subscription_start,
    'endsAt', subscription_end,
    'walletBalance', wallet_balance
  );
end;
$$;

create or replace function app_private.refund_content_purchase(
  target_purchase_id uuid,
  refund_reason text,
  refund_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_row public.content_purchases%rowtype;
  wallet_balance integer;
  refund_transaction_id uuid := gen_random_uuid();
begin
  select *
  into purchase_row
  from public.content_purchases
  where id = target_purchase_id
  for update;

  if purchase_row.id is null then
    raise exception 'Purchase not found.';
  end if;

  if purchase_row.status = 'refunded' then
    return false;
  end if;

  select balance
  into wallet_balance
  from public.wallets
  where user_id = purchase_row.user_id
  for update;

  wallet_balance := coalesce(wallet_balance, 0) + purchase_row.gross_coins;

  update public.wallets
  set balance = wallet_balance
  where user_id = purchase_row.user_id;

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    reason,
    idempotency_key,
    created_by
  )
  values (
    refund_transaction_id,
    purchase_row.user_id,
    'refund',
    purchase_row.gross_coins,
    wallet_balance,
    refund_reason,
    'content-refund:' || purchase_row.id::text,
    refund_actor_id
  )
  on conflict (idempotency_key) do nothing;

  update public.content_purchases
  set
    status = 'refunded',
    refunded_at = now()
  where id = purchase_row.id;

  update public.tip_card_entitlements
  set revoked_at = now()
  where source_purchase_id = purchase_row.id
    and revoked_at is null;

  update public.tipster_subscriptions
  set status = 'refunded'
  where purchase_id = purchase_row.id;

  insert into public.tipster_earnings (
    tipster_id,
    purchase_id,
    entry_type,
    gross_coins,
    platform_fee_coins,
    net_coins,
    idempotency_key
  )
  values (
    purchase_row.tipster_id,
    purchase_row.id,
    'refund',
    -purchase_row.gross_coins,
    -purchase_row.platform_fee_coins,
    -purchase_row.tipster_net_coins,
    'refund:' || purchase_row.id::text
  )
  on conflict (idempotency_key) do nothing;

  insert into public.notifications (user_id, title, body)
  values (
    purchase_row.user_id,
    'Coins refunded',
    purchase_row.gross_coins::text || ' coins were returned to your wallet. ' || refund_reason
  );

  perform app_private.enqueue_notification(
    purchase_row.user_id,
    'purchase_refunded',
    'purchase:' || purchase_row.id::text || ':refund:email',
    jsonb_build_object(
      'template', 'purchase_refunded',
      'purchaseId', purchase_row.id,
      'coins', purchase_row.gross_coins,
      'reason', refund_reason,
      'clientUrl', 'https://www.mrcracing.co.za/client/'
    )
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    refund_actor_id,
    'content_purchase_refunded',
    'content_purchase',
    purchase_row.id,
    jsonb_build_object(
      'reason', refund_reason,
      'coins', purchase_row.gross_coins
    )
  );

  return true;
end;
$$;

create or replace function app_private.refund_due_meeting_purchases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_row record;
  refund_count integer := 0;
begin
  for purchase_row in
    select p.id, m.status as meeting_status
    from public.content_purchases p
    join public.tip_cards c on c.id = p.tip_card_id
    join public.race_meetings m on m.id = c.meeting_id
    where p.purchase_type = 'meeting'
      and p.status in ('active', 'disputed')
      and (
        m.status in ('cancelled', 'abandoned')
        or (m.first_race_at <= now() and c.status <> 'published')
      )
  loop
    if app_private.refund_content_purchase(
      purchase_row.id,
      case
        when purchase_row.meeting_status in ('cancelled', 'abandoned')
          then 'The race meeting was cancelled.'
        else 'The meeting card was not published before Race 1.'
      end,
      null
    ) then
      refund_count := refund_count + 1;
    end if;
  end loop;

  return refund_count;
end;
$$;

create or replace function public.request_purchase_dispute(
  p_purchase_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  dispute_row public.purchase_disputes%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.content_purchases
    where id = p_purchase_id
      and user_id = current_user_id
      and status = 'active'
  ) then
    raise exception 'Purchase is not eligible for a dispute.';
  end if;

  insert into public.purchase_disputes (
    purchase_id,
    user_id,
    reason
  )
  values (
    p_purchase_id,
    current_user_id,
    btrim(p_reason)
  )
  returning * into dispute_row;

  update public.content_purchases
  set status = 'disputed'
  where id = p_purchase_id;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'purchase_dispute_opened',
    'purchase_dispute',
    dispute_row.id,
    jsonb_build_object('purchaseId', p_purchase_id)
  );

  return to_jsonb(dispute_row);
end;
$$;

create or replace function public.resolve_purchase_dispute(
  p_dispute_id uuid,
  p_approve_refund boolean,
  p_admin_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  dispute_row public.purchase_disputes%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  select *
  into dispute_row
  from public.purchase_disputes
  where id = p_dispute_id
    and status = 'open'
  for update;

  if dispute_row.id is null then
    raise exception 'Open dispute not found.';
  end if;

  if p_approve_refund then
    perform app_private.refund_content_purchase(
      dispute_row.purchase_id,
      'Administrator approved purchase dispute.',
      current_user_id
    );
  else
    update public.content_purchases
    set status = 'active'
    where id = dispute_row.purchase_id
      and status = 'disputed';
  end if;

  update public.purchase_disputes
  set
    status = case
      when p_approve_refund then 'approved'::public.purchase_dispute_status
      else 'rejected'::public.purchase_dispute_status
    end,
    admin_notes = nullif(btrim(coalesce(p_admin_notes, '')), ''),
    resolved_by = current_user_id,
    resolved_at = now()
  where id = dispute_row.id
  returning * into dispute_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'purchase_dispute_resolved',
    'purchase_dispute',
    dispute_row.id,
    jsonb_build_object(
      'approvedRefund', p_approve_refund,
      'purchaseId', dispute_row.purchase_id
    )
  );

  return to_jsonb(dispute_row);
end;
$$;

create or replace function public.admin_refund_purchase(
  p_purchase_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  return app_private.refund_content_purchase(
    p_purchase_id,
    btrim(p_reason),
    (select auth.uid())
  );
end;
$$;

create or replace function public.claim_tip_notification_jobs(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jobs jsonb;
begin
  with queue_messages as (
    select *
    from pgmq.read(
      'tip_notifications',
      120,
      greatest(1, least(coalesce(p_limit, 20), 100))
    )
  ),
  claimed as (
    update public.notification_outbox o
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now()
    from queue_messages q
    where o.id = (q.message ->> 'outboxId')::uuid
      and (
        o.status in ('pending', 'failed')
        or (
          o.status = 'processing'
          and o.locked_at < now() - interval '2 minutes'
        )
      )
      and o.available_at <= now()
      and o.attempt_count < 8
    returning
      o.id,
      o.user_id,
      o.event_type,
      o.dedupe_key,
      o.payload,
      o.attempt_count,
      q.msg_id as queue_message_id
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  into jobs
  from claimed;

  return jobs;
end;
$$;

create or replace function public.complete_tip_notification_job(
  p_outbox_id uuid,
  p_queue_message_id bigint,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox
  set
    status = 'delivered',
    provider_message_id = nullif(p_provider_message_id, ''),
    delivered_at = now(),
    locked_at = null,
    last_error = null
  where id = p_outbox_id;

  perform pgmq.delete('tip_notifications', p_queue_message_id);
end;
$$;

create or replace function public.fail_tip_notification_job(
  p_outbox_id uuid,
  p_queue_message_id bigint,
  p_error text,
  p_retry_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_delay integer := greatest(30, least(coalesce(p_retry_seconds, 300), 86400));
  current_attempt_count integer;
begin
  update public.notification_outbox
  set
    status = 'failed',
    available_at = now() + make_interval(secs => new_delay),
    locked_at = null,
    last_error = left(coalesce(p_error, 'Unknown delivery error'), 1000)
  where id = p_outbox_id;

  select attempt_count
  into current_attempt_count
  from public.notification_outbox
  where id = p_outbox_id;

  perform pgmq.delete('tip_notifications', p_queue_message_id);

  if coalesce(current_attempt_count, 0) < 8 then
    perform pgmq.send(
      'tip_notifications',
      jsonb_build_object('outboxId', p_outbox_id),
      new_delay
    );
  end if;
end;
$$;

create or replace function public.process_due_meeting_refunds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.current_user_has_role('administrator')
    and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
  then
    raise exception 'Administrator access required.';
  end if;

  return app_private.refund_due_meeting_purchases();
end;
$$;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'mrc-refund-unpublished-meeting-cards'
  ) then
    perform cron.schedule(
      'mrc-refund-unpublished-meeting-cards',
      '*/5 * * * *',
      'select app_private.refund_due_meeting_purchases();'
    );
  end if;
end $$;

drop trigger if exists set_platform_settings_updated_at on public.platform_settings;
create trigger set_platform_settings_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_race_meetings_updated_at on public.race_meetings;
create trigger set_race_meetings_updated_at
before update on public.race_meetings
for each row execute function public.set_updated_at();

drop trigger if exists set_race_entries_updated_at on public.race_entries;
create trigger set_race_entries_updated_at
before update on public.race_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_meeting_bet_options_updated_at on public.meeting_bet_options;
create trigger set_meeting_bet_options_updated_at
before update on public.meeting_bet_options
for each row execute function public.set_updated_at();

drop trigger if exists set_tip_cards_updated_at on public.tip_cards;
create trigger set_tip_cards_updated_at
before update on public.tip_cards
for each row execute function public.set_updated_at();

drop trigger if exists set_race_tip_selections_updated_at on public.race_tip_selections;
create trigger set_race_tip_selections_updated_at
before update on public.race_tip_selections
for each row execute function public.set_updated_at();

drop trigger if exists set_tip_card_multiples_updated_at on public.tip_card_multiples;
create trigger set_tip_card_multiples_updated_at
before update on public.tip_card_multiples
for each row execute function public.set_updated_at();

drop trigger if exists set_tipster_packages_updated_at on public.tipster_packages;
create trigger set_tipster_packages_updated_at
before update on public.tipster_packages
for each row execute function public.set_updated_at();

drop trigger if exists set_notification_outbox_updated_at on public.notification_outbox;
create trigger set_notification_outbox_updated_at
before update on public.notification_outbox
for each row execute function public.set_updated_at();

create index if not exists race_meetings_starts_idx
on public.race_meetings (first_race_at, status);

create index if not exists fixtures_meeting_starts_idx
on public.fixtures (meeting_id, starts_at);

create index if not exists race_entries_fixture_idx
on public.race_entries (fixture_id, saddle_number);

create index if not exists meeting_bet_options_meeting_idx
on public.meeting_bet_options (meeting_id, cutoff_at);

create index if not exists tip_cards_tipster_status_idx
on public.tip_cards (tipster_id, status, updated_at desc);

create index if not exists tip_cards_meeting_status_idx
on public.tip_cards (meeting_id, status);

create index if not exists content_purchases_user_created_idx
on public.content_purchases (user_id, created_at desc);

create index if not exists content_purchases_tipster_created_idx
on public.content_purchases (tipster_id, created_at desc);

create index if not exists tipster_subscriptions_user_active_idx
on public.tipster_subscriptions (user_id, tipster_id, ends_at)
where status = 'active';

create index if not exists tip_card_entitlements_user_idx
on public.tip_card_entitlements (user_id, tip_card_id)
where revoked_at is null;

create index if not exists tipster_earnings_tipster_created_idx
on public.tipster_earnings (tipster_id, created_at desc);

create index if not exists purchase_disputes_status_created_idx
on public.purchase_disputes (status, created_at);

create index if not exists notification_outbox_delivery_idx
on public.notification_outbox (status, available_at)
where status in ('pending', 'failed');

alter table public.platform_settings enable row level security;
alter table public.test_access_users enable row level security;
alter table public.race_meetings enable row level security;
alter table public.race_entries enable row level security;
alter table public.meeting_bet_options enable row level security;
alter table public.meeting_bet_legs enable row level security;
alter table public.tip_cards enable row level security;
alter table public.race_tip_selections enable row level security;
alter table public.tip_card_multiples enable row level security;
alter table public.tip_card_multiple_selections enable row level security;
alter table public.tip_card_revisions enable row level security;
alter table public.tipster_packages enable row level security;
alter table public.content_purchases enable row level security;
alter table public.tipster_subscriptions enable row level security;
alter table public.tip_card_entitlements enable row level security;
alter table public.tipster_earnings enable row level security;
alter table public.purchase_disputes enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists "fixtures_public_read" on public.fixtures;
create policy "fixtures_public_read"
on public.fixtures for select
to anon, authenticated
using (
  meeting_id is null
  or app_private.can_view_meeting(meeting_id)
);

drop policy if exists "platform_settings_authenticated_read" on public.platform_settings;
create policy "platform_settings_authenticated_read"
on public.platform_settings for select
to authenticated
using (true);

drop policy if exists "platform_settings_admin_all" on public.platform_settings;
create policy "platform_settings_admin_all"
on public.platform_settings for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "test_access_users_select_own_or_admin" on public.test_access_users;
create policy "test_access_users_select_own_or_admin"
on public.test_access_users for select
to authenticated
using (
  user_id = (select auth.uid())
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "test_access_users_admin_all" on public.test_access_users;
create policy "test_access_users_admin_all"
on public.test_access_users for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "race_meetings_visible_read" on public.race_meetings;
create policy "race_meetings_visible_read"
on public.race_meetings for select
to anon, authenticated
using (
  is_test = false
  or app_private.user_has_test_access((select auth.uid()))
);

drop policy if exists "race_meetings_admin_all" on public.race_meetings;
create policy "race_meetings_admin_all"
on public.race_meetings for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "race_entries_visible_read" on public.race_entries;
create policy "race_entries_visible_read"
on public.race_entries for select
to anon, authenticated
using (
  exists (
    select 1
    from public.fixtures f
    where f.id = race_entries.fixture_id
      and app_private.can_view_meeting(f.meeting_id)
  )
);

drop policy if exists "race_entries_admin_all" on public.race_entries;
create policy "race_entries_admin_all"
on public.race_entries for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "meeting_bet_options_visible_read" on public.meeting_bet_options;
create policy "meeting_bet_options_visible_read"
on public.meeting_bet_options for select
to anon, authenticated
using (app_private.can_view_meeting(meeting_id));

drop policy if exists "meeting_bet_options_admin_all" on public.meeting_bet_options;
create policy "meeting_bet_options_admin_all"
on public.meeting_bet_options for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "meeting_bet_legs_visible_read" on public.meeting_bet_legs;
create policy "meeting_bet_legs_visible_read"
on public.meeting_bet_legs for select
to anon, authenticated
using (
  exists (
    select 1
    from public.meeting_bet_options o
    where o.id = meeting_bet_legs.bet_option_id
      and app_private.can_view_meeting(o.meeting_id)
  )
);

drop policy if exists "meeting_bet_legs_admin_all" on public.meeting_bet_legs;
create policy "meeting_bet_legs_admin_all"
on public.meeting_bet_legs for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tip_cards_marketplace_read" on public.tip_cards;
create policy "tip_cards_marketplace_read"
on public.tip_cards for select
to anon, authenticated
using (
  status in ('coming_soon', 'published')
  and app_private.can_view_meeting(meeting_id)
);

drop policy if exists "tip_cards_owner_read" on public.tip_cards;
create policy "tip_cards_owner_read"
on public.tip_cards for select
to authenticated
using (
  exists (
    select 1
    from public.tipsters t
    where t.id = tip_cards.tipster_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "tip_cards_admin_all" on public.tip_cards;
create policy "tip_cards_admin_all"
on public.tip_cards for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "race_tip_selections_entitled_read" on public.race_tip_selections;
create policy "race_tip_selections_entitled_read"
on public.race_tip_selections for select
to authenticated
using (
  app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    where c.id = race_tip_selections.tip_card_id
      and t.user_id = (select auth.uid())
  )
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "tip_card_multiples_entitled_read" on public.tip_card_multiples;
create policy "tip_card_multiples_entitled_read"
on public.tip_card_multiples for select
to authenticated
using (
  app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    where c.id = tip_card_multiples.tip_card_id
      and t.user_id = (select auth.uid())
  )
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "tip_card_multiple_selections_entitled_read" on public.tip_card_multiple_selections;
create policy "tip_card_multiple_selections_entitled_read"
on public.tip_card_multiple_selections for select
to authenticated
using (
  exists (
    select 1
    from public.tip_card_multiples m
    where m.id = tip_card_multiple_selections.multiple_id
      and (
        app_private.user_can_access_tip_card(m.tip_card_id, (select auth.uid()))
        or exists (
          select 1
          from public.tip_cards c
          join public.tipsters t on t.id = c.tipster_id
          where c.id = m.tip_card_id
            and t.user_id = (select auth.uid())
        )
        or app_private.current_user_has_role('administrator')
      )
  )
);

drop policy if exists "tip_card_revisions_entitled_read" on public.tip_card_revisions;
create policy "tip_card_revisions_entitled_read"
on public.tip_card_revisions for select
to authenticated
using (
  app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    where c.id = tip_card_revisions.tip_card_id
      and t.user_id = (select auth.uid())
  )
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "tipster_packages_public_read" on public.tipster_packages;
create policy "tipster_packages_public_read"
on public.tipster_packages for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.tipsters t
    where t.id = tipster_packages.tipster_id
      and t.is_verified = true
  )
);

drop policy if exists "tipster_packages_owner_all" on public.tipster_packages;
create policy "tipster_packages_owner_all"
on public.tipster_packages for all
to authenticated
using (
  exists (
    select 1
    from public.tipsters t
    where t.id = tipster_packages.tipster_id
      and t.user_id = (select auth.uid())
      and t.is_verified = true
  )
)
with check (
  exists (
    select 1
    from public.tipsters t
    where t.id = tipster_packages.tipster_id
      and t.user_id = (select auth.uid())
      and t.is_verified = true
  )
);

drop policy if exists "tipster_packages_admin_all" on public.tipster_packages;
create policy "tipster_packages_admin_all"
on public.tipster_packages for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "content_purchases_select_own" on public.content_purchases;
create policy "content_purchases_select_own"
on public.content_purchases for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "content_purchases_admin_all" on public.content_purchases;
create policy "content_purchases_admin_all"
on public.content_purchases for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tipster_subscriptions_select_own" on public.tipster_subscriptions;
create policy "tipster_subscriptions_select_own"
on public.tipster_subscriptions for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "tipster_subscriptions_admin_all" on public.tipster_subscriptions;
create policy "tipster_subscriptions_admin_all"
on public.tipster_subscriptions for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tip_card_entitlements_select_own" on public.tip_card_entitlements;
create policy "tip_card_entitlements_select_own"
on public.tip_card_entitlements for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "tip_card_entitlements_admin_all" on public.tip_card_entitlements;
create policy "tip_card_entitlements_admin_all"
on public.tip_card_entitlements for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tipster_earnings_owner_read" on public.tipster_earnings;
create policy "tipster_earnings_owner_read"
on public.tipster_earnings for select
to authenticated
using (
  exists (
    select 1
    from public.tipsters t
    where t.id = tipster_earnings.tipster_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "tipster_earnings_admin_all" on public.tipster_earnings;
create policy "tipster_earnings_admin_all"
on public.tipster_earnings for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "purchase_disputes_select_own" on public.purchase_disputes;
create policy "purchase_disputes_select_own"
on public.purchase_disputes for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "purchase_disputes_admin_all" on public.purchase_disputes;
create policy "purchase_disputes_admin_all"
on public.purchase_disputes for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "notification_outbox_admin_read" on public.notification_outbox;
create policy "notification_outbox_admin_read"
on public.notification_outbox for select
to authenticated
using (app_private.current_user_has_role('administrator'));

grant usage on type public.race_meeting_status to anon, authenticated;
grant usage on type public.tip_card_status to anon, authenticated;
grant usage on type public.content_purchase_type to authenticated;
grant usage on type public.content_purchase_status to authenticated;
grant usage on type public.purchase_dispute_status to authenticated;
grant usage on type public.notification_delivery_status to authenticated;

grant select on
  public.race_meetings,
  public.race_entries,
  public.meeting_bet_options,
  public.meeting_bet_legs,
  public.tip_cards,
  public.tipster_packages
to anon, authenticated;

grant select on
  public.platform_settings,
  public.test_access_users,
  public.race_tip_selections,
  public.tip_card_multiples,
  public.tip_card_multiple_selections,
  public.tip_card_revisions,
  public.content_purchases,
  public.tipster_subscriptions,
  public.tip_card_entitlements,
  public.tipster_earnings,
  public.purchase_disputes,
  public.notification_outbox
to authenticated;

grant insert, update, delete on public.tipster_packages to authenticated;
grant insert, update, delete on public.test_access_users to authenticated;
grant update on public.platform_settings to authenticated;

revoke all on function app_private.current_tipster_id() from public;
revoke all on function app_private.user_has_test_access(uuid) from public;
revoke all on function app_private.can_view_meeting(uuid) from public;
revoke all on function app_private.user_can_access_tip_card(uuid, uuid) from public;
revoke all on function app_private.tip_card_snapshot(uuid) from public;
revoke all on function app_private.multiple_is_complete(uuid) from public;
revoke all on function app_private.enqueue_notification(uuid, text, text, jsonb) from public;
revoke all on function app_private.queue_tip_card_notifications(uuid, integer, text) from public;
revoke all on function app_private.validate_entry_for_fixture(uuid, uuid) from public;
revoke all on function app_private.refund_content_purchase(uuid, text, uuid) from public;
revoke all on function app_private.refund_due_meeting_purchases() from public;

grant execute on function app_private.current_tipster_id() to authenticated;
grant execute on function app_private.user_has_test_access(uuid) to anon, authenticated;
grant execute on function app_private.can_view_meeting(uuid) to anon, authenticated;
grant execute on function app_private.user_can_access_tip_card(uuid, uuid) to authenticated;

revoke all on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) from public;
revoke all on function public.publish_tip_card(uuid, integer) from public;
revoke all on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb) from public;
revoke all on function public.purchase_meeting_card(uuid, text) from public;
revoke all on function public.purchase_tipster_subscription(uuid, text) from public;
revoke all on function public.request_purchase_dispute(uuid, text) from public;
revoke all on function public.resolve_purchase_dispute(uuid, boolean, text) from public;
revoke all on function public.admin_refund_purchase(uuid, text) from public;
revoke all on function public.process_due_meeting_refunds() from public;
revoke all on function public.claim_tip_notification_jobs(integer) from public;
revoke all on function public.complete_tip_notification_job(uuid, bigint, text) from public;
revoke all on function public.fail_tip_notification_job(uuid, bigint, text, integer) from public;

grant execute on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) to authenticated;
grant execute on function public.publish_tip_card(uuid, integer) to authenticated;
grant execute on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb) to authenticated;
grant execute on function public.purchase_meeting_card(uuid, text) to authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text) to authenticated;
grant execute on function public.request_purchase_dispute(uuid, text) to authenticated;
grant execute on function public.resolve_purchase_dispute(uuid, boolean, text) to authenticated;
grant execute on function public.admin_refund_purchase(uuid, text) to authenticated;
grant execute on function public.process_due_meeting_refunds() to authenticated, service_role;
grant execute on function public.claim_tip_notification_jobs(integer) to service_role;
grant execute on function public.complete_tip_notification_job(uuid, bigint, text) to service_role;
grant execute on function public.fail_tip_notification_job(uuid, bigint, text, integer) to service_role;

revoke all on function app_private.current_user_has_role(public.app_role)
from public, anon, authenticated, service_role;
revoke all on function app_private.current_tipster_id()
from public, anon, authenticated, service_role;
revoke all on function app_private.user_has_test_access(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.can_view_meeting(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.user_can_access_tip_card(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.tip_card_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.multiple_is_complete(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.enqueue_notification(uuid, text, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function app_private.queue_tip_card_notifications(uuid, integer, text)
from public, anon, authenticated, service_role;
revoke all on function app_private.validate_entry_for_fixture(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.refund_content_purchase(uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.refund_due_meeting_purchases()
from public, anon, authenticated, service_role;

grant execute on function app_private.current_user_has_role(public.app_role) to authenticated;
grant execute on function app_private.current_tipster_id() to authenticated;
grant execute on function app_private.user_has_test_access(uuid) to anon, authenticated;
grant execute on function app_private.can_view_meeting(uuid) to anon, authenticated;
grant execute on function app_private.user_can_access_tip_card(uuid, uuid) to authenticated;

revoke all on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.publish_tip_card(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.request_purchase_dispute(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.resolve_purchase_dispute(uuid, boolean, text)
from public, anon, authenticated, service_role;
revoke all on function public.admin_refund_purchase(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.process_due_meeting_refunds()
from public, anon, authenticated, service_role;
revoke all on function public.claim_tip_notification_jobs(integer)
from public, anon, authenticated, service_role;
revoke all on function public.complete_tip_notification_job(uuid, bigint, text)
from public, anon, authenticated, service_role;
revoke all on function public.fail_tip_notification_job(uuid, bigint, text, integer)
from public, anon, authenticated, service_role;

grant execute on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) to authenticated;
grant execute on function public.publish_tip_card(uuid, integer) to authenticated;
grant execute on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb) to authenticated;
grant execute on function public.purchase_meeting_card(uuid, text) to authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text) to authenticated;
grant execute on function public.request_purchase_dispute(uuid, text) to authenticated;
grant execute on function public.resolve_purchase_dispute(uuid, boolean, text) to authenticated;
grant execute on function public.admin_refund_purchase(uuid, text) to authenticated;
grant execute on function public.process_due_meeting_refunds() to authenticated, service_role;
grant execute on function public.claim_tip_notification_jobs(integer) to service_role;
grant execute on function public.complete_tip_notification_job(uuid, bigint, text) to service_role;
grant execute on function public.fail_tip_notification_job(uuid, bigint, text, integer) to service_role;
