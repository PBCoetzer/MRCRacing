begin;

create extension if not exists pg_trgm with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'user_account_status'
  ) then
    create type public.user_account_status as enum (
      'active',
      'flagged',
      'suspended',
      'banned'
    );
  end if;
end;
$$;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

create table if not exists public.platform_owners (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.user_account_controls (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status public.user_account_status not null default 'active',
  category text,
  internal_reason text,
  public_message text,
  suspension_until timestamptz,
  auth_sync_status text not null default 'synced'
    check (auth_sync_status in ('synced', 'pending', 'failed')),
  auth_banned_until timestamptz,
  last_auth_sync_error text,
  pending_action text
    check (pending_action is null or pending_action in ('suspend', 'ban', 'restore')),
  pending_status public.user_account_status,
  last_request_id text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_account_controls_suspension_check
    check (status <> 'suspended' or suspension_until is not null)
);

create table if not exists public.admin_user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 3 and 4000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists profiles_first_name_trgm_idx
  on public.profiles using gin (lower(coalesce(first_name, '')) extensions.gin_trgm_ops);

create index if not exists profiles_last_name_trgm_idx
  on public.profiles using gin (lower(coalesce(last_name, '')) extensions.gin_trgm_ops);

create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (lower(coalesce(display_name, '')) extensions.gin_trgm_ops);

create index if not exists profiles_phone_trgm_idx
  on public.profiles using gin (lower(coalesce(phone, '')) extensions.gin_trgm_ops);

create index if not exists user_account_controls_status_idx
  on public.user_account_controls (status, suspension_until);

create index if not exists user_account_controls_updated_by_idx
  on public.user_account_controls (updated_by);

create unique index if not exists user_account_controls_last_request_id_uidx
  on public.user_account_controls (last_request_id)
  where last_request_id is not null;

create index if not exists admin_user_notes_user_created_idx
  on public.admin_user_notes (user_id, created_at desc);

create index if not exists admin_user_notes_created_by_idx
  on public.admin_user_notes (created_by);

insert into public.user_account_controls (user_id)
select id
from public.profiles
on conflict (user_id) do nothing;

do $$
declare
  administrator_count integer;
  owner_user_id uuid;
begin
  select count(distinct user_id)
  into administrator_count
  from public.user_roles
  where role = 'administrator';

  if not exists (select 1 from public.platform_owners) then
    if administrator_count <> 1 then
      raise exception
        'Admin V1 owner bootstrap requires exactly one existing administrator; found %.',
        administrator_count;
    end if;

    select user_id
    into owner_user_id
    from public.user_roles
    where role = 'administrator'
    limit 1;

    insert into public.platform_owners (user_id)
    values (owner_user_id);
  end if;
end;
$$;

create or replace function app_private.account_is_active(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user_id is not null
    and coalesce(
      (
        select case
          when controls.status in ('active', 'flagged') then true
          when controls.status = 'suspended'
            and controls.suspension_until <= now() then true
          else false
        end
        from public.user_account_controls controls
        where controls.user_id = target_user_id
      ),
      true
    );
$$;

create or replace function app_private.current_user_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.account_is_active((select auth.uid()));
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
    and exists (
      select 1
      from public.platform_owners
      where user_id = (select auth.uid())
    );
$$;

create or replace function app_private.current_user_has_role(required_role public.app_role)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    app_private.current_user_account_active()
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role = required_role
    );
$$;

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
    and app_private.current_user_account_active()
  limit 1;
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
  select
    app_private.account_is_active(target_user_id)
    and exists (
      select 1
      from public.tip_card_entitlements entitlements
      join public.tip_cards cards on cards.id = entitlements.tip_card_id
      where entitlements.tip_card_id = target_tip_card_id
        and entitlements.user_id = target_user_id
        and entitlements.revoked_at is null
        and cards.status = 'published'
    );
$$;

create or replace function app_private.user_has_test_access(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.account_is_active(target_user_id)
    and (
      app_private.current_user_has_role('administrator')
      or app_private.current_user_has_role('tipster')
      or exists (
        select 1
        from public.test_access_users
        where user_id = target_user_id
      )
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
begin
  insert into public.profiles (
    id,
    first_name,
    last_name,
    display_name,
    phone,
    accepted_terms_at,
    confirmed_over_18_at
  )
  values (
    new.id,
    supplied_first_name,
    supplied_last_name,
    coalesce(
      supplied_display_name,
      nullif(btrim(concat_ws(' ', supplied_first_name, supplied_last_name)), '')
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
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

  insert into public.user_account_controls (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'client')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

create or replace function app_private.reject_admin_note_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Administrator notes are append-only.';
end;
$$;

drop trigger if exists admin_user_notes_immutable on public.admin_user_notes;
create trigger admin_user_notes_immutable
before update or delete on public.admin_user_notes
for each row execute function app_private.reject_admin_note_mutation();

create or replace function app_private.enforce_active_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null and not app_private.account_is_active(actor_id) then
    raise exception 'This account is currently restricted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'client_tipster_favourites',
    'content_purchases',
    'credit_transactions',
    'media_assets',
    'notifications',
    'payments',
    'purchase_disputes',
    'race_tip_selections',
    'subscriptions',
    'test_access_users',
    'tip_card_entitlements',
    'tip_card_multiple_selections',
    'tip_card_multiples',
    'tip_card_revisions',
    'tip_cards',
    'tip_unlocks',
    'tips',
    'tipster_earnings',
    'tipster_packages',
    'tipster_subscriptions',
    'tipsters',
    'user_roles',
    'wallets'
  ]
  loop
    execute format(
      'drop trigger if exists enforce_active_actor on public.%I',
      target_table
    );
    execute format(
      'create trigger enforce_active_actor before insert or update or delete on public.%I for each row execute function app_private.enforce_active_actor()',
      target_table
    );
  end loop;
end;
$$;

alter table public.platform_owners enable row level security;
alter table public.user_account_controls enable row level security;
alter table public.admin_user_notes enable row level security;

drop policy if exists platform_owners_admin_read on public.platform_owners;
create policy platform_owners_admin_read
on public.platform_owners
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists user_account_controls_own_or_admin_read on public.user_account_controls;
create policy user_account_controls_own_or_admin_read
on public.user_account_controls
for select
to authenticated
using (
  user_id = (select auth.uid())
  or app_private.current_user_has_role('administrator')
);

drop policy if exists admin_user_notes_admin_read on public.admin_user_notes;
create policy admin_user_notes_admin_read
on public.admin_user_notes
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

revoke all on public.platform_owners from anon, authenticated;
revoke all on public.user_account_controls from anon, authenticated;
revoke all on public.admin_user_notes from anon, authenticated;

grant select on public.platform_owners to authenticated;
grant select on public.user_account_controls to authenticated;
grant select on public.admin_user_notes to authenticated;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'profiles',
    'user_roles',
    'wallets',
    'credit_transactions',
    'payments',
    'content_purchases',
    'subscriptions',
    'tip_unlocks',
    'notifications',
    'purchase_disputes',
    'test_access_users',
    'tip_card_entitlements',
    'race_tip_selections',
    'tip_card_multiples',
    'tip_card_multiple_selections',
    'tip_card_revisions',
    'tip_cards',
    'tipster_earnings',
    'tipster_subscriptions',
    'tipster_packages',
    'tipsters',
    'media_assets',
    'audit_logs',
    'notification_outbox',
    'client_tipster_favourites'
  ]
  loop
    policy_name := target_table || '_active_account';
    execute format(
      'drop policy if exists %I on public.%I',
      policy_name,
      target_table
    );
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (app_private.current_user_account_active()) with check (app_private.current_user_account_active())',
      policy_name,
      target_table
    );
  end loop;
end;
$$;

create or replace function public.admin_search_users(
  p_query text default null,
  p_roles public.app_role[] default null,
  p_statuses public.user_account_status[] default null,
  p_email_confirmed boolean default null,
  p_verified_tipster boolean default null,
  p_test_access boolean default null,
  p_missing_identity boolean default null,
  p_sort text default 'created_desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  search_query text := lower(btrim(coalesce(p_query, '')));
  requested_page integer := greatest(coalesce(p_page, 1), 1);
  requested_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  requested_sort text := case
    when p_sort in (
      'created_desc',
      'created_asc',
      'name_asc',
      'email_asc',
      'last_sign_in_desc',
      'credits_desc'
    ) then p_sort
    else 'created_desc'
  end;
  result jsonb;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  with candidates as (
    select
      users.id as user_id,
      users.email::text as email,
      profiles.first_name,
      profiles.last_name,
      profiles.display_name,
      profiles.phone,
      coalesce(
        array_agg(roles.role order by roles.role)
          filter (where roles.role is not null),
        '{}'::public.app_role[]
      ) as roles,
      coalesce(controls.status, 'active'::public.user_account_status) as status,
      controls.suspension_until,
      controls.auth_sync_status,
      coalesce(wallets.balance, 0) as credit_balance,
      tipsters.id as tipster_id,
      tipsters.display_name as tipster_display_name,
      coalesce(tipsters.is_verified, false) as tipster_verified,
      test_users.user_id is not null as test_access,
      owners.user_id is not null as is_owner,
      users.email_confirmed_at is not null as email_confirmed,
      users.last_sign_in_at,
      users.created_at
    from auth.users users
    left join public.profiles profiles on profiles.id = users.id
    left join public.user_roles roles on roles.user_id = users.id
    left join public.user_account_controls controls on controls.user_id = users.id
    left join public.wallets wallets on wallets.user_id = users.id
    left join public.tipsters tipsters on tipsters.user_id = users.id
    left join public.test_access_users test_users on test_users.user_id = users.id
    left join public.platform_owners owners on owners.user_id = users.id
    group by
      users.id,
      users.email,
      profiles.first_name,
      profiles.last_name,
      profiles.display_name,
      profiles.phone,
      controls.status,
      controls.suspension_until,
      controls.auth_sync_status,
      wallets.balance,
      tipsters.id,
      tipsters.display_name,
      tipsters.is_verified,
      test_users.user_id,
      owners.user_id,
      users.email_confirmed_at,
      users.last_sign_in_at,
      users.created_at
  ),
  filtered as (
    select *
    from candidates
    where (
      search_query = ''
      or lower(coalesce(email, '')) like '%' || search_query || '%'
      or lower(coalesce(first_name, '')) like '%' || search_query || '%'
      or lower(coalesce(last_name, '')) like '%' || search_query || '%'
      or lower(coalesce(display_name, '')) like '%' || search_query || '%'
      or lower(coalesce(phone, '')) like '%' || search_query || '%'
      or lower(btrim(concat_ws(' ', first_name, last_name))) like '%' || search_query || '%'
    )
      and (p_roles is null or roles && p_roles)
      and (p_statuses is null or status = any(p_statuses))
      and (p_email_confirmed is null or email_confirmed = p_email_confirmed)
      and (p_verified_tipster is null or tipster_verified = p_verified_tipster)
      and (p_test_access is null or test_access = p_test_access)
      and (
        p_missing_identity is null
        or p_missing_identity = (
          nullif(btrim(coalesce(first_name, '')), '') is null
          or nullif(btrim(coalesce(last_name, '')), '') is null
        )
      )
  ),
  ordered as (
    select
      filtered.*,
      row_number() over (
        order by
          case when requested_sort = 'name_asc'
            then lower(coalesce(display_name, btrim(concat_ws(' ', first_name, last_name)), email))
          end asc nulls last,
          case when requested_sort = 'email_asc'
            then lower(coalesce(email, ''))
          end asc,
          case when requested_sort = 'last_sign_in_desc'
            then last_sign_in_at
          end desc nulls last,
          case when requested_sort = 'credits_desc'
            then credit_balance
          end desc,
          case when requested_sort = 'created_asc'
            then created_at
          end asc,
          case when requested_sort = 'created_desc'
            then created_at
          end desc,
          created_at desc,
          user_id
      ) as row_index
    from filtered
  ),
  page_rows as (
    select *
    from ordered
    where row_index > (requested_page - 1) * requested_page_size
      and row_index <= requested_page * requested_page_size
  )
  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'userId', page_rows.user_id,
            'email', page_rows.email,
            'firstName', page_rows.first_name,
            'lastName', page_rows.last_name,
            'displayName', page_rows.display_name,
            'phone', page_rows.phone,
            'roles', to_jsonb(page_rows.roles),
            'status', page_rows.status,
            'suspensionUntil', page_rows.suspension_until,
            'authSyncStatus', page_rows.auth_sync_status,
            'creditBalance', page_rows.credit_balance,
            'tipsterId', page_rows.tipster_id,
            'tipsterDisplayName', page_rows.tipster_display_name,
            'tipsterVerified', page_rows.tipster_verified,
            'testAccess', page_rows.test_access,
            'isOwner', page_rows.is_owner,
            'emailConfirmed', page_rows.email_confirmed,
            'lastSignInAt', page_rows.last_sign_in_at,
            'createdAt', page_rows.created_at
          )
          order by page_rows.row_index
        )
        from page_rows
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from filtered),
    'page', requested_page,
    'pageSize', requested_page_size
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_get_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  select jsonb_build_object(
    'identity',
    jsonb_build_object(
      'userId', users.id,
      'email', users.email,
      'firstName', profiles.first_name,
      'lastName', profiles.last_name,
      'displayName', profiles.display_name,
      'phone', profiles.phone,
      'emailConfirmed', users.email_confirmed_at is not null,
      'emailConfirmedAt', users.email_confirmed_at,
      'lastSignInAt', users.last_sign_in_at,
      'createdAt', users.created_at,
      'isOwner', owners.user_id is not null
    ),
    'roles',
    coalesce(
      (
        select jsonb_agg(roles.role order by roles.role)
        from public.user_roles roles
        where roles.user_id = users.id
      ),
      '[]'::jsonb
    ),
    'moderation',
    jsonb_build_object(
      'status', coalesce(controls.status, 'active'::public.user_account_status),
      'category', controls.category,
      'internalReason', controls.internal_reason,
      'publicMessage', controls.public_message,
      'suspensionUntil', controls.suspension_until,
      'authSyncStatus', coalesce(controls.auth_sync_status, 'synced'),
      'authBannedUntil', controls.auth_banned_until,
      'lastAuthSyncError', controls.last_auth_sync_error,
      'pendingAction', controls.pending_action,
      'updatedAt', controls.updated_at
    ),
    'access',
    jsonb_build_object(
      'testAccess', test_users.user_id is not null,
      'tipsterId', tipsters.id,
      'tipsterDisplayName', tipsters.display_name,
      'tipsterBiography', tipsters.biography,
      'tipsterVerified', coalesce(tipsters.is_verified, false)
    ),
    'wallet',
    jsonb_build_object(
      'balance', coalesce(wallets.balance, 0),
      'transactions',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', ledger.id,
              'type', ledger.transaction_type,
              'amount', ledger.amount,
              'balanceAfter', ledger.balance_after,
              'reason', ledger.reason,
              'createdBy', ledger.created_by,
              'createdAt', ledger.created_at
            )
            order by ledger.created_at desc
          )
          from (
            select *
            from public.credit_transactions
            where user_id = users.id
            order by created_at desc
            limit 25
          ) ledger
        ),
        '[]'::jsonb
      )
    ),
    'purchases',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', purchases.id,
            'type', purchases.purchase_type,
            'status', purchases.status,
            'credits', purchases.gross_coins,
            'tipsterName', purchase_tipsters.display_name,
            'meetingCard', cards.title,
            'subscriptionPackage', packages.name,
            'refundedAt', purchases.refunded_at,
            'createdAt', purchases.created_at
          )
          order by purchases.created_at desc
        )
        from public.content_purchases purchases
        left join public.tipsters purchase_tipsters on purchase_tipsters.id = purchases.tipster_id
        left join public.tip_cards cards on cards.id = purchases.tip_card_id
        left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
        where purchases.user_id = users.id
      ),
      '[]'::jsonb
    ),
    'subscriptions',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', subscriptions.id,
            'status', subscriptions.status,
            'tipsterName', subscription_tipsters.display_name,
            'packageName', subscription_packages.name,
            'startsAt', subscriptions.starts_at,
            'endsAt', subscriptions.ends_at,
            'createdAt', subscriptions.created_at
          )
          order by subscriptions.created_at desc
        )
        from public.tipster_subscriptions subscriptions
        join public.tipsters subscription_tipsters
          on subscription_tipsters.id = subscriptions.tipster_id
        join public.tipster_packages subscription_packages
          on subscription_packages.id = subscriptions.package_id
        where subscriptions.user_id = users.id
      ),
      '[]'::jsonb
    ),
    'disputes',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', disputes.id,
            'purchaseId', disputes.purchase_id,
            'reason', disputes.reason,
            'status', disputes.status,
            'adminNotes', disputes.admin_notes,
            'resolvedAt', disputes.resolved_at,
            'createdAt', disputes.created_at
          )
          order by disputes.created_at desc
        )
        from public.purchase_disputes disputes
        where disputes.user_id = users.id
      ),
      '[]'::jsonb
    ),
    'tipsterActivity',
    jsonb_build_object(
      'cards',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', cards.id,
              'title', cards.title,
              'status', cards.status,
              'creditPrice', cards.coin_price,
              'revision', cards.revision,
              'publishedAt', cards.published_at,
              'createdAt', cards.created_at
            )
            order by cards.created_at desc
          )
          from public.tip_cards cards
          where cards.tipster_id = tipsters.id
        ),
        '[]'::jsonb
      ),
      'earnings',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', earnings.id,
              'type', earnings.entry_type,
              'grossCredits', earnings.gross_coins,
              'platformFeeCredits', earnings.platform_fee_coins,
              'netCredits', earnings.net_coins,
              'createdAt', earnings.created_at
            )
            order by earnings.created_at desc
          )
          from (
            select *
            from public.tipster_earnings
            where tipster_id = tipsters.id
            order by created_at desc
            limit 25
          ) earnings
        ),
        '[]'::jsonb
      )
    ),
    'notes',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', notes.id,
            'body', notes.body,
            'authorId', notes.created_by,
            'authorName', coalesce(
              note_authors.display_name,
              nullif(btrim(concat_ws(' ', note_authors.first_name, note_authors.last_name)), ''),
              author_users.email
            ),
            'createdAt', notes.created_at
          )
          order by notes.created_at desc
        )
        from public.admin_user_notes notes
        left join public.profiles note_authors on note_authors.id = notes.created_by
        left join auth.users author_users on author_users.id = notes.created_by
        where notes.user_id = users.id
      ),
      '[]'::jsonb
    ),
    'auditHistory',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', audit.id,
            'actorId', audit.actor_id,
            'action', audit.action,
            'entityType', audit.entity_type,
            'entityId', audit.entity_id,
            'metadata', audit.metadata,
            'createdAt', audit.created_at
          )
          order by audit.created_at desc
        )
        from (
          select *
          from public.audit_logs
          where entity_id = users.id
            or actor_id = users.id
          order by created_at desc
          limit 100
        ) audit
      ),
      '[]'::jsonb
    )
  )
  into result
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id
  left join public.user_account_controls controls on controls.user_id = users.id
  left join public.platform_owners owners on owners.user_id = users.id
  left join public.test_access_users test_users on test_users.user_id = users.id
  left join public.wallets wallets on wallets.user_id = users.id
  left join public.tipsters tipsters on tipsters.user_id = users.id
  where users.id = p_user_id;

  if result is null then
    raise exception 'User not found.';
  end if;

  return result;
