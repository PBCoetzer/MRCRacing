-- Reward-package bonuses, multi-package checkout snapshots, premium-content
-- access tracing, and favourite-tipster publication notifications.

alter table public.credit_packages
  add column if not exists reward_credits integer not null default 0,
  add column if not exists promotion_label text;

alter table public.credit_packages
  drop constraint if exists credit_packages_reward_credits_check,
  drop constraint if exists credit_packages_promotion_label_check,
  add constraint credit_packages_reward_credits_check
    check (reward_credits >= 0 and reward_credits <= credits),
  add constraint credit_packages_promotion_label_check
    check (promotion_label is null or char_length(promotion_label) between 1 and 80);

-- Increasing bonus percentages encourage larger purchases while preserving
-- the fixed R1-per-purchased-Credit price. Administrators can change these.
update public.credit_packages
set
  reward_credits = case credits
    when 50 then 0
    when 100 then 5
    when 250 then 20
    when 500 then 50
    when 1000 then 125
    else reward_credits
  end,
  promotion_label = case credits
    when 100 then '5 bonus Reward Credits'
    when 250 then '20 bonus Reward Credits'
    when 500 then '50 bonus Reward Credits'
    when 1000 then '125 bonus Reward Credits'
    else promotion_label
  end;

alter table public.payments
  add column if not exists purchased_credits integer,
  add column if not exists reward_credits integer,
  add column if not exists cart_fingerprint text;

update public.payments
set
  purchased_credits = coalesce(purchased_credits, credits),
  reward_credits = coalesce(reward_credits, 0)
where purchased_credits is null or reward_credits is null;

alter table public.payments
  alter column purchased_credits set default 0,
  alter column purchased_credits set not null,
  alter column reward_credits set default 0,
  alter column reward_credits set not null,
  drop constraint if exists payments_purchased_credits_check,
  drop constraint if exists payments_reward_credits_check,
  drop constraint if exists payments_credit_split_check,
  add constraint payments_purchased_credits_check check (purchased_credits > 0),
  add constraint payments_reward_credits_check check (reward_credits >= 0),
  add constraint payments_credit_split_check
    check (credits = purchased_credits + reward_credits);

create table if not exists public.payment_credit_items (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  credit_package_id uuid references public.credit_packages(id) on delete set null,
  package_name text not null,
  quantity integer not null check (quantity between 1 and 20),
  purchased_credits_each integer not null check (purchased_credits_each > 0),
  reward_credits_each integer not null check (reward_credits_each >= 0),
  unit_price_cents integer not null check (unit_price_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, credit_package_id)
);

create index if not exists payment_credit_items_payment_idx
on public.payment_credit_items (payment_id);

alter table public.payment_credit_items enable row level security;

drop policy if exists payment_credit_items_own_read on public.payment_credit_items;
create policy payment_credit_items_own_read
on public.payment_credit_items for select
to authenticated
using (
  exists (
    select 1
    from public.payments
    where payments.id = payment_credit_items.payment_id
      and payments.user_id = (select auth.uid())
  )
);

drop policy if exists payment_credit_items_admin_all on public.payment_credit_items;
create policy payment_credit_items_admin_all
on public.payment_credit_items for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

grant select on public.payment_credit_items to authenticated;
revoke insert, update, delete on public.payment_credit_items from anon, authenticated;

