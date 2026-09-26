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
  join auth.users users on users.id = roles.user_id
  where roles.role = 'client'
    and app_private.account_is_active(roles.user_id)
    and users.deleted_at is null
    and users.email_confirmed_at is not null
    and nullif(btrim(coalesce(users.email, '')), '') is not null
    and (users.banned_until is null or users.banned_until <= now())
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
    join auth.users users on users.id = roles.user_id
    where roles.role = 'client'
      and app_private.account_is_active(roles.user_id)
      and users.deleted_at is null
      and users.email_confirmed_at is not null
      and nullif(btrim(coalesce(users.email, '')), '') is not null
      and (users.banned_until is null or users.banned_until <= now())
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
  'Queues deduplicated tip-card announcement emails only for active, confirmed clients with a deliverable address and current explicit marketing consent.';

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
      profiles.phone,
      (
        users.id is not null
        and users.deleted_at is null
        and users.email_confirmed_at is not null
        and nullif(btrim(coalesce(users.email, '')), '') is not null
        and (users.banned_until is null or users.banned_until <= now())
      ) as email_delivery_eligible
    from public.tip_card_entitlements entitlements
    join public.profiles profiles on profiles.id = entitlements.user_id
    left join auth.users users on users.id = entitlements.user_id
    where entitlements.tip_card_id = card_row.id
      and entitlements.revoked_at is null
  loop
    insert into public.notifications (user_id, title, body)
    values (recipient.user_id, event_title, event_body);

    if recipient.email_notifications_enabled
      and recipient.email_delivery_eligible
    then
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

  if target_event_type = 'tip_card_published' then
    for recipient in
      select
        favourites.user_id,
        profiles.email_notifications_enabled,
        (
          users.id is not null
          and users.deleted_at is null
          and users.email_confirmed_at is not null
          and nullif(btrim(coalesce(users.email, '')), '') is not null
          and (users.banned_until is null or users.banned_until <= now())
        ) as email_delivery_eligible
      from public.client_tipster_favourites favourites
      join public.profiles profiles on profiles.id = favourites.user_id
      left join auth.users users on users.id = favourites.user_id
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

      if recipient.email_notifications_enabled
        and recipient.email_delivery_eligible
      then
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
from public, anon, authenticated, service_role;

comment on function app_private.queue_tip_card_notifications(uuid, integer, text) is
  'Queues in-app, SMS, and confirmed-recipient email notifications for entitled clients and favourite-tipster followers.';