end;
$$;

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_display_name text,
  p_phone text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  previous_profile jsonb;
  updated_profile jsonb;
  normalized_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  normalized_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if normalized_first_name is null or normalized_last_name is null then
    raise exception 'First name and surname are required.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason of at least five characters is required.';
  end if;

  select jsonb_build_object(
    'firstName', first_name,
    'lastName', last_name,
    'displayName', display_name,
    'phone', phone
  )
  into previous_profile
  from public.profiles
  where id = p_user_id
  for update;

  if previous_profile is null then
    raise exception 'User profile not found.';
  end if;

  update public.profiles
  set
    first_name = normalized_first_name,
    last_name = normalized_last_name,
    display_name = coalesce(
      nullif(btrim(coalesce(p_display_name, '')), ''),
      btrim(concat_ws(' ', normalized_first_name, normalized_last_name))
    ),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    updated_at = now()
  where id = p_user_id
  returning jsonb_build_object(
    'firstName', first_name,
    'lastName', last_name,
    'displayName', display_name,
    'phone', phone
  )
  into updated_profile;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    actor_id,
    'user_profile_updated',
    'profile',
    p_user_id,
    jsonb_build_object(
      'before', previous_profile,
      'after', updated_profile,
      'reason', btrim(p_reason)
    )
  );

  return updated_profile;
