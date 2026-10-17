-- Preserve published tip labels, enforce subscription expiry, and warn clients
-- before access ends. This migration is forward-only and leaves meeting-card
-- purchases untouched.

set local lock_timeout = '10s';

alter table public.race_tip_selections
  add column if not exists winner_selection_snapshot jsonb,
  add column if not exists place_selection_snapshot jsonb;

alter table public.race_tip_selections
  drop constraint if exists race_tip_selections_winner_snapshot_object_check,
  add constraint race_tip_selections_winner_snapshot_object_check
    check (
      winner_selection_snapshot is null
      or jsonb_typeof(winner_selection_snapshot) = 'object'
    ),
  drop constraint if exists race_tip_selections_place_snapshot_object_check,
  add constraint race_tip_selections_place_snapshot_object_check
    check (
      place_selection_snapshot is null
      or jsonb_typeof(place_selection_snapshot) = 'object'
    );

create or replace function app_private.capture_race_tip_selection_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.winner_entry_id is null then
    new.winner_selection_snapshot := null;
  else
    select jsonb_build_object(
      'entryId', entries.id,
      'saddleNumber', entries.saddle_number,
      'horseName', entries.horse_name,
      'jockeyName', entries.jockey_name,
      'capturedAt', now()
    )
    into new.winner_selection_snapshot
    from public.race_entries entries
    where entries.id = new.winner_entry_id;
  end if;

  if new.place_entry_id is null then
    new.place_selection_snapshot := null;
  else
    select jsonb_build_object(
      'entryId', entries.id,
      'saddleNumber', entries.saddle_number,
      'horseName', entries.horse_name,
      'jockeyName', entries.jockey_name,
      'capturedAt', now()
    )
    into new.place_selection_snapshot
    from public.race_entries entries
    where entries.id = new.place_entry_id;
  end if;

  return new;
end;
$$;

drop trigger if exists capture_race_tip_selection_snapshots
on public.race_tip_selections;

create trigger capture_race_tip_selection_snapshots
before insert or update of
  winner_entry_id,
  place_entry_id,
  winner_selection_snapshot,
  place_selection_snapshot
on public.race_tip_selections
for each row
execute function app_private.capture_race_tip_selection_snapshots();

-- Published races may already be locked. Disable only the lock and derived
-- statistics triggers while immutable fallback labels are backfilled.
alter table public.race_tip_selections
  disable trigger enforce_race_tip_selection_lock;
alter table public.race_tip_selections
  disable trigger refresh_tipster_performance_after_selections;
alter table public.race_tip_selections
  disable trigger set_race_tip_selections_updated_at;

update public.race_tip_selections selections
set
  winner_selection_snapshot = case
    when selections.winner_entry_id is null then null
    else (
      select jsonb_build_object(
        'entryId', entries.id,
        'saddleNumber', entries.saddle_number,
        'horseName', entries.horse_name,
        'jockeyName', entries.jockey_name,
        'capturedAt', now()
      )
      from public.race_entries entries
      where entries.id = selections.winner_entry_id
    )
  end,
  place_selection_snapshot = case
    when selections.place_entry_id is null then null
    else (
      select jsonb_build_object(
        'entryId', entries.id,
        'saddleNumber', entries.saddle_number,
        'horseName', entries.horse_name,
        'jockeyName', entries.jockey_name,
        'capturedAt', now()
      )
      from public.race_entries entries
      where entries.id = selections.place_entry_id
    )
  end
where
  (selections.winner_entry_id is not null and selections.winner_selection_snapshot is null)
  or (selections.place_entry_id is not null and selections.place_selection_snapshot is null);

alter table public.race_tip_selections
  enable trigger set_race_tip_selections_updated_at;
alter table public.race_tip_selections
  enable trigger refresh_tipster_performance_after_selections;
alter table public.race_tip_selections
  enable trigger enforce_race_tip_selection_lock;

revoke all on function app_private.capture_race_tip_selection_snapshots()
from public, anon, authenticated;

comment on column public.race_tip_selections.winner_selection_snapshot is
  'Immutable display fallback captured when the winner entry is selected. Live race_entries remain the primary display source.';
