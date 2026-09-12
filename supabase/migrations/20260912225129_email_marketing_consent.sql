alter table public.profiles
  add column if not exists email_marketing_consented_at timestamptz,
  add column if not exists email_marketing_withdrawn_at timestamptz;

comment on column public.profiles.email_marketing_consented_at is
  'Latest explicit consent to receive optional promotional email announcements.';

comment on column public.profiles.email_marketing_withdrawn_at is
  'Latest withdrawal of optional promotional email consent. Transactional account email preferences are separate.';

create or replace function public.set_email_marketing_consent(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_at timestamptz := clock_timestamp();
begin
  if p_enabled is null then
    raise exception 'A consent choice is required.';
  end if;

  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is not active.';
  end if;

  update public.profiles
  set
    email_marketing_consented_at = case
      when p_enabled then changed_at
      else email_marketing_consented_at
    end,
    email_marketing_withdrawn_at = case
      when p_enabled then null
      else changed_at
    end
  where id = current_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    case
      when p_enabled then 'email_marketing_consent_granted'
      else 'email_marketing_consent_withdrawn'
    end,
    'profile',
    current_user_id,
    jsonb_build_object(
      'enabled', p_enabled,
      'changedAt', changed_at,
      'source', 'client_dashboard'
    )
  );

  return jsonb_build_object(
    'enabled', p_enabled,
    'changedAt', changed_at
  );
end;
$$;

revoke all on function public.set_email_marketing_consent(boolean)
from public, anon, authenticated, service_role;
grant execute on function public.set_email_marketing_consent(boolean)
to authenticated;

comment on function public.set_email_marketing_consent(boolean) is
  'Records or withdraws the authenticated active user''s explicit consent for optional promotional email announcements.';

create or replace function app_private.queue_tip_card_all_client_emails(
  target_tip_card_id uuid,
  target_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
  recipient record;
  eligible_client_count integer := 0;
  newly_queued_count integer := 0;
  tipster_url text;
begin
  select
    cards.id,
    cards.title,
    cards.revision,
    cards.status,
    tipsters.display_name as tipster_name,
    tipsters.slug as tipster_slug,
    meetings.venue,
    meetings.meeting_date
  into card_row
  from public.tip_cards cards
  join public.tipsters tipsters on tipsters.id = cards.tipster_id
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.id = target_tip_card_id;

  if card_row.id is null
    or card_row.status <> 'published'
    or card_row.revision <> target_revision
  then
    raise exception 'Published tip card revision not found.';
  end if;

  select count(distinct roles.user_id)::integer
  into eligible_client_count
  from public.user_roles roles
  join public.profiles profiles on profiles.id = roles.user_id
  where roles.role = 'client'
    and app_private.account_is_active(roles.user_id)
    and profiles.email_notifications_enabled = true
    and profiles.email_marketing_consented_at is not null
    and (
      profiles.email_marketing_withdrawn_at is null
      or profiles.email_marketing_withdrawn_at < profiles.email_marketing_consented_at
    );

  tipster_url := 'https://www.mrcracing.co.za/tipsters/' || card_row.tipster_slug || '/';

  for recipient in
    select distinct roles.user_id
    from public.user_roles roles
    join public.profiles profiles on profiles.id = roles.user_id
    where roles.role = 'client'
      and app_private.account_is_active(roles.user_id)
      and profiles.email_notifications_enabled = true
      and profiles.email_marketing_consented_at is not null
      and (
        profiles.email_marketing_withdrawn_at is null
        or profiles.email_marketing_withdrawn_at < profiles.email_marketing_consented_at
      )
      and not exists (
        select 1
        from public.notification_outbox outbox
        where outbox.user_id = roles.user_id
          and outbox.channel = 'email'
          and outbox.payload ->> 'tipCardId' = card_row.id::text
          and outbox.payload ->> 'revision' = target_revision::text
      )
  loop
    perform app_private.enqueue_notification(
      recipient.user_id,
      'tip_card_published_all_clients',
      'tip-card-announcement:' || card_row.id::text ||
        ':revision:' || target_revision::text ||
        ':user:' || recipient.user_id::text || ':email',
      jsonb_build_object(
        'template', 'tip_card_published_all_clients',
        'notificationAudience', 'marketing_consented_clients',
        'tipCardId', card_row.id,
        'revision', target_revision,
        'tipsterName', card_row.tipster_name,
        'meetingVenue', card_row.venue,
        'meetingDate', card_row.meeting_date,
        'cardTitle', card_row.title,
        'tipsterUrl', tipster_url
      )
    );

    newly_queued_count := newly_queued_count + 1;
  end loop;

  return jsonb_build_object(
    'eligibleClientCount', eligible_client_count,
    'newlyQueuedCount', newly_queued_count,
    'alreadyQueuedCount', eligible_client_count - newly_queued_count
  );
end;
$$;

revoke all on function app_private.queue_tip_card_all_client_emails(uuid, integer)
from public, anon, authenticated, service_role;

comment on function app_private.queue_tip_card_all_client_emails(uuid, integer) is
  'Queues deduplicated tip-card announcement emails only for active clients with current explicit marketing consent.';

create or replace function public.publish_tip_card_v3(
  p_card_id uuid,
  p_expected_revision integer,
  p_notify_all_clients boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  published_card jsonb;
  notification_summary jsonb := jsonb_build_object(
    'eligibleClientCount', 0,
    'newlyQueuedCount', 0,
    'alreadyQueuedCount', 0
  );
  published_revision integer;
begin
  published_card := public.publish_tip_card_v2(
    p_card_id,
    p_expected_revision
  );
  published_revision := (published_card ->> 'revision')::integer;

  if coalesce(p_notify_all_clients, false) then
    notification_summary := app_private.queue_tip_card_all_client_emails(
      p_card_id,
      published_revision
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
      'tip_card_all_clients_notification_queued',
      'tip_card',
      p_card_id,
      jsonb_build_object(
        'revision', published_revision,
        'audience', 'active_clients_with_current_email_marketing_consent',
        'deliveryChannel', 'email',
        'queueSummary', notification_summary
      )
    );
  end if;

  return published_card || jsonb_build_object(
    'notifyAllClients', coalesce(p_notify_all_clients, false),
    'notificationAudienceCount',
      (notification_summary ->> 'eligibleClientCount')::integer,
    'notificationNewlyQueuedCount',
      (notification_summary ->> 'newlyQueuedCount')::integer
  );
end;
$$;

revoke all on function public.publish_tip_card_v3(uuid, integer, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.publish_tip_card_v3(uuid, integer, boolean)
to authenticated;

comment on function public.publish_tip_card_v3(uuid, integer, boolean) is
  'Publishes a meeting card and optionally queues one deduplicated announcement email for each active client with current explicit marketing consent.';
