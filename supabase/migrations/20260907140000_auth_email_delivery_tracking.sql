alter table public.auth_user_diagnostic_events
drop constraint if exists auth_user_diagnostic_events_event_type_check;

alter table public.auth_user_diagnostic_events
add constraint auth_user_diagnostic_events_event_type_check
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
    'account_restored',
    'email_provider_accepted',
    'email_provider_sent',
    'email_provider_delivered',
    'email_provider_delivery_delayed',
    'email_provider_bounced',
    'email_provider_complained',
    'email_provider_suppressed',
    'email_provider_failed'
  )
);

alter table public.auth_user_diagnostic_events
drop constraint if exists auth_user_diagnostic_events_source_check;

alter table public.auth_user_diagnostic_events
add constraint auth_user_diagnostic_events_source_check
check (
  source in (
    'auth_trigger',
    'auth_snapshot_backfill',
    'auth_email_hook',
    'email_provider_webhook'
  )
);

create table if not exists public.auth_email_messages (
  id uuid primary key default gen_random_uuid(),
  request_fingerprint text not null unique
    check (char_length(request_fingerprint) between 32 and 128),
  provider text not null default 'resend'
    check (char_length(provider) between 2 and 40),
  provider_message_id text unique,
  user_id uuid references auth.users(id) on delete set null,
  recipient_email text not null
    check (char_length(recipient_email) between 3 and 320),
  email_action_type text not null
    check (char_length(email_action_type) between 2 and 80),
  action_variant text not null default 'primary'
    check (char_length(action_variant) between 2 and 80),
  subject text not null
    check (char_length(subject) between 1 and 300),
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'accepted',
        'sent',
        'delivery_delayed',
        'delivered',
        'bounced',
        'complained',
        'suppressed',
        'failed'
      )
    ),
  attempt_count integer not null default 1
    check (attempt_count between 1 and 20),
  accepted_at timestamptz,
  latest_event_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  suppressed_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_email_messages_user_created_idx
on public.auth_email_messages (user_id, created_at desc);

create index if not exists auth_email_messages_status_created_idx
on public.auth_email_messages (status, created_at desc);