end;
$$;

create or replace function public.admin_configure_user_v2(
  p_user_id uuid,
  p_client boolean,
  p_tipster boolean,
  p_administrator boolean,
  p_tipster_display_name text default null,
  p_tipster_biography text default null,
  p_verify_tipster boolean default false,
  p_test_access boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_owner boolean := app_private.current_user_is_owner();
  target_is_owner boolean;
  target_is_administrator boolean;
  tipster_row public.tipsters%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason of at least five characters is required.';
  end if;

  target_is_owner := (
    select exists (
      select 1
      from public.platform_owners
      where user_id = p_user_id
    )
  );

  target_is_administrator := (
    select exists (
      select 1
      from public.user_roles
      where user_id = p_user_id
        and role = 'administrator'
    )
  );

  if target_is_owner and not p_administrator then
    raise exception 'The platform owner cannot be demoted.';
  end if;

  if not actor_is_owner and target_is_administrator then
    raise exception 'Only the platform owner can configure another administrator.';
  end if;

  if p_administrator <> target_is_administrator and not actor_is_owner then
    raise exception 'Only the platform owner can grant or remove administrator access.';
  end if;

  if not p_client and not p_tipster and not p_administrator then
    raise exception 'At least one role is required.';
  end if;

  if p_client then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'client')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id
      and role = 'client';
  end if;

  if p_tipster then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'tipster')
    on conflict (user_id, role) do nothing;

    insert into public.tipsters (
      user_id,
      display_name,
      biography,
      is_verified
    )
    values (
      p_user_id,
      coalesce(
        nullif(btrim(coalesce(p_tipster_display_name, '')), ''),
        (
          select nullif(btrim(coalesce(display_name, '')), '')
          from public.profiles
          where id = p_user_id
        ),
        'MRC Tipster'
      ),
      nullif(btrim(coalesce(p_tipster_biography, '')), ''),
      p_verify_tipster
    )
    on conflict (user_id) do update
    set
      display_name = excluded.display_name,
      biography = excluded.biography,
      is_verified = excluded.is_verified,
      updated_at = now()
    returning * into tipster_row;
  else
    delete from public.user_roles
    where user_id = p_user_id
      and role = 'tipster';

    update public.tipsters
    set
      is_verified = false,
      updated_at = now()
    where user_id = p_user_id
    returning * into tipster_row;
  end if;

  if p_administrator then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'administrator')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id
      and role = 'administrator';
  end if;

  if p_test_access then
    insert into public.test_access_users (user_id, granted_by)
    values (p_user_id, actor_id)
    on conflict (user_id) do update
    set granted_by = excluded.granted_by;
  else
    delete from public.test_access_users
    where user_id = p_user_id;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    actor_id,
    'user_access_configured_v2',
    'profile',
    p_user_id,
    jsonb_build_object(
      'client', p_client,
      'tipster', p_tipster,
      'administrator', p_administrator,
      'tipsterVerified', p_verify_tipster,
      'testAccess', p_test_access,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'client', p_client,
    'tipster', p_tipster,
    'administrator', p_administrator,
    'tipsterId', tipster_row.id,
    'tipsterVerified', coalesce(tipster_row.is_verified, false),
    'testAccess', p_test_access
  );