comment on column public.race_tip_selections.place_selection_snapshot is
  'Immutable display fallback captured when the place entry is selected. Live race_entries remain the primary display source.';

create or replace function app_private.enforce_tipster_subscription_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_duration_months integer;
begin
  select packages.duration_months
  into package_duration_months
  from public.tipster_packages packages
  where packages.id = new.package_id;

  if package_duration_months is null then
    raise exception 'The selected subscription package is unavailable.';
  end if;

  new.ends_at := case
    when package_duration_months = 1
      then new.starts_at + interval '30 days'
    else new.starts_at + make_interval(months => package_duration_months)
  end;

  return new;
end;
$$;

drop trigger if exists enforce_tipster_subscription_duration
on public.tipster_subscriptions;

create trigger enforce_tipster_subscription_duration
before insert or update of package_id, starts_at
on public.tipster_subscriptions
for each row
execute function app_private.enforce_tipster_subscription_duration();

revoke all on function app_private.enforce_tipster_subscription_duration()
from public, anon, authenticated;

-- Correct active one-month segments that were created as calendar months.
update public.tipster_subscriptions subscriptions
set ends_at = subscriptions.starts_at + interval '30 days'
from public.tipster_packages packages
where packages.id = subscriptions.package_id
  and packages.duration_months = 1
  and subscriptions.status = 'active'
  and subscriptions.ends_at is distinct from subscriptions.starts_at + interval '30 days';

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription_strict_duration$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase record;
  package_row public.tipster_packages%rowtype;
  tipster_row public.tipsters%rowtype;
  allocation jsonb;
  revenue_split jsonb;
  purchased_used integer;
  reward_used integer;
  platform_rate numeric(5, 2);
  horse_care_rate_value numeric(5, 2);
  tipster_rate_value numeric(5, 2);
  platform_fee numeric(12, 2);
  horse_care_amount numeric(12, 2);
  tipster_net numeric(12, 2);
  allocation_version_value text;
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

  select * into existing_purchase
  from public.content_purchases
  where user_id = current_user_id
    and idempotency_key = p_idempotency_key;

  if existing_purchase.id is not null then
    return jsonb_build_object('purchase', to_jsonb(existing_purchase), 'idempotent', true);
  end if;

  select * into package_row
  from public.tipster_packages
  where id = p_package_id
    and is_active = true
  for update;

  if package_row.id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  select * into tipster_row
  from public.tipsters
  where id = package_row.tipster_id
    and is_verified = true;

  if tipster_row.id is null then
    raise exception 'The selected tipster is unavailable.';
  end if;

  select greatest(now(), coalesce(max(ends_at), now()))
  into subscription_start
  from public.tipster_subscriptions
  where user_id = current_user_id
    and tipster_id = package_row.tipster_id
    and status = 'active';

  subscription_end := case
    when package_row.duration_months = 1
      then subscription_start + interval '30 days'
    else subscription_start + make_interval(months => package_row.duration_months)
  end;

  allocation := app_private.allocate_wallet_spend_reward_first(
    current_user_id,
    package_row.coin_price
  );
  purchased_used := (allocation ->> 'purchasedUsed')::integer;
  reward_used := (allocation ->> 'rewardUsed')::integer;
  revenue_split := app_private.calculate_content_spend_split(purchased_used);
  platform_rate := (revenue_split ->> 'platformRate')::numeric;
  horse_care_rate_value := (revenue_split ->> 'horseCareRate')::numeric;
  tipster_rate_value := (revenue_split ->> 'tipsterRate')::numeric;
  platform_fee := (revenue_split ->> 'platformCredits')::numeric;
  horse_care_amount := (revenue_split ->> 'horseCareCredits')::numeric;
  tipster_net := (revenue_split ->> 'tipsterCredits')::numeric;
  allocation_version_value := revenue_split ->> 'allocationVersion';

  insert into public.credit_transactions (
    id, user_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key, created_by
  ) values (
    transaction_id, current_user_id, 'unlock', -package_row.coin_price,
    (allocation ->> 'balance')::integer, -purchased_used, -reward_used,
    (allocation ->> 'purchasedBalance')::integer,
    (allocation ->> 'rewardBalance')::integer,
    'Tipster subscription: ' || package_row.name,
    'subscription-purchase:' || purchase_id::text,
    current_user_id
  );

  insert into public.content_purchases (
    id, user_id, tipster_id, purchase_type, tipster_package_id,
    gross_coins, purchased_coins, reward_coins, commission_rate,
    horse_care_rate, tipster_rate, platform_fee_coins,
    horse_care_coins, tipster_net_coins, allocation_version,
    idempotency_key, credit_transaction_id
  ) values (
    purchase_id, current_user_id, package_row.tipster_id, 'subscription',
    package_row.id, package_row.coin_price, purchased_used, reward_used,
    platform_rate, horse_care_rate_value, tipster_rate_value, platform_fee,
    horse_care_amount, tipster_net, allocation_version_value,
    p_idempotency_key, transaction_id
  );

  insert into public.tipster_subscriptions (
    id, purchase_id, user_id, tipster_id, package_id, starts_at, ends_at
  ) values (
    subscription_id, purchase_id, current_user_id, package_row.tipster_id,
    package_row.id, subscription_start, subscription_end
  );

  insert into public.tip_card_entitlements (
    user_id, tip_card_id, source_type, source_purchase_id,
    source_subscription_id
  )
  select
    current_user_id, cards.id, 'subscription', purchase_id, subscription_id
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.tipster_id = package_row.tipster_id
    and cards.status in ('coming_soon', 'published')
    and meetings.first_race_at >= subscription_start
    and meetings.first_race_at < subscription_end
    and (not meetings.is_test or app_private.user_has_test_access(current_user_id))
  on conflict do nothing;

  if purchased_used > 0 then
    insert into public.tipster_earnings (
      tipster_id, purchase_id, entry_type, gross_coins,
      platform_fee_coins, horse_care_coins, net_coins, idempotency_key
    ) values (
      package_row.tipster_id, purchase_id, 'sale', purchased_used,
      platform_fee, horse_care_amount, tipster_net,
      'sale:' || purchase_id::text
    );
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, metadata
  ) values (
    current_user_id,
    'tipster_subscription_purchased',
    'content_purchase',
    purchase_id,
    jsonb_build_object(
      'packageId', package_row.id,
      'startsAt', subscription_start,
      'endsAt', subscription_end,
      'grossCoins', package_row.coin_price,
      'purchasedCoins', purchased_used,
      'rewardCoinsExcluded', reward_used,
      'spendPriority', 'reward_first',
      'allocationVersion', allocation_version_value,
      'platformRate', platform_rate,
      'horseCareRate', horse_care_rate_value,
      'tipsterRate', tipster_rate_value
    )
  );

  return jsonb_build_object(
    'purchaseId', purchase_id,
    'subscriptionId', subscription_id,
    'startsAt', subscription_start,
    'endsAt', subscription_end,
    'spendPriority', 'reward_first',
    'walletBalance', (allocation ->> 'balance')::integer,
    'purchasedBalance', (allocation ->> 'purchasedBalance')::integer,
    'rewardBalance', (allocation ->> 'rewardBalance')::integer,
    'purchasedCoins', purchased_used,
    'rewardCoins', reward_used,
    'platformFeeCoins', platform_fee,
    'horseCareCoins', horse_care_amount,
    'tipsterNetCoins', tipster_net,
    'allocationVersion', allocation_version_value
  );