create or replace function public.admin_upsert_credit_package(
  p_package_id uuid,
  p_name text,
  p_credits integer,
  p_reward_credits integer,
  p_promotion_label text,
  p_is_active boolean,
  p_sort_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  package_row public.credit_packages%rowtype;
begin
  if actor_id is null
    or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access is required.';
  end if;

  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Package name must contain 2 to 80 characters.';
  end if;
  if p_credits is null or p_credits not between 1 and 100000 then
    raise exception 'Purchased Credits must be between 1 and 100,000.';
  end if;
  if coalesce(p_reward_credits, 0) not between 0 and p_credits then
    raise exception 'Reward Credits must be between 0 and the purchased Credit amount.';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 10000 then
    raise exception 'Sort order must be between 0 and 10,000.';
  end if;
  if nullif(btrim(coalesce(p_promotion_label, '')), '') is not null
    and char_length(btrim(p_promotion_label)) > 80 then
    raise exception 'Promotion label cannot exceed 80 characters.';
  end if;

  if p_package_id is null then
    insert into public.credit_packages (
      name, credits, reward_credits, price_cents,
      promotion_label, is_active, sort_order
    ) values (
      btrim(p_name), p_credits, coalesce(p_reward_credits, 0), p_credits * 100,
      nullif(btrim(coalesce(p_promotion_label, '')), ''),
      coalesce(p_is_active, true), p_sort_order
    )
    returning * into package_row;
  else
    update public.credit_packages
    set
      name = btrim(p_name),
      credits = p_credits,
      reward_credits = coalesce(p_reward_credits, 0),
      price_cents = p_credits * 100,
      promotion_label = nullif(btrim(coalesce(p_promotion_label, '')), ''),
      is_active = coalesce(p_is_active, false),
      sort_order = p_sort_order,
      updated_at = now()
    where id = p_package_id
    returning * into package_row;

    if package_row.id is null then
      raise exception 'Credit package not found.';
    end if;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, metadata
  ) values (
    actor_id,
    case when p_package_id is null
      then 'credit_package_created' else 'credit_package_updated' end,
    'credit_package', package_row.id,
    jsonb_build_object(
      'name', package_row.name,
      'purchasedCredits', package_row.credits,
      'rewardCredits', package_row.reward_credits,
      'priceCents', package_row.price_cents,
      'active', package_row.is_active,
      'sortOrder', package_row.sort_order
    )
  );

  return to_jsonb(package_row);
end;
$$;

revoke all on function public.admin_upsert_credit_package(
  uuid, text, integer, integer, text, boolean, integer
) from public, anon;
grant execute on function public.admin_upsert_credit_package(
  uuid, text, integer, integer, text, boolean, integer
) to authenticated;