end;
$$;

create or replace function public.admin_adjust_wallet_v2(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_balance integer;
  new_balance integer;
  transaction_id uuid := gen_random_uuid();
  normalized_key text;
  existing_transaction public.credit_transactions%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Credit adjustment must be non-zero.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reason of at least ten characters is required.';
  end if;

  if char_length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'A valid idempotency key is required.';
  end if;

  normalized_key :=
    'admin-wallet:' || actor_id::text || ':' || btrim(p_idempotency_key);

  select *
  into existing_transaction
  from public.credit_transactions
  where idempotency_key = normalized_key;

  if existing_transaction.id is not null then
    if existing_transaction.user_id <> p_user_id
      or existing_transaction.amount <> p_amount
    then
      raise exception 'The idempotency key has already been used for another adjustment.';
    end if;

    return jsonb_build_object(
      'userId', existing_transaction.user_id,
      'amount', existing_transaction.amount,
      'balance', existing_transaction.balance_after,
      'transactionId', existing_transaction.id,
      'idempotent', true
    );
  end if;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select balance
  into current_balance
  from public.wallets
  where user_id = p_user_id
  for update;

  new_balance := current_balance + p_amount;

  if new_balance < 0 then
    raise exception 'Credit balance cannot become negative.';
  end if;

  update public.wallets
  set
    balance = new_balance,
    updated_at = now()
  where user_id = p_user_id;

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
    p_user_id,
    case
      when p_amount > 0 then 'admin_add'::public.credit_transaction_type
      else 'admin_remove'::public.credit_transaction_type
    end,
    p_amount,
    new_balance,
    btrim(p_reason),
    normalized_key,
    actor_id
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    actor_id,
    'wallet_adjusted_v2',
    'wallet',
    p_user_id,
    jsonb_build_object(
      'amount', p_amount,
      'balanceBefore', current_balance,
      'balanceAfter', new_balance,
      'reason', btrim(p_reason),
      'idempotencyKey', btrim(p_idempotency_key),
      'largeAdjustment', abs(p_amount) >= 1000
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'amount', p_amount,
    'balance', new_balance,
    'transactionId', transaction_id,
    'idempotent', false
  );
end;
$$;

create or replace function public.admin_add_user_note(
  p_user_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  note_row public.admin_user_notes%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  insert into public.admin_user_notes (
    user_id,
    body,
    created_by
  )
  values (
    p_user_id,
    btrim(p_body),
    actor_id
  )
  returning * into note_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    actor_id,
    'admin_user_note_added',
    'profile',
    p_user_id,
    jsonb_build_object('noteId', note_row.id)
  );

  return jsonb_build_object(
    'id', note_row.id,
    'userId', note_row.user_id,
    'body', note_row.body,
    'createdBy', note_row.created_by,
    'createdAt', note_row.created_at
  );
end;
$$;

create or replace function public.admin_stage_user_control(
  p_actor_id uuid,
  p_user_id uuid,
  p_action text,
  p_category text,
  p_internal_reason text,
  p_public_message text,
  p_suspension_until timestamptz,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_is_owner boolean;
  target_is_owner boolean;
  target_is_administrator boolean;
  current_status public.user_account_status;
  current_pending_action text;
  current_auth_sync_status text;
  current_last_request_id text;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_request_id text := btrim(coalesce(p_request_id, ''));
  auth_sync_required boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  if normalized_action not in ('flag', 'suspend', 'ban', 'restore') then
    raise exception 'Unsupported moderation action.';
  end if;

  if char_length(normalized_request_id) < 8 then
    raise exception 'A valid moderation request id is required.';
  end if;

  if char_length(btrim(coalesce(p_internal_reason, ''))) < 10 then
    raise exception 'An internal reason of at least ten characters is required.';
  end if;

  if normalized_action <> 'restore'
    and nullif(btrim(coalesce(p_category, '')), '') is null
  then
    raise exception 'A moderation category is required.';
  end if;

  if not exists (
    select 1
    from public.user_roles
    where user_id = p_actor_id
      and role = 'administrator'
  ) or not app_private.account_is_active(p_actor_id) then
    raise exception 'Active administrator access required.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  actor_is_owner := (
    select exists (
      select 1
      from public.platform_owners
      where user_id = p_actor_id
    )
  );

  target_is_owner := (
    select exists (
      select 1
      from public.platform_owners
      where user_id = p_user_id
    )
  );

  target_is_administrator := (
    select exists (
      select 1
      from public.user_roles
      where user_id = p_user_id
        and role = 'administrator'
    )
  );

  if target_is_owner and normalized_action in ('suspend', 'ban') then
    raise exception 'The platform owner cannot be suspended or banned.';
  end if;

  if target_is_administrator and p_user_id <> p_actor_id and not actor_is_owner then
    raise exception 'Only the platform owner can moderate another administrator.';
  end if;

  if p_user_id = p_actor_id and normalized_action in ('suspend', 'ban') then
    raise exception 'Administrators cannot suspend or ban their own account.';
  end if;

  if normalized_action = 'suspend' then
    if p_suspension_until is null or p_suspension_until <= now() then
      raise exception 'A future suspension expiry is required.';
    end if;

    if p_suspension_until > now() + interval '1 year' then
      raise exception 'A temporary suspension cannot exceed one year.';
    end if;
  end if;

  insert into public.user_account_controls (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select
    status,
    pending_action,
    auth_sync_status,
    last_request_id
  into
    current_status,
    current_pending_action,
    current_auth_sync_status,
    current_last_request_id
  from public.user_account_controls
  where user_id = p_user_id
  for update;

  if current_last_request_id = normalized_request_id
    and current_pending_action = normalized_action
    and current_auth_sync_status in ('pending', 'failed')
  then
    update public.user_account_controls
    set
      auth_sync_status = 'pending',
      last_auth_sync_error = null,
      updated_by = p_actor_id,
      updated_at = now()
    where user_id = p_user_id;

    return jsonb_build_object(
      'userId', p_user_id,
      'action', normalized_action,
      'requestId', normalized_request_id,
      'authSyncRequired', true,
      'idempotentRetry', true
    );
  end if;

  if current_pending_action is not null
    and current_auth_sync_status in ('pending', 'failed')
  then
    raise exception 'This user already has a moderation action awaiting Auth synchronization.';
  end if;

  if normalized_action = 'flag' then
    if current_status not in ('active', 'flagged') then
      raise exception 'Restore the restricted account before applying an internal flag.';
    end if;

    update public.user_account_controls
    set
      status = 'flagged',
      category = btrim(p_category),
      internal_reason = btrim(p_internal_reason),
      public_message = null,
      suspension_until = null,
      auth_sync_status = 'synced',
      auth_banned_until = null,
      last_auth_sync_error = null,
      pending_action = null,
      pending_status = null,
      last_request_id = normalized_request_id,
      updated_by = p_actor_id,
      updated_at = now()
    where user_id = p_user_id;

    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      p_actor_id,
      'user_flagged',
      'profile',
      p_user_id,
      jsonb_build_object(
        'category', btrim(p_category),
        'internalReason', btrim(p_internal_reason),
        'requestId', normalized_request_id
      )
    );
  elsif normalized_action = 'suspend' then
    auth_sync_required := true;

    update public.user_account_controls
    set
      status = 'suspended',
      category = btrim(p_category),
      internal_reason = btrim(p_internal_reason),
      public_message = nullif(btrim(coalesce(p_public_message, '')), ''),
      suspension_until = p_suspension_until,
      auth_sync_status = 'pending',
      auth_banned_until = null,
      last_auth_sync_error = null,
      pending_action = 'suspend',
      pending_status = 'suspended',
      last_request_id = normalized_request_id,
      updated_by = p_actor_id,
      updated_at = now()
    where user_id = p_user_id;
  elsif normalized_action = 'ban' then
    auth_sync_required := true;

    update public.user_account_controls
    set
      status = 'banned',
      category = btrim(p_category),
      internal_reason = btrim(p_internal_reason),
      public_message = nullif(btrim(coalesce(p_public_message, '')), ''),
      suspension_until = null,
      auth_sync_status = 'pending',
      auth_banned_until = null,
      last_auth_sync_error = null,
      pending_action = 'ban',
      pending_status = 'banned',
      last_request_id = normalized_request_id,
      updated_by = p_actor_id,
      updated_at = now()
    where user_id = p_user_id;
  else
    if current_status = 'active' then
      return jsonb_build_object(
        'userId', p_user_id,
        'action', normalized_action,
        'requestId', normalized_request_id,
        'authSyncRequired', false,
        'alreadyActive', true
      );
    end if;

    if current_status = 'flagged' then
      update public.user_account_controls
      set
        status = 'active',
        category = null,
        internal_reason = btrim(p_internal_reason),
        public_message = nullif(btrim(coalesce(p_public_message, '')), ''),
        suspension_until = null,
        auth_sync_status = 'synced',
        auth_banned_until = null,
        last_auth_sync_error = null,
        pending_action = null,
        pending_status = null,
        last_request_id = normalized_request_id,
        updated_by = p_actor_id,
        updated_at = now()
      where user_id = p_user_id;

      insert into public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      values (
        p_actor_id,
        'user_flag_removed',
        'profile',
        p_user_id,
        jsonb_build_object(
          'internalReason', btrim(p_internal_reason),
          'requestId', normalized_request_id
        )
      );
    else
      auth_sync_required := true;

      update public.user_account_controls
      set
        internal_reason = btrim(p_internal_reason),
        public_message = nullif(btrim(coalesce(p_public_message, '')), ''),
        auth_sync_status = 'pending',
        last_auth_sync_error = null,
        pending_action = 'restore',
        pending_status = 'active',
        last_request_id = normalized_request_id,
        updated_by = p_actor_id,
        updated_at = now()
      where user_id = p_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'userId', p_user_id,
    'action', normalized_action,
    'requestId', normalized_request_id,
    'authSyncRequired', auth_sync_required,
    'idempotentRetry', false
  );
