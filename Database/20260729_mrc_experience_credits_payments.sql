create table if not exists public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  credits integer not null check (credits > 0),
  price_cents integer not null check (price_cents > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price_cents = credits * 100)
);

insert into public.credit_packages (name, credits, price_cents, is_active, sort_order)
values
  ('50 Credits', 50, 5000, true, 10),
  ('100 Credits', 100, 10000, true, 20),
  ('250 Credits', 250, 25000, true, 30),
  ('500 Credits', 500, 50000, true, 40),
  ('1,000 Credits', 1000, 100000, true, 50)
on conflict (name) do update
set
  credits = excluded.credits,
  price_cents = excluded.price_cents,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

create table if not exists public.client_tipster_favourites (
  user_id uuid not null references auth.users(id) on delete cascade,
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tipster_id)
);

create table if not exists public.tipster_performance_stats (
  tipster_id uuid primary key references public.tipsters(id) on delete cascade,
  published_winner_tips integer not null default 0 check (published_winner_tips >= 0),
  settled_winner_tips integer not null default 0 check (settled_winner_tips >= 0),
  winner_hits integer not null default 0 check (winner_hits >= 0),
  winner_strike_rate numeric(6, 2),
  roi_percent numeric(8, 2),
  updated_at timestamptz not null default now(),
  check (winner_hits <= settled_winner_tips),
  check (winner_strike_rate is null or winner_strike_rate between 0 and 100)
);

alter table public.tip_card_multiples
  add column if not exists tip_text text;

alter table public.payments
  add column if not exists credit_package_id uuid references public.credit_packages(id),
  add column if not exists paid_at timestamptz,
  add column if not exists checkout_expires_at timestamptz;

create unique index if not exists payments_provider_reference_uidx
on public.payments (provider, provider_reference)
where provider_reference is not null;

create index if not exists payments_pending_expiry_idx
on public.payments (status, checkout_expires_at)
where status = 'pending';

drop trigger if exists set_credit_packages_updated_at on public.credit_packages;
create trigger set_credit_packages_updated_at
before update on public.credit_packages
for each row execute function public.set_updated_at();

update public.platform_settings
set zar_per_coin = 1.00
where singleton = true;

create or replace function app_private.refresh_tipster_performance_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tipster_performance_stats (
    tipster_id,
    published_winner_tips,
    settled_winner_tips,
    winner_hits,
    winner_strike_rate,
    roi_percent,
    updated_at
  )
  select
    t.id,
    count(s.id) filter (
      where s.winner_entry_id is not null
        and c.status in ('published', 'settled')
    )::integer,
    count(s.id) filter (
      where s.winner_entry_id is not null
        and selected_entry.result_position is not null
        and c.status in ('published', 'settled')
    )::integer,
    count(s.id) filter (
      where s.winner_entry_id is not null
        and selected_entry.result_position = 1
        and c.status in ('published', 'settled')
    )::integer,
    case
      when count(s.id) filter (
        where s.winner_entry_id is not null
          and selected_entry.result_position is not null
          and c.status in ('published', 'settled')
      ) = 0 then null
      else round(
        (
          count(s.id) filter (
            where s.winner_entry_id is not null
              and selected_entry.result_position = 1
              and c.status in ('published', 'settled')
          )::numeric
          /
          count(s.id) filter (
            where s.winner_entry_id is not null
              and selected_entry.result_position is not null
              and c.status in ('published', 'settled')
          )::numeric
        ) * 100,
        2
      )
    end,
    null::numeric,
    now()
  from public.tipsters t
  left join public.tip_cards c on c.tipster_id = t.id
  left join public.race_tip_selections s on s.tip_card_id = c.id
  left join public.race_entries selected_entry on selected_entry.id = s.winner_entry_id
  where t.is_verified = true
  group by t.id
  on conflict (tipster_id) do update
  set
    published_winner_tips = excluded.published_winner_tips,
    settled_winner_tips = excluded.settled_winner_tips,
    winner_hits = excluded.winner_hits,
    winner_strike_rate = excluded.winner_strike_rate,
    roi_percent = excluded.roi_percent,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function app_private.refresh_tipster_performance_stats_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.refresh_tipster_performance_stats();
  return null;