create or replace function public.create_credit_checkout_record(
  p_user_id uuid,
  p_provider text,
  p_items jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer;
  requested_quantity integer;
  canonical_items jsonb;
  cart_fingerprint_value text;
  purchased_total integer;
  reward_total integer;
  amount_total integer;
  payment_row public.payments%rowtype;
  existing_payment public.payments%rowtype;
  item jsonb;
  single_package_id uuid;
begin
  if p_user_id is null then
    raise exception 'Checkout user is required.';
  end if;
  if p_provider not in ('payfast', 'ozow') then
    raise exception 'Choose PayFast or Ozow.';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception 'A valid idempotency key is required.';
  end if;
  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'The basket must contain between 1 and 20 package lines.';
  end if;

  with requested as (
    select
      (value ->> 'packageId')::uuid as package_id,
      sum(coalesce((value ->> 'quantity')::integer, 0))::integer as quantity
    from jsonb_array_elements(p_items)
    group by (value ->> 'packageId')::uuid
  ), validated as (
    select
      packages.id,
      packages.name,
      packages.credits,
      packages.reward_credits,
      packages.price_cents,
      requested.quantity
    from requested
    join public.credit_packages packages on packages.id = requested.package_id
    where packages.is_active
      and requested.quantity between 1 and 20
  )
  select
    (select count(*) from requested),
    (select coalesce(sum(quantity), 0) from requested),
    jsonb_agg(jsonb_build_object(
      'packageId', id,
      'packageName', name,
      'quantity', quantity,
      'purchasedCreditsEach', credits,
      'rewardCreditsEach', reward_credits,
      'unitPriceCents', price_cents
    ) order by id),
    coalesce(sum(credits * quantity), 0)::integer,
    coalesce(sum(reward_credits * quantity), 0)::integer,
    coalesce(sum(price_cents * quantity), 0)::integer
  into
    requested_count, requested_quantity, canonical_items,
    purchased_total, reward_total, amount_total
  from validated;

  if canonical_items is null
    or jsonb_array_length(canonical_items) <> requested_count then
    raise exception 'One or more basket packages are unavailable or invalid.';
  end if;
  if requested_quantity not between 1 and 50 then
    raise exception 'A basket may contain no more than 50 packages.';
  end if;
  if amount_total <= 0 or amount_total > 5000000 then
    raise exception 'Basket total is outside the permitted checkout range.';
  end if;

  cart_fingerprint_value := md5(canonical_items::text);

  select * into existing_payment
  from public.payments
  where idempotency_key = btrim(p_idempotency_key)
  for update;

  if existing_payment.id is not null then
    if existing_payment.user_id <> p_user_id
      or existing_payment.provider <> p_provider
      or existing_payment.cart_fingerprint is distinct from cart_fingerprint_value
      or existing_payment.status <> 'pending'
      or existing_payment.checkout_expires_at < now() then
      raise exception 'This checkout request cannot be reused.';
    end if;

    return jsonb_build_object(
      'id', existing_payment.id,
      'userId', existing_payment.user_id,
      'provider', existing_payment.provider,
      'amountCents', existing_payment.amount_cents,
      'purchasedCredits', existing_payment.purchased_credits,
      'rewardCredits', existing_payment.reward_credits,
      'credits', existing_payment.credits,
      'status', existing_payment.status,
      'expiresAt', existing_payment.checkout_expires_at,
      'cartFingerprint', existing_payment.cart_fingerprint,
      'items', canonical_items
    );
  end if;

  if jsonb_array_length(canonical_items) = 1
    and (canonical_items -> 0 ->> 'quantity')::integer = 1 then
    single_package_id := (canonical_items -> 0 ->> 'packageId')::uuid;
  end if;

  insert into public.payments (
    user_id, provider, amount_cents, currency, credits,
    purchased_credits, reward_credits, status, idempotency_key,
    credit_package_id, checkout_expires_at, cart_fingerprint, raw_event
  ) values (
    p_user_id, p_provider, amount_total, 'ZAR', purchased_total + reward_total,
    purchased_total, reward_total, 'pending', btrim(p_idempotency_key),
    single_package_id, now() + interval '30 minutes', cart_fingerprint_value,
    jsonb_build_object(
      'checkoutCreatedAt', now(),
      'cartFingerprint', cart_fingerprint_value,
      'items', canonical_items
    )
  ) returning * into payment_row;

  for item in select value from jsonb_array_elements(canonical_items)
  loop
    insert into public.payment_credit_items (
      payment_id, credit_package_id, package_name, quantity,
      purchased_credits_each, reward_credits_each, unit_price_cents
    ) values (
      payment_row.id,
      (item ->> 'packageId')::uuid,
      item ->> 'packageName',
      (item ->> 'quantity')::integer,
      (item ->> 'purchasedCreditsEach')::integer,
      (item ->> 'rewardCreditsEach')::integer,
      (item ->> 'unitPriceCents')::integer
    );
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_user_id, 'credit_checkout_created', 'payment', payment_row.id,
    jsonb_build_object(
      'provider', p_provider,
      'amountCents', amount_total,
      'purchasedCredits', purchased_total,
      'rewardCredits', reward_total,
      'lineCount', jsonb_array_length(canonical_items),
      'packageQuantity', requested_quantity
    )
  );

  return jsonb_build_object(
    'id', payment_row.id,
    'userId', payment_row.user_id,
    'provider', payment_row.provider,
    'amountCents', payment_row.amount_cents,
    'purchasedCredits', payment_row.purchased_credits,
    'rewardCredits', payment_row.reward_credits,
    'credits', payment_row.credits,
    'status', payment_row.status,
    'expiresAt', payment_row.checkout_expires_at,
    'cartFingerprint', payment_row.cart_fingerprint,
    'items', canonical_items
  );