end;
$$;

create or replace function public.admin_complete_user_control_sync(
  p_request_id text,
  p_success boolean,
  p_auth_banned_until timestamptz default null,
  p_sanitized_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control_user_id uuid;
  control_status public.user_account_status;
  control_category text;
  control_internal_reason text;
  control_public_message text;
  control_suspension_until timestamptz;
  control_pending_action text;
  control_pending_status public.user_account_status;
  control_last_request_id text;
  control_updated_by uuid;
  completed_action text;
  completed_status public.user_account_status;
  event_type text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  select
    user_id,
    status,
    category,
    internal_reason,
    public_message,
    suspension_until,
    pending_action,
    pending_status,
    last_request_id,
    updated_by
  into
    control_user_id,
    control_status,
    control_category,
    control_internal_reason,
    control_public_message,
    control_suspension_until,
    control_pending_action,
    control_pending_status,
    control_last_request_id,
    control_updated_by
  from public.user_account_controls
  where last_request_id = btrim(p_request_id)
  for update;

  if control_user_id is null then
    raise exception 'Moderation request not found.';
  end if;

  if control_pending_action is null then
    return jsonb_build_object(
      'userId', control_user_id,
      'status', control_status,
      'idempotent', true
    );
  end if;

  completed_action := control_pending_action;
  completed_status := control_pending_status;

  if not p_success then
    update public.user_account_controls
    set
      auth_sync_status = 'failed',
      last_auth_sync_error = left(
        coalesce(nullif(btrim(p_sanitized_error), ''), 'Authentication synchronization failed.'),
        240
      ),
      updated_at = now()
    where user_id = control_user_id;

    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      control_updated_by,
      'user_moderation_auth_sync_failed',
      'profile',
      control_user_id,
      jsonb_build_object(
        'moderationAction', completed_action,
        'requestId', control_last_request_id
      )
    );

    return jsonb_build_object(
      'userId', control_user_id,
      'status', control_status,
      'authSyncStatus', 'failed'
    );
  end if;

  update public.user_account_controls
  set
    status = completed_status,
    category = case when completed_status = 'active' then null else category end,
    suspension_until = case
      when completed_status = 'suspended' then suspension_until
      else null
    end,
    auth_sync_status = 'synced',
    auth_banned_until = p_auth_banned_until,
    last_auth_sync_error = null,
    pending_action = null,
    pending_status = null,
    updated_at = now()
  where user_id = control_user_id;

  event_type := case completed_action
    when 'suspend' then 'account_suspended'
    when 'ban' then 'account_banned'
    when 'restore' then 'account_restored'
  end;

  if event_type is not null then
    insert into public.notification_outbox (
      user_id,
      event_type,
      channel,
      dedupe_key,
      payload
    )
    values (
      control_user_id,
      event_type,
      'email',
      'user-control:' || control_last_request_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'userId', control_user_id,
          'status', completed_status,
          'suspensionUntil', case
            when completed_status = 'suspended' then control_suspension_until
            else null
          end,
          'publicMessage', control_public_message
        )
      )
    )
    on conflict (dedupe_key) do nothing;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    control_updated_by,
    case completed_action
      when 'suspend' then 'user_suspended'
      when 'ban' then 'user_banned'
      when 'restore' then 'user_restored'
    end,
    'profile',
    control_user_id,
    jsonb_build_object(
      'category', control_category,
      'internalReason', control_internal_reason,
      'suspensionUntil', control_suspension_until,
      'requestId', control_last_request_id
    )
  );

  return jsonb_build_object(
    'userId', control_user_id,
    'status', completed_status,
    'authSyncStatus', 'synced',
    'notificationQueued', event_type is not null
  );