end;
$purchase_tipster_subscription_strict_duration$;

revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated;

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
  select
    target_user_id is not null
    and app_private.account_is_active(target_user_id)
    and exists (
      select 1
      from public.tip_cards cards
      where cards.id = target_tip_card_id
        and cards.status in ('published', 'settled')
        and (
          cards.coin_price = 0
          or exists (
            select 1
            from public.tip_card_entitlements entitlements
            where entitlements.tip_card_id = cards.id
              and entitlements.user_id = target_user_id
              and entitlements.revoked_at is null
              and (
                entitlements.source_type = 'meeting'
                or (
                  entitlements.source_type = 'subscription'
                  and exists (
                    select 1
                    from public.tipster_subscriptions subscriptions
                    join public.content_purchases purchases
                      on purchases.id = subscriptions.purchase_id
                     and purchases.status in ('active', 'disputed')
                     and purchases.refunded_at is null
                    where subscriptions.id = entitlements.source_subscription_id
                      and subscriptions.user_id = target_user_id
                      and subscriptions.status = 'active'
                      and now() >= subscriptions.starts_at
                      and now() < subscriptions.ends_at
                  )
                )
              )
          )
        )
    );
$$;

revoke all on function app_private.user_can_access_tip_card(uuid, uuid)
from public, anon;
grant execute on function app_private.user_can_access_tip_card(uuid, uuid)
to authenticated, service_role;