end;
$$;

revoke all on function public.create_credit_checkout_record(
  uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_credit_checkout_record(
  uuid, text, jsonb, text
) to service_role;

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
  wallet_row record;
  transaction_id uuid := gen_random_uuid();
begin
  select * into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  if payment_row.id is null then raise exception 'Payment not found.'; end if;
  if payment_row.provider <> p_provider then raise exception 'Payment provider mismatch.'; end if;

  if payment_row.status = 'paid' then
    select * into wallet_row from public.wallets where user_id = payment_row.user_id;
    return jsonb_build_object(
      'paymentId', payment_row.id,
      'walletBalance', coalesce(wallet_row.balance, 0),
      'purchasedBalance', coalesce(wallet_row.purchased_balance, 0),
      'rewardBalance', coalesce(wallet_row.reward_balance, 0),
      'purchasedCredits', payment_row.purchased_credits,
      'rewardCredits', payment_row.reward_credits,
      'credits', payment_row.credits,
      'idempotent', true
    );
  end if;

  if payment_row.status <> 'pending' then raise exception 'Payment is not pending.'; end if;
  if payment_row.checkout_expires_at is not null
    and payment_row.checkout_expires_at < now() then
    raise exception 'Payment checkout has expired.';
  end if;

  insert into public.wallets (
    user_id, balance, purchased_balance, reward_balance
  ) values (
    payment_row.user_id, payment_row.credits,
    payment_row.purchased_credits, payment_row.reward_credits
  )
  on conflict (user_id) do update set
    balance = public.wallets.balance + excluded.balance,
    purchased_balance = public.wallets.purchased_balance + excluded.purchased_balance,
    reward_balance = public.wallets.reward_balance + excluded.reward_balance,
    updated_at = now()
  returning * into wallet_row;

  insert into public.credit_transactions (
    id, user_id, payment_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key
  ) values (
    transaction_id, payment_row.user_id, payment_row.id, 'purchase',
    payment_row.credits, wallet_row.balance,
    payment_row.purchased_credits, payment_row.reward_credits,
    wallet_row.purchased_balance, wallet_row.reward_balance,
    case when payment_row.reward_credits > 0
      then 'Credit basket purchase with promotional Reward Credits'
      else 'Credit basket purchase' end,
    'credit-payment:' || payment_row.id::text
  );

  update public.payments set
    status = 'paid',
    provider_reference = nullif(btrim(coalesce(p_provider_reference, '')), ''),
    raw_event = coalesce(raw_event, '{}'::jsonb) ||
      jsonb_build_object('providerEvent', coalesce(p_sanitized_event, '{}'::jsonb)),
    paid_at = now()
  where id = payment_row.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    payment_row.user_id, 'credit_payment_completed', 'payment', payment_row.id,
    jsonb_build_object(
      'provider', payment_row.provider,
      'purchasedCredits', payment_row.purchased_credits,
      'rewardCredits', payment_row.reward_credits,
      'credits', payment_row.credits,
      'amountCents', payment_row.amount_cents,
      'cartFingerprint', payment_row.cart_fingerprint
    )
  );

  return jsonb_build_object(
    'paymentId', payment_row.id,
    'walletBalance', wallet_row.balance,
    'purchasedBalance', wallet_row.purchased_balance,
    'rewardBalance', wallet_row.reward_balance,
    'purchasedCredits', payment_row.purchased_credits,
    'rewardCredits', payment_row.reward_credits,
    'credits', payment_row.credits,
    'idempotent', false
  );
end;
$$;