end;
$$;

create or replace function public.admin_reschedule_test_meeting(
  p_meeting_id uuid,
  p_days_ahead integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  meeting_row public.race_meetings%rowtype;
  target_date date;
  new_first_race_at timestamptz;
  time_shift interval;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if p_days_ahead not in (3, 7, 14) then
    raise exception 'Test meetings may only be moved 3, 7, or 14 days forward.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason of at least five characters is required.';
  end if;

  select *
  into meeting_row
  from public.race_meetings
  where id = p_meeting_id
  for update;

  if meeting_row.id is null or not meeting_row.is_test then
    raise exception 'Private test meeting not found.';
  end if;

  if exists (
    select 1
    from public.tip_cards cards
    where cards.meeting_id = meeting_row.id
      and (
        cards.published_at is not null
        or cards.status in ('published', 'settled', 'void')
      )
  ) then
    raise exception 'A test meeting with a published card cannot be rescheduled.';
  end if;

  if exists (
    select 1
    from public.content_purchases purchases
    join public.tip_cards cards on cards.id = purchases.tip_card_id
    where cards.meeting_id = meeting_row.id
  ) then
    raise exception 'A test meeting with purchases cannot be rescheduled.';
  end if;

  target_date :=
    (now() at time zone 'Africa/Johannesburg')::date + p_days_ahead;

  new_first_race_at := (
    target_date::text
    || ' '
    || to_char(
      meeting_row.first_race_at at time zone 'Africa/Johannesburg',
      'HH24:MI:SS'
    )
    || ' Africa/Johannesburg'
  )::timestamptz;

  time_shift := new_first_race_at - meeting_row.first_race_at;

  update public.fixtures
  set
    starts_at = starts_at + time_shift,
    updated_at = now()
  where meeting_id = meeting_row.id;

  update public.meeting_bet_options
  set
    cutoff_at = cutoff_at + time_shift,
    updated_at = now()
  where meeting_id = meeting_row.id;

  update public.race_meetings
  set
    meeting_date = target_date,
    first_race_at = first_race_at + time_shift,
    last_race_at = case
      when last_race_at is null then null
      else last_race_at + time_shift
    end,
    status = 'scheduled',
    source_updated_at = now(),
    source_payload = source_payload || jsonb_build_object(
      'lastAdminRescheduledAt', now(),
      'lastAdminRescheduledBy', actor_id,
      'syntheticTargetDate', target_date
    ),
    updated_at = now()
  where id = meeting_row.id;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    actor_id,
    'test_meeting_rescheduled',
    'race_meeting',
    meeting_row.id,
    jsonb_build_object(
      'daysAhead', p_days_ahead,
      'previousFirstRaceAt', meeting_row.first_race_at,
      'newFirstRaceAt', new_first_race_at,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'meetingId', meeting_row.id,
    'meetingDate', target_date,
    'firstRaceAt', new_first_race_at,
    'daysAhead', p_days_ahead
  );
end;
$$;

revoke execute on function public.admin_adjust_wallet(uuid, integer, text)
  from anon, authenticated;
revoke execute on function public.admin_configure_user(
  uuid,
  boolean,
  boolean,
  boolean,
  text,
  text,
  boolean,
  boolean
) from anon, authenticated;

revoke all on function public.admin_search_users(
  text,
  public.app_role[],
  public.user_account_status[],
  boolean,
  boolean,
  boolean,
  boolean,
  text,
  integer,
  integer
) from public, anon;
grant execute on function public.admin_search_users(
  text,
  public.app_role[],
  public.user_account_status[],
  boolean,
  boolean,
  boolean,
  boolean,
  text,
  integer,
  integer
) to authenticated;

revoke all on function public.admin_get_user_detail(uuid) from public, anon;
grant execute on function public.admin_get_user_detail(uuid) to authenticated;

revoke all on function public.admin_update_user_profile(
  uuid,
  text,
  text,
  text,
  text,
  text
) from public, anon;
grant execute on function public.admin_update_user_profile(
  uuid,
  text,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.admin_configure_user_v2(
  uuid,
  boolean,
  boolean,
  boolean,
  text,
  text,
  boolean,
  boolean,
  text
) from public, anon;
grant execute on function public.admin_configure_user_v2(
  uuid,
  boolean,
  boolean,
  boolean,
  text,
  text,
  boolean,
  boolean,
  text
) to authenticated;

revoke all on function public.admin_adjust_wallet_v2(
  uuid,
  integer,
  text,
  text
) from public, anon;
grant execute on function public.admin_adjust_wallet_v2(
  uuid,
  integer,
  text,
  text
) to authenticated;

revoke all on function public.admin_add_user_note(uuid, text) from public, anon;
grant execute on function public.admin_add_user_note(uuid, text) to authenticated;

revoke all on function public.admin_reschedule_test_meeting(uuid, integer, text)
  from public, anon;
grant execute on function public.admin_reschedule_test_meeting(uuid, integer, text)
  to authenticated;

revoke all on function public.admin_stage_user_control(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  text
) from public, anon, authenticated;
grant execute on function public.admin_stage_user_control(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  text
) to service_role;

revoke all on function public.admin_complete_user_control_sync(
  text,
  boolean,
  timestamptz,
  text
) from public, anon, authenticated;
grant execute on function public.admin_complete_user_control_sync(
  text,
  boolean,
  timestamptz,
  text
) to service_role;

revoke all on function app_private.account_is_active(uuid) from public, anon, authenticated;
revoke all on function app_private.current_user_account_active() from public, anon, authenticated;
revoke all on function app_private.current_user_is_owner() from public, anon, authenticated;
grant execute on function app_private.current_user_account_active() to authenticated;

drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read
on public.profiles
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists user_roles_admin_all on public.user_roles;
drop policy if exists user_roles_admin_read on public.user_roles;
create policy user_roles_admin_read
on public.user_roles
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists wallets_admin_all on public.wallets;
drop policy if exists wallets_admin_read on public.wallets;
create policy wallets_admin_read
on public.wallets
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists credit_transactions_admin_all on public.credit_transactions;
drop policy if exists credit_transactions_admin_read on public.credit_transactions;
create policy credit_transactions_admin_read
on public.credit_transactions
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists test_access_users_admin_all on public.test_access_users;
drop policy if exists test_access_users_admin_read on public.test_access_users;
create policy test_access_users_admin_read
on public.test_access_users
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists tipsters_admin_all on public.tipsters;
drop policy if exists tipsters_admin_read on public.tipsters;
create policy tipsters_admin_read
on public.tipsters
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

revoke insert, update, delete on public.user_roles from authenticated;
revoke insert, update, delete on public.wallets from authenticated;
revoke insert, update, delete on public.credit_transactions from authenticated;
revoke insert, update, delete on public.test_access_users from authenticated;
revoke update on public.tipsters from authenticated;
grant update (display_name, biography, photo_path) on public.tipsters to authenticated;

commit;