create or replace function app_private.process_tipster_subscription_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  warning_count integer := 0;
  expired_count integer := 0;
  revoked_count integer := 0;
  remaining_days integer;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('mrc-tipster-subscription-lifecycle')
  );

  for target in
    select
      subscriptions.id,
      subscriptions.user_id,
      subscriptions.ends_at,
      tipsters.display_name as tipster_name,
      packages.name as package_name
    from public.tipster_subscriptions subscriptions
    join public.tipsters tipsters on tipsters.id = subscriptions.tipster_id
    join public.tipster_packages packages on packages.id = subscriptions.package_id
    where subscriptions.status = 'active'
      and subscriptions.ends_at > now()
      and subscriptions.ends_at <= now() + interval '7 days'
  loop
    remaining_days := greatest(
      1,
      ceil(extract(epoch from (target.ends_at - now())) / 86400.0)::integer
    );

    perform app_private.enqueue_in_app_notification(
      target.user_id,
      'tipster_subscription_expiring',
      'subscription:' || target.id::text || ':seven-day-expiry',
      'Your tipster subscription is ending soon',
      target.tipster_name || ' access ends in ' || remaining_days::text ||
        case when remaining_days = 1 then ' day.' else ' days.' end
    );

    warning_count := warning_count + 1;
  end loop;

  with expired as (
    update public.tipster_subscriptions subscriptions
    set status = 'expired'
    where subscriptions.status = 'active'
      and subscriptions.ends_at <= now()
    returning subscriptions.id, subscriptions.user_id, subscriptions.ends_at
  )
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, metadata
  )
  select
    null,
    'tipster_subscription_expired',
    'tipster_subscription',
    expired.id,
    jsonb_build_object(
      'userId', expired.user_id,
      'endsAt', expired.ends_at,
      'expiredBy', 'scheduled_lifecycle'
    )
  from expired;

  get diagnostics expired_count = row_count;

  update public.tip_card_entitlements entitlements
  set revoked_at = coalesce(entitlements.revoked_at, now())
  where entitlements.source_type = 'subscription'
    and entitlements.revoked_at is null
    and exists (
      select 1
      from public.tipster_subscriptions subscriptions
      where subscriptions.id = entitlements.source_subscription_id
        and subscriptions.status in ('expired', 'refunded')
    );

  get diagnostics revoked_count = row_count;

  return jsonb_build_object(
    'warningsQueued', warning_count,
    'subscriptionsExpired', expired_count,
    'entitlementsRevoked', revoked_count,
    'processedAt', now()
  );
end;
$$;

revoke all on function app_private.process_tipster_subscription_lifecycle()
from public, anon, authenticated;
grant execute on function app_private.process_tipster_subscription_lifecycle()
to service_role;

do $$
begin
  perform cron.unschedule('mrc-tipster-subscription-lifecycle')
  where exists (
    select 1
    from cron.job
    where jobname = 'mrc-tipster-subscription-lifecycle'
  );

  perform cron.schedule(
    'mrc-tipster-subscription-lifecycle',
    '17 * * * *',
    'select app_private.process_tipster_subscription_lifecycle();'
  );
end;
$$;

select app_private.process_tipster_subscription_lifecycle();

comment on function app_private.process_tipster_subscription_lifecycle() is
  'Queues one expiry warning within seven days, expires ended subscriptions, and revokes only subscription-sourced card entitlements.';