revoke all on function public.complete_credit_payment(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_credit_payment(uuid, text, text, jsonb)
to service_role;

alter table public.profiles
  add column if not exists accepted_terms_version text,
  add column if not exists premium_terms_accepted_at timestamptz;

create table if not exists public.tip_card_access_logs (
  id uuid primary key default gen_random_uuid(),
  access_code text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  tip_card_id uuid not null references public.tip_cards(id) on delete restrict,
  entitlement_id uuid not null references public.tip_card_entitlements(id) on delete restrict,
  terms_version text not null,
  client_context jsonb not null default '{}'::jsonb,
  accessed_at timestamptz not null default now(),
  check (jsonb_typeof(client_context) = 'object')
);

create index if not exists tip_card_access_logs_user_card_idx
on public.tip_card_access_logs (user_id, tip_card_id, accessed_at desc);
create index if not exists tip_card_access_logs_card_idx
on public.tip_card_access_logs (tip_card_id, accessed_at desc);

alter table public.tip_card_access_logs enable row level security;

drop policy if exists tip_card_access_logs_admin_read on public.tip_card_access_logs;
create policy tip_card_access_logs_admin_read
on public.tip_card_access_logs for select
to authenticated
using (app_private.current_user_has_role('administrator'));

grant select on public.tip_card_access_logs to authenticated;
revoke insert, update, delete on public.tip_card_access_logs from anon, authenticated;

create or replace function public.record_tip_card_access(
  p_tip_card_id uuid,
  p_terms_version text default null,
  p_client_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_terms_version constant text := '2026-08-20-premium-content';
  profile_row public.profiles%rowtype;
  entitlement_row public.tip_card_entitlements%rowtype;
  card_row public.tip_cards%rowtype;
  log_id uuid := gen_random_uuid();
  access_code_value text;
  accessed_at_value timestamptz := now();
begin
  if current_user_id is null or not app_private.current_user_account_active() then
    raise exception 'An active client account is required.';
  end if;

  select * into profile_row
  from public.profiles
  where id = current_user_id
  for update;

  if profile_row.accepted_terms_at is null then
    raise exception 'Website terms acceptance is required.';
  end if;

  if profile_row.accepted_terms_version is distinct from current_terms_version then
    if p_terms_version is distinct from current_terms_version then
      raise exception 'Premium-content terms acceptance is required.';
    end if;

    update public.profiles
    set
      accepted_terms_version = current_terms_version,
      premium_terms_accepted_at = now(),
      updated_at = now()
    where id = current_user_id
    returning * into profile_row;
  end if;

  select * into card_row
  from public.tip_cards
  where id = p_tip_card_id
    and status in ('published', 'settled');

  if card_row.id is null then
    raise exception 'Published meeting card not found.';
  end if;

  select * into entitlement_row
  from public.tip_card_entitlements
  where user_id = current_user_id
    and tip_card_id = p_tip_card_id
    and revoked_at is null
  order by granted_at
  limit 1;

  if entitlement_row.id is null then
    raise exception 'You do not have access to this meeting card.';
  end if;

  if p_client_context is null or jsonb_typeof(p_client_context) <> 'object'
    or octet_length(p_client_context::text) > 2048 then
    raise exception 'Invalid client access context.';
  end if;

  access_code_value := 'MRC-' || upper(substr(replace(log_id::text, '-', ''), 1, 12));

  insert into public.tip_card_access_logs (
    id, access_code, user_id, tip_card_id, entitlement_id,
    terms_version, client_context, accessed_at
  ) values (
    log_id, access_code_value, current_user_id, p_tip_card_id,
    entitlement_row.id, current_terms_version, p_client_context, accessed_at_value
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id, 'premium_tip_card_opened', 'tip_card', p_tip_card_id,
    jsonb_build_object(
      'accessCode', access_code_value,
      'accessLogId', log_id,
      'entitlementId', entitlement_row.id,
      'termsVersion', current_terms_version
    )
  );

  return jsonb_build_object(
    'accessCode', access_code_value,
    'displayName', coalesce(profile_row.display_name, 'MRC Client'),
    'accessedAt', accessed_at_value,
    'termsVersion', current_terms_version
  );
end;
$$;

revoke all on function public.record_tip_card_access(uuid, text, jsonb)
from public, anon;
grant execute on function public.record_tip_card_access(uuid, text, jsonb)
to authenticated;

create or replace function public.admin_lookup_tip_card_access(p_access_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null
      or not app_private.current_user_has_role('administrator') then
      null
    else (
      select jsonb_build_object(
        'accessCode', logs.access_code,
        'userId', logs.user_id,
        'email', users.email,
        'displayName', profiles.display_name,
        'tipCardId', logs.tip_card_id,
        'cardTitle', cards.title,
        'accessedAt', logs.accessed_at,
        'termsVersion', logs.terms_version,
        'clientContext', logs.client_context
      )
      from public.tip_card_access_logs logs
      join auth.users users on users.id = logs.user_id
      join public.profiles profiles on profiles.id = logs.user_id
      join public.tip_cards cards on cards.id = logs.tip_card_id
      where upper(logs.access_code) = upper(btrim(coalesce(p_access_code, '')))
      limit 1
    )
  end;
$$;

revoke all on function public.admin_lookup_tip_card_access(text)
from public, anon;
grant execute on function public.admin_lookup_tip_card_access(text)
to authenticated;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_first_name text := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  supplied_last_name text := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');
  supplied_display_name text := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  terms_accepted boolean := lower(coalesce(new.raw_user_meta_data ->> 'accepted_terms', 'false')) = 'true';
  supplied_terms_version text := nullif(btrim(new.raw_user_meta_data ->> 'accepted_terms_version'), '');
begin
  insert into public.profiles (
    id, first_name, last_name, display_name, phone,
    accepted_terms_at, accepted_terms_version, premium_terms_accepted_at,
    confirmed_over_18_at
  ) values (
    new.id,
    supplied_first_name,
    supplied_last_name,
    coalesce(
      supplied_display_name,
      nullif(btrim(concat_ws(' ', supplied_first_name, supplied_last_name)), '')
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    case when terms_accepted then now() else null end,
    case when terms_accepted then supplied_terms_version else null end,
    case when terms_accepted
      and supplied_terms_version = '2026-08-20-premium-content'
      then now() else null end,
    case
      when lower(coalesce(new.raw_user_meta_data ->> 'confirmed_over_18', 'false')) = 'true'
      then now() else null end
  )
  on conflict (id) do nothing;

  insert into public.user_account_controls (user_id)
  values (new.id) on conflict (user_id) do nothing;
  insert into public.wallets (user_id)
  values (new.id) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'client') on conflict (user_id, role) do nothing;
  return new;
end;
$$;

revoke all on function app_private.handle_new_user() from public, anon, authenticated;

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
  client_url text;
  tipster_url text;
begin
  select
    cards.id, cards.tipster_id, cards.title, cards.revision, cards.meeting_id,
    tipsters.display_name as tipster_name, tipsters.slug as tipster_slug,
    meetings.venue, meetings.meeting_date, meetings.first_race_at
  into card_row
  from public.tip_cards cards
  join public.tipsters tipsters on tipsters.id = cards.tipster_id
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.id = target_tip_card_id;

  insert into public.tip_card_entitlements (
    user_id, tip_card_id, source_type, source_purchase_id, source_subscription_id
  )
  select subscriptions.user_id, card_row.id, 'subscription',
    subscriptions.purchase_id, subscriptions.id
  from public.tipster_subscriptions subscriptions
  where subscriptions.tipster_id = card_row.tipster_id
    and subscriptions.status = 'active'
    and card_row.first_race_at >= subscriptions.starts_at
    and card_row.first_race_at < subscriptions.ends_at
  on conflict do nothing;

  event_title := case when target_event_type = 'tip_card_corrected'
    then 'Tip card correction published' else 'Your meeting tips are ready' end;
  event_body := case when target_event_type = 'tip_card_corrected'
    then card_row.tipster_name || ' updated the ' || card_row.venue || ' meeting card.'
    else card_row.tipster_name || ' published tips for ' || card_row.venue || '.' end;
  client_url := 'https://www.mrcracing.co.za/client/?card=' || card_row.id::text;
  tipster_url := 'https://www.mrcracing.co.za/tipsters/' || card_row.tipster_slug || '/';

  for recipient in
    select distinct
      entitlements.user_id,
      profiles.email_notifications_enabled,
      profiles.sms_notifications_enabled,
      profiles.phone
    from public.tip_card_entitlements entitlements
    join public.profiles profiles on profiles.id = entitlements.user_id
    where entitlements.tip_card_id = card_row.id
      and entitlements.revoked_at is null
  loop
    insert into public.notifications (user_id, title, body)
    values (recipient.user_id, event_title, event_body);

    if recipient.email_notifications_enabled then
      perform app_private.enqueue_notification(
        recipient.user_id,
        target_event_type,
        'tip-card:' || card_row.id::text || ':revision:' || target_revision::text ||
          ':user:' || recipient.user_id::text || ':email',
        jsonb_build_object(
          'template', target_event_type,
          'tipCardId', card_row.id,
          'revision', target_revision,
          'tipsterName', card_row.tipster_name,
          'meetingVenue', card_row.venue,
          'meetingDate', card_row.meeting_date,
          'cardTitle', card_row.title,
          'clientUrl', client_url
        )
      );
    end if;

    if recipient.sms_notifications_enabled
      and nullif(btrim(coalesce(recipient.phone, '')), '') is not null then
      perform app_private.enqueue_sms_notification(
        recipient.user_id,
        target_event_type,
        'tip-card:' || card_row.id::text || ':revision:' || target_revision::text ||
          ':user:' || recipient.user_id::text || ':sms',
        jsonb_build_object(
          'tipCardId', card_row.id,
          'revision', target_revision,
          'message', left(event_body || ' View your card: ' || client_url, 320)
        )
      );
    end if;
    recipient_count := recipient_count + 1;
  end loop;

  -- Favourites receive an email for a new card only. They do not receive
  -- corrections unless they also hold an entitlement, and this notice never
  -- grants access by itself.
  if target_event_type = 'tip_card_published' then
    for recipient in
      select
        favourites.user_id,
        profiles.email_notifications_enabled
      from public.client_tipster_favourites favourites
      join public.profiles profiles on profiles.id = favourites.user_id
      where favourites.tipster_id = card_row.tipster_id
        and not exists (
          select 1
          from public.tip_card_entitlements entitlements
          where entitlements.user_id = favourites.user_id
            and entitlements.tip_card_id = card_row.id
            and entitlements.revoked_at is null
        )
    loop
      insert into public.notifications (user_id, title, body)
      values (
        recipient.user_id,
        'Favourite tipster published a meeting card',
        card_row.tipster_name || ' published a new ' || card_row.venue || ' meeting card.'
      );

      if recipient.email_notifications_enabled then
        perform app_private.enqueue_notification(
          recipient.user_id,
          'favourite_tipster_card_published',
          'favourite-tipster:' || card_row.tipster_id::text ||
            ':card:' || card_row.id::text || ':user:' || recipient.user_id::text || ':email',
          jsonb_build_object(
            'template', 'favourite_tipster_card_published',
            'tipCardId', card_row.id,
            'revision', target_revision,
            'tipsterName', card_row.tipster_name,
            'meetingVenue', card_row.venue,
            'meetingDate', card_row.meeting_date,
            'cardTitle', card_row.title,
            'tipsterUrl', tipster_url
          )
        );
      end if;

      recipient_count := recipient_count + 1;
    end loop;
  end if;

  return recipient_count;
end;
$$;

revoke all on function app_private.queue_tip_card_notifications(uuid, integer, text)
from public, anon, authenticated;

comment on column public.credit_packages.reward_credits is
  'Promotional Reward Credits granted in addition to paid purchased Credits.';
comment on table public.payment_credit_items is
  'Immutable package snapshots belonging to a provider checkout.';
comment on table public.tip_card_access_logs is
  'Immutable trace records for watermarked premium meeting-card views.';