create table if not exists public.auth_email_delivery_events (
  provider_event_id text primary key
    check (char_length(provider_event_id) between 8 and 240),
  message_id uuid references public.auth_email_messages(id) on delete cascade,
  provider text not null default 'resend'
    check (char_length(provider) between 2 and 40),
  provider_email_id text not null
    check (char_length(provider_email_id) between 8 and 240),
  event_type text not null
    check (char_length(event_type) between 3 and 100),
  event_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_email_delivery_events_message_event_idx
on public.auth_email_delivery_events (message_id, event_at desc);

create index if not exists auth_email_delivery_events_provider_email_idx
on public.auth_email_delivery_events (provider_email_id, event_at desc);

create or replace function app_private.reject_auth_email_delivery_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Authentication email delivery events are immutable.';
end;
$$;

drop trigger if exists reject_auth_email_delivery_event_changes
on public.auth_email_delivery_events;
create trigger reject_auth_email_delivery_event_changes
before update or delete on public.auth_email_delivery_events
for each row execute function app_private.reject_auth_email_delivery_event_changes();

alter table public.auth_email_messages enable row level security;
alter table public.auth_email_delivery_events enable row level security;

revoke all on public.auth_email_messages from public, anon, authenticated;
revoke all on public.auth_email_delivery_events from public, anon, authenticated;
grant select, insert, update on public.auth_email_messages to service_role;
grant select, insert on public.auth_email_delivery_events to service_role;
grant insert on public.auth_user_diagnostic_events to service_role;

create or replace function app_private.auth_email_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'pending' then 0
    when 'accepted' then 10
    when 'sent' then 20
    when 'delivery_delayed' then 30
    when 'delivered' then 40
    when 'failed' then 50
    when 'bounced' then 60
    when 'suppressed' then 70
    when 'complained' then 80
    else -1
  end;
$$;

create or replace function public.record_auth_email_provider_event(
  p_provider_event_id text,
  p_provider_email_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_message public.auth_email_messages%rowtype;
  incoming_status text;
  diagnostic_event_type text;
  inserted_count integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role access required.';
  end if;

  if nullif(btrim(coalesce(p_provider_event_id, '')), '') is null
    or nullif(btrim(coalesce(p_provider_email_id, '')), '') is null
    or nullif(btrim(coalesce(p_event_type, '')), '') is null
    or p_event_at is null
  then
    raise exception 'Complete provider event details are required.';
  end if;

  select messages.*
  into target_message
  from public.auth_email_messages messages
  where messages.provider_message_id = p_provider_email_id;

  insert into public.auth_email_delivery_events (
    provider_event_id,
    message_id,
    provider,
    provider_email_id,
    event_type,
    event_at,
    details
  )
  values (
    p_provider_event_id,
    target_message.id,
    coalesce(target_message.provider, 'resend'),
    p_provider_email_id,
    p_event_type,
    p_event_at,
    coalesce(p_details, '{}'::jsonb)
  )
  on conflict (provider_event_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return jsonb_build_object('recorded', true, 'duplicate', true);
  end if;

  incoming_status := case p_event_type
    when 'email.sent' then 'sent'
    when 'email.delivery_delayed' then 'delivery_delayed'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.suppressed' then 'suppressed'
    when 'email.failed' then 'failed'
    else null
  end;

  diagnostic_event_type := case p_event_type
    when 'email.sent' then 'email_provider_sent'
    when 'email.delivery_delayed' then 'email_provider_delivery_delayed'
    when 'email.delivered' then 'email_provider_delivered'
    when 'email.bounced' then 'email_provider_bounced'
    when 'email.complained' then 'email_provider_complained'
    when 'email.suppressed' then 'email_provider_suppressed'
    when 'email.failed' then 'email_provider_failed'
    else null
  end;

  if target_message.id is not null and incoming_status is not null then
    update public.auth_email_messages messages
    set
      status = case
        when app_private.auth_email_status_rank(incoming_status) >
          app_private.auth_email_status_rank(messages.status)
          or (
            app_private.auth_email_status_rank(incoming_status) =
              app_private.auth_email_status_rank(messages.status)
            and p_event_at >= coalesce(messages.latest_event_at, p_event_at)
          )
        then incoming_status
        else messages.status
      end,
      latest_event_at = greatest(coalesce(messages.latest_event_at, p_event_at), p_event_at),
      delivered_at = case
        when p_event_type = 'email.delivered'
        then coalesce(messages.delivered_at, p_event_at)
        else messages.delivered_at
      end,
      bounced_at = case
        when p_event_type = 'email.bounced'
        then coalesce(messages.bounced_at, p_event_at)
        else messages.bounced_at
      end,
      complained_at = case
        when p_event_type = 'email.complained'
        then coalesce(messages.complained_at, p_event_at)
        else messages.complained_at
      end,
      suppressed_at = case
        when p_event_type = 'email.suppressed'
        then coalesce(messages.suppressed_at, p_event_at)
        else messages.suppressed_at
      end,
      failed_at = case
        when p_event_type = 'email.failed'
        then coalesce(messages.failed_at, p_event_at)
        else messages.failed_at
      end,
      last_error_code = case
        when incoming_status in ('bounced', 'complained', 'suppressed', 'failed')
        then p_event_type
        when incoming_status = 'delivered' then null
        else messages.last_error_code
      end,
      last_error_message = case
        when incoming_status in ('bounced', 'complained', 'suppressed', 'failed')
        then nullif(left(coalesce(p_details #>> '{bounce,message}', p_event_type), 500), '')
        when incoming_status = 'delivered' then null
        else messages.last_error_message
      end,
      updated_at = now()
    where messages.id = target_message.id;
  end if;

  if target_message.user_id is not null and diagnostic_event_type is not null then
    insert into public.auth_user_diagnostic_events (
      user_id,
      email,
      event_type,
      source,
      event_at,
      details
    )
    values (
      target_message.user_id,
      target_message.recipient_email,
      diagnostic_event_type,
      'email_provider_webhook',
      p_event_at,
      jsonb_build_object(
        'provider', target_message.provider,
        'providerMessageId', p_provider_email_id,
        'providerEventId', p_provider_event_id,
        'emailActionType', target_message.email_action_type,
        'actionVariant', target_message.action_variant,
        'providerDetails', coalesce(p_details, '{}'::jsonb)
      )
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'recorded', true,
    'duplicate', false,
    'matchedMessage', target_message.id is not null,
    'messageId', target_message.id,
    'userId', target_message.user_id
  );
end;
$$;

create or replace function public.admin_list_auth_email_delivery_summary(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  result jsonb;
begin
  if not app_private.current_user_account_active()
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with latest_per_user as (
    select distinct on (messages.user_id)
      messages.user_id,
      messages.provider,
      messages.provider_message_id,
      messages.status,
      messages.email_action_type,
      messages.accepted_at,
      messages.latest_event_at,
      messages.delivered_at,
      messages.bounced_at,
      messages.complained_at,
      messages.suppressed_at,
      messages.failed_at,
      messages.last_error_code,
      messages.last_error_message,
      messages.created_at
    from public.auth_email_messages messages
    where messages.user_id is not null
      and messages.email_action_type = 'signup'
    order by messages.user_id, messages.created_at desc
  ), page as (
    select *
    from latest_per_user
    order by created_at desc
    limit requested_limit
  )
  select jsonb_build_object(
    'items',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'userId', page.user_id,
          'provider', page.provider,
          'providerMessageId', page.provider_message_id,
          'status', page.status,
          'emailActionType', page.email_action_type,
          'acceptedAt', page.accepted_at,
          'latestEventAt', page.latest_event_at,
          'deliveredAt', page.delivered_at,
          'bouncedAt', page.bounced_at,
          'complainedAt', page.complained_at,
          'suppressedAt', page.suppressed_at,
          'failedAt', page.failed_at,
          'lastErrorCode', page.last_error_code,
          'lastErrorMessage', page.last_error_message
        )
        order by page.created_at desc
      ),
      '[]'::jsonb
    )
  )
  into result
  from page;

  return coalesce(result, jsonb_build_object('items', '[]'::jsonb));
end;
$$;

create or replace function public.admin_get_user_email_delivery(
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

  if not exists (select 1 from auth.users users where users.id = p_user_id) then
    raise exception 'User not found.';
  end if;

  select jsonb_build_object(
    'providerTracked', exists (
      select 1
      from public.auth_email_messages messages
      where messages.user_id = p_user_id
    ),
    'latestSignup',
    (
      select jsonb_build_object(
        'provider', messages.provider,
        'providerMessageId', messages.provider_message_id,
        'status', messages.status,
        'acceptedAt', messages.accepted_at,
        'latestEventAt', messages.latest_event_at,
        'deliveredAt', messages.delivered_at,
        'bouncedAt', messages.bounced_at,
        'complainedAt', messages.complained_at,
        'suppressedAt', messages.suppressed_at,
        'failedAt', messages.failed_at,
        'lastErrorCode', messages.last_error_code,
        'lastErrorMessage', messages.last_error_message
      )
      from public.auth_email_messages messages
      where messages.user_id = p_user_id
        and messages.email_action_type = 'signup'
      order by messages.created_at desc
      limit 1
    ),
    'messages',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', messages.id,
            'provider', messages.provider,
            'providerMessageId', messages.provider_message_id,
            'recipientEmail', messages.recipient_email,
            'emailActionType', messages.email_action_type,
            'actionVariant', messages.action_variant,
            'subject', messages.subject,
            'status', messages.status,
            'attemptCount', messages.attempt_count,
            'acceptedAt', messages.accepted_at,
            'latestEventAt', messages.latest_event_at,
            'deliveredAt', messages.delivered_at,
            'bouncedAt', messages.bounced_at,
            'complainedAt', messages.complained_at,
            'suppressedAt', messages.suppressed_at,
            'failedAt', messages.failed_at,
            'lastErrorCode', messages.last_error_code,
            'lastErrorMessage', messages.last_error_message,
            'createdAt', messages.created_at
          )
          order by messages.created_at desc
        )
        from (
          select *
          from public.auth_email_messages
          where user_id = p_user_id
          order by created_at desc
          limit 50
        ) messages
      ),
      '[]'::jsonb
    ),
    'events',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'providerEventId', events.provider_event_id,
            'messageId', events.message_id,
            'provider', events.provider,
            'providerEmailId', events.provider_email_id,
            'eventType', events.event_type,
            'eventAt', events.event_at,
            'details', events.details
          )
          order by events.event_at desc
        )
        from (
          select delivery_events.*
          from public.auth_email_delivery_events delivery_events
          join public.auth_email_messages messages
            on messages.id = delivery_events.message_id
          where messages.user_id = p_user_id
          order by delivery_events.event_at desc
          limit 100
        ) events
      ),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function app_private.reject_auth_email_delivery_event_changes()
from public, anon, authenticated;
revoke all on function app_private.auth_email_status_rank(text)
from public, anon, authenticated;

revoke all on function public.record_auth_email_provider_event(text, text, text, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function public.record_auth_email_provider_event(text, text, text, timestamptz, jsonb)
to service_role;

revoke all on function public.admin_list_auth_email_delivery_summary(integer)
from public, anon;
grant execute on function public.admin_list_auth_email_delivery_summary(integer)
to authenticated;

revoke all on function public.admin_get_user_email_delivery(uuid)
from public, anon;
grant execute on function public.admin_get_user_email_delivery(uuid)
to authenticated;

comment on table public.auth_email_messages is
  'Server-only audit records for Supabase Auth emails submitted to a tracked provider.';
comment on table public.auth_email_delivery_events is
  'Immutable signed provider webhook events for Auth email delivery, delay, bounce, suppression, and complaints.';
comment on function public.record_auth_email_provider_event(text, text, text, timestamptz, jsonb) is
  'Service-role-only idempotent recorder for signed Auth email provider webhooks.';
