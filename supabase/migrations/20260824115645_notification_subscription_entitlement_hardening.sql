-- Deduplicate every delivery channel by logical incident, keep in-app alerts
-- idempotent, and make active tipster subscriptions self-healing for cards.

alter table public.notification_outbox
  add column if not exists incident_key text;

update public.notification_outbox
set incident_key = dedupe_key
where incident_key is null;

alter table public.notification_outbox
  alter column incident_key set not null;

create unique index if not exists notification_outbox_incident_channel_uidx
on public.notification_outbox (user_id, event_type, channel, incident_key);

alter table public.notifications
  add column if not exists event_type text,
  add column if not exists incident_key text;

create unique index if not exists notifications_user_incident_uidx
on public.notifications (user_id, event_type, incident_key)
where incident_key is not null;

create or replace function app_private.enqueue_channel_notification(
  target_user_id uuid,
  target_event_type text,
  target_channel text,
  target_incident_key text,
  target_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_id uuid;
  normalized_incident_key text := nullif(btrim(coalesce(target_incident_key, '')), '');
  delivery_key text;
begin
  if target_user_id is null then
    raise exception 'A notification recipient is required.';
  end if;
  if nullif(btrim(coalesce(target_event_type, '')), '') is null then
    raise exception 'A notification event type is required.';
  end if;
  if target_channel not in ('email', 'sms', 'browser', 'whatsapp', 'telegram') then
    raise exception 'Unsupported notification channel.';
  end if;
  if normalized_incident_key is null or char_length(normalized_incident_key) > 500 then
    raise exception 'A valid notification incident key is required.';
  end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'Notification payload must be a JSON object.';
  end if;

  delivery_key := target_event_type || ':incident:' || md5(normalized_incident_key) ||
    ':user:' || target_user_id::text || ':' || target_channel;

  insert into public.notification_outbox (
    user_id, event_type, channel, incident_key, dedupe_key, payload
  ) values (
    target_user_id, target_event_type, target_channel,
    normalized_incident_key, delivery_key, target_payload
  )
  on conflict (user_id, event_type, channel, incident_key) do nothing
  returning id into outbox_id;

  if outbox_id is null then
    select id into outbox_id
    from public.notification_outbox
    where user_id = target_user_id
      and event_type = target_event_type
      and channel = target_channel
      and incident_key = normalized_incident_key;
    return outbox_id;
  end if;

  if target_channel = 'email' then
    perform pgmq.send(
      'tip_notifications',
      jsonb_build_object('outboxId', outbox_id)
    );
  elsif target_channel = 'sms' then
    perform pgmq.send(
      'sms_notifications',
      jsonb_build_object('outboxId', outbox_id)
    );
  end if;

  return outbox_id;
end;
$$;

create or replace function app_private.enqueue_notification(
  target_user_id uuid,
  target_event_type text,
  target_dedupe_key text,
  target_payload jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app_private.enqueue_channel_notification(
    target_user_id,
    target_event_type,
    'email',
    target_dedupe_key,
    target_payload
  );
$$;

create or replace function app_private.enqueue_sms_notification(
  target_user_id uuid,
  target_event_type text,
  target_dedupe_key text,
  target_payload jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app_private.enqueue_channel_notification(
    target_user_id,
    target_event_type,
    'sms',
    target_dedupe_key,
    target_payload
  );
$$;

create or replace function app_private.enqueue_in_app_notification(
  target_user_id uuid,
  target_event_type text,
  target_incident_key text,
  target_title text,
  target_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
  normalized_incident_key text := nullif(btrim(coalesce(target_incident_key, '')), '');
begin
  if target_user_id is null
    or nullif(btrim(coalesce(target_event_type, '')), '') is null
    or normalized_incident_key is null then
    raise exception 'A notification recipient, event type, and incident key are required.';
  end if;

  insert into public.notifications (
    user_id, event_type, incident_key, title, body
  ) values (
    target_user_id, target_event_type, normalized_incident_key,
    target_title, target_body
  )
  on conflict (user_id, event_type, incident_key)
    where incident_key is not null
  do nothing
  returning id into notification_id;

  if notification_id is null then
    select id into notification_id
    from public.notifications
    where user_id = target_user_id
      and event_type = target_event_type
      and incident_key = normalized_incident_key;
  end if;

  return notification_id;
end;
$$;

revoke all on function app_private.enqueue_channel_notification(uuid, text, text, text, jsonb)
from public, anon, authenticated;
revoke all on function app_private.enqueue_notification(uuid, text, text, jsonb)
from public, anon, authenticated;
revoke all on function app_private.enqueue_sms_notification(uuid, text, text, jsonb)
from public, anon, authenticated;
revoke all on function app_private.enqueue_in_app_notification(uuid, text, text, text, text)
from public, anon, authenticated;

create or replace function app_private.sync_tip_card_subscription_entitlements(
  target_tip_card_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.tip_card_entitlements (
    user_id, tip_card_id, source_type, source_purchase_id, source_subscription_id
  )
  select
    subscriptions.user_id,
    cards.id,
    'subscription',
    subscriptions.purchase_id,
    subscriptions.id
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  join public.tipster_subscriptions subscriptions
    on subscriptions.tipster_id = cards.tipster_id
   and subscriptions.status = 'active'
   and meetings.first_race_at >= subscriptions.starts_at
   and meetings.first_race_at < subscriptions.ends_at
  join public.content_purchases purchases
    on purchases.id = subscriptions.purchase_id
   and purchases.status in ('active', 'disputed')
   and purchases.refunded_at is null
  where cards.id = target_tip_card_id
    and cards.status in ('coming_soon', 'published', 'settled')
    and (
      not meetings.is_test
      or app_private.user_has_test_access(subscriptions.user_id)
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function app_private.sync_tip_card_subscription_entitlements_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_tip_card_subscription_entitlements(new.id);
  return new;
end;
$$;

drop trigger if exists sync_tip_card_subscription_entitlements on public.tip_cards;
create trigger sync_tip_card_subscription_entitlements
after insert or update of tipster_id, meeting_id, status
on public.tip_cards
for each row
execute function app_private.sync_tip_card_subscription_entitlements_trigger();

create or replace function app_private.prevent_overlapping_tipster_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and exists (
    select 1
    from public.tipster_subscriptions existing
    where existing.user_id = new.user_id
      and existing.tipster_id = new.tipster_id
      and existing.status = 'active'
      and existing.id <> new.id
      and tstzrange(existing.starts_at, existing.ends_at, '[)') &&
          tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'An active subscription already covers these dates.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_overlapping_tipster_subscriptions on public.tipster_subscriptions;
create trigger prevent_overlapping_tipster_subscriptions
before insert or update of user_id, tipster_id, starts_at, ends_at, status
on public.tipster_subscriptions
for each row
execute function app_private.prevent_overlapping_tipster_subscriptions();

revoke all on function app_private.sync_tip_card_subscription_entitlements(uuid)
from public, anon, authenticated;
revoke all on function app_private.sync_tip_card_subscription_entitlements_trigger()
from public, anon, authenticated;
revoke all on function app_private.prevent_overlapping_tipster_subscriptions()
from public, anon, authenticated;

create or replace function app_private.queue_tipster_race_change_alerts(target_change_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.race_change_events%rowtype;
  target record;
  alert_id uuid;
  alert_count integer := 0;
  is_editable boolean;
  alert_status text;
  alert_title text;
  alert_body text;
  incident_key text;
begin
  select * into event_row
  from public.race_change_events
  where id = target_change_event_id;

  if event_row.id is null or not event_row.is_material then
    return 0;
  end if;

  for target in
    select distinct
      cards.id as tip_card_id,
      cards.title as card_title,
      cards.revision,
      tipsters.user_id as tipster_user_id,
      tipsters.display_name as tipster_name,
      meetings.venue,
      meetings.meeting_date,
      fixtures.race_number,
      coalesce(profiles.email_notifications_enabled, true) as email_notifications_enabled
    from public.tip_cards cards
    join public.tipsters tipsters on tipsters.id = cards.tipster_id
    join public.race_meetings meetings on meetings.id = cards.meeting_id
    left join public.fixtures fixtures on fixtures.id = event_row.fixture_id
    left join public.profiles profiles on profiles.id = tipsters.user_id
    where cards.meeting_id = event_row.meeting_id
      and cards.status = 'published'
      and (
        event_row.entity_type = 'meeting'
        or exists (
          select 1
          from public.race_tip_selections selections
          where selections.tip_card_id = cards.id
            and selections.fixture_id = event_row.fixture_id
            and (
              event_row.entry_id is null
              or selections.winner_entry_id = event_row.entry_id
              or selections.place_entry_id = event_row.entry_id
            )
        )
        or exists (
          select 1
          from public.tip_card_multiples multiples
          join public.meeting_bet_options options on options.id = multiples.bet_option_id
          where multiples.tip_card_id = cards.id
            and (
              options.bet_type = 'other'
              or exists (
                select 1
                from public.meeting_bet_legs legs
                where legs.bet_option_id = options.id
                  and legs.fixture_id = event_row.fixture_id
              )
            )
        )
      )
  loop
    is_editable := app_private.card_change_is_editable(
      target.tip_card_id,
      event_row.fixture_id,
      event_row.entry_id
    );
    alert_status := case when is_editable then 'pending' else 'locked' end;

    insert into public.tip_card_change_alerts (
      change_event_id, tip_card_id, fixture_id, entry_id,
      status, is_after_lock, notified_at
    ) values (
      event_row.id, target.tip_card_id, event_row.fixture_id, event_row.entry_id,
      alert_status, not is_editable, now()
    )
    on conflict (change_event_id, tip_card_id) do nothing
    returning id into alert_id;

    if alert_id is null then
      continue;
    end if;

    incident_key := 'race-change:tip-card:' || target.tip_card_id::text ||
      ':revision:' || target.revision::text;
    alert_title := case
      when is_editable then 'Race data changed — review required'
      else 'Race data changed after the tip locked'
    end;
    alert_body := case
      when is_editable then
        'One or more race details changed for ' || target.venue ||
        '. Review all affected selections before their cutoffs.'
      else
        'One or more race details changed for ' || target.venue ||
        ' after the affected tips locked. The tips remain immutable.'
    end;

    perform app_private.enqueue_in_app_notification(
      target.tipster_user_id,
      'tip_card_race_data_changed',
      incident_key,
      alert_title,
      alert_body
    );

    if target.email_notifications_enabled then
      perform app_private.enqueue_notification(
        target.tipster_user_id,
        'tip_card_race_data_changed',
        incident_key,
        jsonb_build_object(
          'template', 'tip_card_race_data_changed',
          'tipCardId', target.tip_card_id,
          'revision', target.revision,
          'cardTitle', target.card_title,
          'tipsterName', target.tipster_name,
          'meetingVenue', target.venue,
          'meetingDate', target.meeting_date,
          'raceNumber', target.race_number,
          'changeSummary', alert_body,
          'changedFields', event_row.changed_fields,
          'beforeValues', event_row.before_values,
          'afterValues', event_row.after_values,
          'isAfterLock', not is_editable,
          'tipsterUrl', 'https://www.mrcracing.co.za/tipster/manage-tips/?card=' ||
            target.tip_card_id::text
        )
      );
    end if;

    alert_count := alert_count + 1;
    alert_id := null;
  end loop;

  return alert_count;
end;
$$;

revoke all on function app_private.queue_tipster_race_change_alerts(uuid)
from public, anon, authenticated;

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

  if profile_row.accepted_terms_at is null
    or profile_row.accepted_terms_version is distinct from current_terms_version then
    if p_terms_version is distinct from current_terms_version then
      raise exception 'Please accept the current terms before opening this meeting card.';
    end if;

    update public.profiles
    set
      accepted_terms_at = coalesce(accepted_terms_at, now()),
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

  perform app_private.sync_tip_card_subscription_entitlements(p_tip_card_id);

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

-- Repair any historic refund mismatch and revoke only the matching access path.
update public.tipster_subscriptions subscriptions
set status = 'refunded'
from public.content_purchases purchases
where purchases.id = subscriptions.purchase_id
  and purchases.status = 'refunded'
  and subscriptions.status <> 'refunded';

update public.tip_card_entitlements entitlements
set revoked_at = coalesce(entitlements.revoked_at, now())
from public.tipster_subscriptions subscriptions
join public.content_purchases purchases on purchases.id = subscriptions.purchase_id
where entitlements.source_subscription_id = subscriptions.id
  and purchases.status = 'refunded'
  and entitlements.revoked_at is null;

do $$
declare
  card_id uuid;
begin
  for card_id in
    select id
    from public.tip_cards
    where status in ('coming_soon', 'published', 'settled')
  loop
    perform app_private.sync_tip_card_subscription_entitlements(card_id);
  end loop;
end;
$$;

comment on column public.notification_outbox.incident_key is
  'Stable logical incident identity. A recipient receives each incident at most once per event type and channel.';
comment on function app_private.enqueue_channel_notification(uuid, text, text, text, jsonb) is
  'Idempotently queues one delivery per recipient, event, channel, and stable incident key.';
comment on function app_private.sync_tip_card_subscription_entitlements(uuid) is
  'Grants missing meeting-card access for qualifying active tipster subscriptions without duplicating entitlements.';
