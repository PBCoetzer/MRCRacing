create table if not exists public.auth_user_diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  event_type text not null
    check (
      event_type in (
        'registration_created',
        'invitation_created',
        'confirmation_dispatched',
        'email_confirmed',
        'password_recovery_dispatched',
        'email_change_dispatched',
        'reauthentication_dispatched',
        'signed_in',
        'email_changed',
        'account_deleted',
        'account_restored'
      )
    ),
  source text not null
    check (source in ('auth_trigger', 'auth_snapshot_backfill')),
  event_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists auth_user_diagnostic_events_dedupe_idx
on public.auth_user_diagnostic_events (user_id, event_type, event_at, source);

create index if not exists auth_user_diagnostic_events_user_event_idx
on public.auth_user_diagnostic_events (user_id, event_at desc);

create or replace function app_private.reject_auth_user_diagnostic_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Authentication diagnostic events are immutable.';
end;
$$;

drop trigger if exists reject_auth_user_diagnostic_event_changes
on public.auth_user_diagnostic_events;
create trigger reject_auth_user_diagnostic_event_changes
before update or delete on public.auth_user_diagnostic_events
for each row execute function app_private.reject_auth_user_diagnostic_event_changes();

create or replace function app_private.capture_auth_user_diagnostic_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.auth_user_diagnostic_events (
      user_id,
      email,
      event_type,
      source,
      event_at,
      details
    )
    values (
      new.id,
      new.email,
      'registration_created',
      'auth_trigger',
      new.created_at,
      jsonb_build_object(
        'audience', new.aud,
        'authRole', new.role,
        'provider', new.raw_app_meta_data ->> 'provider',
        'providers', coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb),
        'isSsoUser', coalesce(new.is_sso_user, false),
        'isAnonymous', coalesce(new.is_anonymous, false)
      )
    )
    on conflict do nothing;

    if new.invited_at is not null then
      insert into public.auth_user_diagnostic_events (
        user_id, email, event_type, source, event_at, details
      )
      values (
        new.id,
        new.email,
        'invitation_created',
        'auth_trigger',
        new.invited_at,
        jsonb_build_object('email', new.email)
      )
      on conflict do nothing;
    end if;

    if new.confirmation_sent_at is not null then
      insert into public.auth_user_diagnostic_events (
        user_id, email, event_type, source, event_at, details
      )
      values (
        new.id,
        new.email,
        'confirmation_dispatched',
        'auth_trigger',
        new.confirmation_sent_at,
        jsonb_build_object(
          'email', new.email,
          'deliveryEvidence', 'supabase_dispatch_timestamp'
        )
      )
      on conflict do nothing;
    end if;

    if new.email_confirmed_at is not null then
      insert into public.auth_user_diagnostic_events (
        user_id, email, event_type, source, event_at, details
      )
      values (
        new.id,
        new.email,
        'email_confirmed',
        'auth_trigger',
        new.email_confirmed_at,
        jsonb_build_object('email', new.email)
      )
      on conflict do nothing;
    end if;

    if new.last_sign_in_at is not null then
      insert into public.auth_user_diagnostic_events (
        user_id, email, event_type, source, event_at, details
      )
      values (
        new.id,
        new.email,
        'signed_in',
        'auth_trigger',
        new.last_sign_in_at,
        jsonb_build_object('email', new.email)
      )
      on conflict do nothing;
    end if;

    return new;
  end if;

  if new.email is distinct from old.email then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'email_changed',
      'auth_trigger',
      coalesce(new.updated_at, now()),
      jsonb_build_object('previousEmail', old.email, 'email', new.email)
    )
    on conflict do nothing;
  end if;

  if new.confirmation_sent_at is distinct from old.confirmation_sent_at
    and new.confirmation_sent_at is not null
  then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'confirmation_dispatched',
      'auth_trigger',
      new.confirmation_sent_at,
      jsonb_build_object(
        'email', new.email,
        'deliveryEvidence', 'supabase_dispatch_timestamp'
      )
    )
    on conflict do nothing;
  end if;

  if new.email_confirmed_at is distinct from old.email_confirmed_at
    and new.email_confirmed_at is not null
  then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'email_confirmed',
      'auth_trigger',
      new.email_confirmed_at,
      jsonb_build_object('email', new.email)
    )
    on conflict do nothing;
  end if;

  if new.recovery_sent_at is distinct from old.recovery_sent_at
    and new.recovery_sent_at is not null
  then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'password_recovery_dispatched',
      'auth_trigger',
      new.recovery_sent_at,
      jsonb_build_object('email', new.email)
    )
    on conflict do nothing;
  end if;

  if new.email_change_sent_at is distinct from old.email_change_sent_at
    and new.email_change_sent_at is not null
  then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'email_change_dispatched',
      'auth_trigger',
      new.email_change_sent_at,
      jsonb_build_object(
        'currentEmail', new.email,
        'requestedEmail', nullif(new.email_change, '')
      )
    )
    on conflict do nothing;
  end if;

  if new.reauthentication_sent_at is distinct from old.reauthentication_sent_at
    and new.reauthentication_sent_at is not null
  then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'reauthentication_dispatched',
      'auth_trigger',
      new.reauthentication_sent_at,
      jsonb_build_object('email', new.email)
    )
    on conflict do nothing;
  end if;

  if new.last_sign_in_at is distinct from old.last_sign_in_at
    and new.last_sign_in_at is not null
  then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      'signed_in',
      'auth_trigger',
      new.last_sign_in_at,
      jsonb_build_object('email', new.email)
    )
    on conflict do nothing;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    insert into public.auth_user_diagnostic_events (
      user_id, email, event_type, source, event_at, details
    )
    values (
      new.id,
      new.email,
      case when new.deleted_at is null then 'account_restored' else 'account_deleted' end,
      'auth_trigger',
      coalesce(new.deleted_at, new.updated_at, now()),
      jsonb_build_object('email', new.email)
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists capture_mrc_auth_user_diagnostics on auth.users;
create trigger capture_mrc_auth_user_diagnostics
after insert or update on auth.users
for each row execute function app_private.capture_auth_user_diagnostic_events();

insert into public.auth_user_diagnostic_events (
  user_id,
  email,
  event_type,
  source,
  event_at,
  details
)
select
  users.id,
  users.email,
  'registration_created',
  'auth_snapshot_backfill',
  users.created_at,
  jsonb_build_object(
    'audience', users.aud,
    'authRole', users.role,
    'provider', users.raw_app_meta_data ->> 'provider',
    'providers', coalesce(users.raw_app_meta_data -> 'providers', '[]'::jsonb),
    'isSsoUser', coalesce(users.is_sso_user, false),
    'isAnonymous', coalesce(users.is_anonymous, false)
  )
from auth.users users
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'invitation_created',
  'auth_snapshot_backfill',
  users.invited_at,
  jsonb_build_object('email', users.email)
from auth.users users
where users.invited_at is not null
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'confirmation_dispatched',
  'auth_snapshot_backfill',
  users.confirmation_sent_at,
  jsonb_build_object(
    'email', users.email,
    'deliveryEvidence', 'supabase_dispatch_timestamp'
  )
from auth.users users
where users.confirmation_sent_at is not null
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'email_confirmed',
  'auth_snapshot_backfill',
  users.email_confirmed_at,
  jsonb_build_object('email', users.email)
from auth.users users
where users.email_confirmed_at is not null
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'password_recovery_dispatched',
  'auth_snapshot_backfill',
  users.recovery_sent_at,
  jsonb_build_object('email', users.email)
from auth.users users
where users.recovery_sent_at is not null
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'email_change_dispatched',
  'auth_snapshot_backfill',
  users.email_change_sent_at,
  jsonb_build_object(
    'currentEmail', users.email,
    'requestedEmail', nullif(users.email_change, '')
  )
from auth.users users
where users.email_change_sent_at is not null
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'reauthentication_dispatched',
  'auth_snapshot_backfill',
  users.reauthentication_sent_at,
  jsonb_build_object('email', users.email)
from auth.users users
where users.reauthentication_sent_at is not null
on conflict do nothing;

insert into public.auth_user_diagnostic_events (
  user_id, email, event_type, source, event_at, details
)
select
  users.id,
  users.email,
  'signed_in',
  'auth_snapshot_backfill',
  users.last_sign_in_at,
  jsonb_build_object('email', users.email)
from auth.users users
where users.last_sign_in_at is not null
on conflict do nothing;

alter table public.auth_user_diagnostic_events enable row level security;

drop policy if exists auth_user_diagnostic_events_admin_read
on public.auth_user_diagnostic_events;
create policy auth_user_diagnostic_events_admin_read
on public.auth_user_diagnostic_events
for select
to authenticated
using (
  (select app_private.current_user_account_active())
  and (select app_private.current_user_has_role('administrator'))
);

revoke all on public.auth_user_diagnostic_events
from public, anon, authenticated;
grant select on public.auth_user_diagnostic_events
to authenticated;

revoke all on function app_private.reject_auth_user_diagnostic_event_changes()
from public, anon, authenticated;
revoke all on function app_private.capture_auth_user_diagnostic_events()
from public, anon, authenticated;

create or replace function public.admin_list_registration_diagnostics(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  requested_offset integer := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  if not app_private.current_user_account_active()
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'userId', page.user_id,
            'email', page.email,
            'displayName', page.display_name,
            'phone', page.phone,
            'createdAt', page.created_at,
            'confirmationSentAt', page.confirmation_sent_at,
            'emailConfirmedAt', page.email_confirmed_at,
            'lastSignInAt', page.last_sign_in_at,
            'confirmedOver18At', page.confirmed_over_18_at,
            'acceptedTermsAt', page.accepted_terms_at,
            'acceptedTermsVersion', page.accepted_terms_version,
            'providers',
            coalesce(
              (
                select jsonb_agg(provider_rows.provider order by provider_rows.provider)
                from (
                  select distinct identities.provider
                  from auth.identities identities
                  where identities.user_id = page.user_id
                ) provider_rows
              ),
              '[]'::jsonb
            ),
            'deliveryState',
            case
              when page.email_confirmed_at is not null
                and exists (
                  select 1
                  from public.admin_email_confirmation_actions actions
                  where actions.user_id = page.user_id
                    and actions.action = 'verify_email'
                    and actions.status = 'succeeded'
                )
              then 'manually_verified'
              when page.email_confirmed_at is not null then 'confirmed'
              when page.confirmation_sent_at is not null then 'dispatched_unverified'
              else 'not_dispatched'
            end,
            'latestAdminEmailActionAt',
            (
              select max(coalesce(actions.completed_at, actions.created_at))
              from public.admin_email_confirmation_actions actions
              where actions.user_id = page.user_id
            )
          )
          order by page.created_at desc
        )
        from (
          select
            users.id as user_id,
            users.email,
            coalesce(
              profiles.display_name,
              nullif(btrim(concat_ws(' ', profiles.first_name, profiles.last_name)), '')
            ) as display_name,
            coalesce(profiles.phone, users.phone) as phone,
            users.created_at,
            users.confirmation_sent_at,
            users.email_confirmed_at,
            users.last_sign_in_at,
            profiles.confirmed_over_18_at,
            profiles.accepted_terms_at,
            profiles.accepted_terms_version
          from auth.users users
          left join public.profiles profiles on profiles.id = users.id
          order by users.created_at desc
          limit requested_limit
          offset requested_offset
        ) page
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from auth.users),
    'limit', requested_limit,
    'offset', requested_offset
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_get_user_registration_diagnostics(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not app_private.current_user_account_active()
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  select jsonb_build_object(
    'auth',
    jsonb_build_object(
      'userId', users.id,
      'email', users.email,
      'phone', users.phone,
      'audience', users.aud,
      'authRole', users.role,
      'createdAt', users.created_at,
      'updatedAt', users.updated_at,
      'invitedAt', users.invited_at,
      'confirmationSentAt', users.confirmation_sent_at,
      'emailConfirmedAt', users.email_confirmed_at,
      'recoverySentAt', users.recovery_sent_at,
      'emailChangeSentAt', users.email_change_sent_at,
      'emailChangePending', nullif(users.email_change, ''),
      'reauthenticationSentAt', users.reauthentication_sent_at,
      'phoneConfirmedAt', users.phone_confirmed_at,
      'lastSignInAt', users.last_sign_in_at,
      'bannedUntil', users.banned_until,
      'deletedAt', users.deleted_at,
      'isSsoUser', coalesce(users.is_sso_user, false),
      'isAnonymous', coalesce(users.is_anonymous, false)
    ),
    'profile',
    jsonb_build_object(
      'firstName', profiles.first_name,
      'lastName', profiles.last_name,
      'displayName', profiles.display_name,
      'phone', profiles.phone,
      'createdAt', profiles.created_at,
      'updatedAt', profiles.updated_at,
      'acceptedTermsAt', profiles.accepted_terms_at,
      'acceptedTermsVersion', profiles.accepted_terms_version,
      'confirmedOver18At', profiles.confirmed_over_18_at,
      'emailNotificationsEnabled', profiles.email_notifications_enabled
    ),
    'providers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', identities.id,
            'provider', identities.provider,
            'email', identities.email,
            'createdAt', identities.created_at,
            'updatedAt', identities.updated_at,
            'lastSignInAt', identities.last_sign_in_at
          )
          order by identities.created_at
        )
        from auth.identities identities
        where identities.user_id = users.id
      ),
      '[]'::jsonb
    ),
    'delivery',
    jsonb_build_object(
      'state',
      case
        when users.email_confirmed_at is not null
          and exists (
            select 1
            from public.admin_email_confirmation_actions actions
            where actions.user_id = users.id
              and actions.action = 'verify_email'
              and actions.status = 'succeeded'
          )
        then 'manually_verified'
        when users.email_confirmed_at is not null then 'confirmed'
        when users.confirmation_sent_at is not null then 'dispatched_unverified'
        else 'not_dispatched'
      end,
      'providerDeliveryTracked', false,
      'providerDeliveryStatus', null,
      'note',
      case
        when users.email_confirmed_at is not null then
          'The email address is confirmed. Review the administrator timeline to distinguish link confirmation from manual verification.'
        when users.confirmation_sent_at is not null then
          'Supabase recorded a confirmation dispatch request. The current Xneelo SMTP integration does not return per-message inbox delivery or bounce webhooks to MRC.'
        else
          'Supabase has no confirmation dispatch timestamp for this account.'
      end
    ),
    'events',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', events.id,
            'eventType', events.event_type,
            'source', events.source,
            'email', events.email,
            'eventAt', events.event_at,
            'details', events.details
          )
          order by events.event_at desc
        )
        from (
          select *
          from public.auth_user_diagnostic_events
          where user_id = users.id
          order by event_at desc
          limit 100
        ) events
      ),
      '[]'::jsonb
    ),
    'confirmationActions',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', actions.id,
            'requestId', actions.request_id,
            'action', actions.action,
            'reason', actions.reason,
            'status', actions.status,
            'sanitizedError', actions.sanitized_error,
            'createdAt', actions.created_at,
            'completedAt', actions.completed_at,
            'actorId', actions.actor_id,
            'actorName', coalesce(
              actor_profiles.display_name,
              nullif(
                btrim(concat_ws(' ', actor_profiles.first_name, actor_profiles.last_name)),
                ''
              ),
              actor_users.email
            ),
            'actorEmail', actor_users.email
          )
          order by actions.created_at desc
        )
        from public.admin_email_confirmation_actions actions
        left join public.profiles actor_profiles on actor_profiles.id = actions.actor_id
        left join auth.users actor_users on actor_users.id = actions.actor_id
        where actions.user_id = users.id
      ),
      '[]'::jsonb
    )
  )
  into result
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id
  where users.id = p_user_id;

  if result is null then
    raise exception 'User not found.';
  end if;

  return result;
end;
$$;

revoke all on function public.admin_list_registration_diagnostics(integer, integer)
from public, anon;
grant execute on function public.admin_list_registration_diagnostics(integer, integer)
to authenticated;

revoke all on function public.admin_get_user_registration_diagnostics(uuid)
from public, anon;
grant execute on function public.admin_get_user_registration_diagnostics(uuid)
to authenticated;

comment on table public.auth_user_diagnostic_events is
  'Immutable administrator-only timeline of non-secret Supabase Auth account events and historical Auth timestamps.';

comment on function public.admin_list_registration_diagnostics(integer, integer) is
  'Lists recent account registration and confirmation diagnostics for active administrators.';

comment on function public.admin_get_user_registration_diagnostics(uuid) is
  'Returns non-secret Auth, profile, provider, dispatch, confirmation, and immutable event diagnostics for one user.';