end;
$$;

drop trigger if exists refresh_tipster_performance_after_results on public.race_entries;
create trigger refresh_tipster_performance_after_results
after insert or update of result_position or delete on public.race_entries
for each statement execute function app_private.refresh_tipster_performance_stats_trigger();

drop trigger if exists refresh_tipster_performance_after_selections on public.race_tip_selections;
create trigger refresh_tipster_performance_after_selections
after insert or update or delete on public.race_tip_selections
for each statement execute function app_private.refresh_tipster_performance_stats_trigger();

drop trigger if exists refresh_tipster_performance_after_cards on public.tip_cards;
create trigger refresh_tipster_performance_after_cards
after update of status on public.tip_cards
for each statement execute function app_private.refresh_tipster_performance_stats_trigger();

select app_private.refresh_tipster_performance_stats();

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
          'tipText', m.tip_text,
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
    select m.id, m.tip_text, o.bet_type, o.leg_count
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
    when nullif(btrim(coalesce(d.tip_text, '')), '') is not null then true
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

create or replace function public.save_tip_card_draft_v2(
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
  saved_card jsonb;
  saved_card_id uuid;
  multiple_item jsonb;
begin
  saved_card := public.save_tip_card_draft(
    p_card_id,
    p_meeting_id,
    p_title,
    p_summary,
    p_coin_price,
    p_expected_revision,
    p_listing_status,
    p_race_selections,
    p_multiples
  );

  saved_card_id := (saved_card ->> 'id')::uuid;

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiples, '[]'::jsonb))
  loop
    update public.tip_card_multiples
    set tip_text = nullif(btrim(coalesce(multiple_item ->> 'tipText', '')), '')
    where tip_card_id = saved_card_id
      and bet_option_id = (multiple_item ->> 'betOptionId')::uuid;
  end loop;

  return saved_card;
end;
$$;

create or replace function public.publish_tip_card_v2(
  p_card_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.publish_tip_card(p_card_id, p_expected_revision);
exception
  when others then
    if sqlerrm = 'Complete at least one PA, Pick 6, Bipot, Jackpot, or Other meeting bet before publishing.' then
      raise exception 'Complete at least one Exotic or Multiple before publishing.';
    end if;
    raise;
end;
$$;

create or replace function public.revise_tip_card_v2(
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
  multiple_item jsonb;
  target_bet_option_id uuid;
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

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiple_changes, '[]'::jsonb))
  loop
    if coalesce((multiple_item ->> 'remove')::boolean, false) then
      continue;
    end if;

    target_bet_option_id := (multiple_item ->> 'betOptionId')::uuid;

    if not exists (
      select 1
      from public.meeting_bet_options
      where id = target_bet_option_id
        and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Meeting bet correction is invalid.';
    end if;

    insert into public.tip_card_multiples (
      tip_card_id,
      bet_option_id,
      tip_text
    )
    values (
      card_row.id,
      target_bet_option_id,
      nullif(btrim(coalesce(multiple_item ->> 'tipText', '')), '')
    )
    on conflict (tip_card_id, bet_option_id) do update
    set tip_text = excluded.tip_text;
  end loop;

  return public.revise_tip_card(
    p_card_id,
    p_expected_revision,
    p_revision_summary,
    p_race_changes,
    p_multiple_changes
  );
end;
$$;

create or replace function public.complete_credit_payment(
  p_payment_id uuid,
  p_provider text,
  p_provider_reference text,
  p_sanitized_event jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  wallet_balance integer;
  transaction_id uuid := gen_random_uuid();
begin
  select *
  into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'Payment not found.';
  end if;

  if payment_row.provider <> p_provider then
    raise exception 'Payment provider mismatch.';
  end if;

  if payment_row.status = 'paid' then
    select balance
    into wallet_balance
    from public.wallets
    where user_id = payment_row.user_id;

    return jsonb_build_object(
      'paymentId', payment_row.id,
      'walletBalance', coalesce(wallet_balance, 0),
      'credits', payment_row.credits,
      'idempotent', true
    );
  end if;

  if payment_row.status <> 'pending' then
    raise exception 'Payment is not pending.';
  end if;

  if payment_row.checkout_expires_at is not null
    and payment_row.checkout_expires_at < now()
  then
    raise exception 'Payment checkout has expired.';
  end if;

  insert into public.wallets (user_id, balance)
  values (payment_row.user_id, payment_row.credits)
  on conflict (user_id) do update
  set balance = public.wallets.balance + excluded.balance
  returning balance into wallet_balance;

  insert into public.credit_transactions (
    id,
    user_id,
    payment_id,
    transaction_type,
    amount,
    balance_after,
    reason,
    idempotency_key
  )
  values (
    transaction_id,
    payment_row.user_id,
    payment_row.id,
    'purchase',
    payment_row.credits,
    wallet_balance,
    'Credit package purchase',
    'credit-payment:' || payment_row.id::text
  );

  update public.payments
  set
    status = 'paid',
    provider_reference = nullif(btrim(coalesce(p_provider_reference, '')), ''),
    raw_event = coalesce(p_sanitized_event, '{}'::jsonb),
    paid_at = now()
  where id = payment_row.id;

  insert into public.audit_logs (
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'credit_payment_completed',
    'payment',
    payment_row.id,
    jsonb_build_object(
      'provider', payment_row.provider,
      'credits', payment_row.credits,
      'amountCents', payment_row.amount_cents
    )
  );

  return jsonb_build_object(
    'paymentId', payment_row.id,
    'walletBalance', wallet_balance,
    'credits', payment_row.credits,
    'idempotent', false
  );
end;
$$;

alter table public.credit_packages enable row level security;
alter table public.client_tipster_favourites enable row level security;
alter table public.tipster_performance_stats enable row level security;

drop policy if exists "credit_packages_public_read" on public.credit_packages;
create policy "credit_packages_public_read"
on public.credit_packages for select
to anon, authenticated
using (is_active = true);

drop policy if exists "credit_packages_admin_all" on public.credit_packages;
create policy "credit_packages_admin_all"
on public.credit_packages for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "client_tipster_favourites_own_read" on public.client_tipster_favourites;
create policy "client_tipster_favourites_own_read"
on public.client_tipster_favourites for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "client_tipster_favourites_own_insert" on public.client_tipster_favourites;
create policy "client_tipster_favourites_own_insert"
on public.client_tipster_favourites for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "client_tipster_favourites_own_delete" on public.client_tipster_favourites;
create policy "client_tipster_favourites_own_delete"
on public.client_tipster_favourites for delete
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "tipster_performance_stats_public_read" on public.tipster_performance_stats;
create policy "tipster_performance_stats_public_read"
on public.tipster_performance_stats for select
to anon, authenticated
using (true);

grant select on public.credit_packages to anon, authenticated;
grant select, insert, delete on public.client_tipster_favourites to authenticated;
grant select on public.tipster_performance_stats to anon, authenticated;
grant select on public.payments to authenticated;

revoke all on function app_private.refresh_tipster_performance_stats() from public, anon, authenticated;
revoke all on function app_private.refresh_tipster_performance_stats_trigger() from public, anon, authenticated;
revoke all on function app_private.tip_card_snapshot(uuid) from public;
revoke all on function app_private.multiple_is_complete(uuid) from public;
revoke all on function public.save_tip_card_draft_v2(uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb) from public, anon;
revoke all on function public.publish_tip_card_v2(uuid, integer) from public, anon;
revoke all on function public.revise_tip_card_v2(uuid, integer, text, jsonb, jsonb) from public, anon;
revoke all on function public.complete_credit_payment(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.save_tip_card_draft_v2(uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb) to authenticated;
grant execute on function public.publish_tip_card_v2(uuid, integer) to authenticated;
grant execute on function public.revise_tip_card_v2(uuid, integer, text, jsonb, jsonb) to authenticated;
grant execute on function public.complete_credit_payment(uuid, text, text, jsonb) to service_role;
