-- Telegram receives only factual race differences. Replies are captured as
-- review feedback and never mutate race data automatically.

create table if not exists app_private.telegram_race_feedback (
  id uuid primary key default gen_random_uuid(),
  telegram_update_id bigint not null unique,
  incoming_message_id bigint not null,
  reply_to_message_id bigint not null,
  chat_id bigint not null,
  telegram_user_id bigint,
  telegram_username text,
  telegram_display_name text,
  notification_outbox_id uuid references public.notification_outbox(id) on delete set null,
  proposal_id uuid references public.race_feed_proposals(id) on delete set null,
  event_type text not null,
  meeting_venue text,
  meeting_date date,
  feedback_text text not null check (
    char_length(btrim(feedback_text)) between 3 and 500
  ),
  parsed_hint jsonb not null default '{}'::jsonb check (
    jsonb_typeof(parsed_hint) = 'object'
    and octet_length(parsed_hint::text) <= 4096
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 4096
  ),
  status text not null default 'new' check (
    status in ('new', 'reviewed', 'dismissed', 'applied')
  ),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (
    review_note is null or char_length(btrim(review_note)) between 3 and 1000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists telegram_race_feedback_review_idx
on app_private.telegram_race_feedback (status, created_at desc);

create index if not exists telegram_race_feedback_proposal_idx
on app_private.telegram_race_feedback (proposal_id, created_at desc)
where proposal_id is not null;

alter table app_private.telegram_race_feedback enable row level security;
alter table app_private.telegram_race_feedback force row level security;
revoke all on app_private.telegram_race_feedback
from public, anon, authenticated, service_role;

create or replace function public.record_telegram_race_feedback(
  p_telegram_update_id bigint,
  p_incoming_message_id bigint,
  p_reply_to_message_id bigint,
  p_chat_id bigint,
  p_telegram_user_id bigint,
  p_telegram_username text,
  p_telegram_display_name text,
  p_feedback_text text,
  p_parsed_hint jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_row public.notification_outbox%rowtype;
  feedback_id uuid;
  proposal_id_value uuid;
  feedback_text_value text := btrim(coalesce(p_feedback_text, ''));
  parsed_hint_value jsonb := coalesce(p_parsed_hint, '{}'::jsonb);
  metadata_value jsonb := coalesce(p_metadata, '{}'::jsonb);
  meeting_date_value date;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if p_telegram_update_id is null
    or p_incoming_message_id is null
    or p_reply_to_message_id is null
    or p_chat_id is null then
    raise exception 'Telegram update, message, reply, and chat identifiers are required.';
  end if;
  if char_length(feedback_text_value) not between 3 and 500 then
    raise exception 'Telegram feedback must contain between 3 and 500 characters.';
  end if;
  if jsonb_typeof(parsed_hint_value) <> 'object'
    or octet_length(parsed_hint_value::text) > 4096 then
    raise exception 'Telegram feedback hints are invalid.';
  end if;
  if jsonb_typeof(metadata_value) <> 'object'
    or octet_length(metadata_value::text) > 4096 then
    raise exception 'Telegram feedback metadata is invalid.';
  end if;

  if exists (
    select 1
    from app_private.telegram_race_feedback feedback
    where feedback.telegram_update_id = p_telegram_update_id
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select outbox.* into outbox_row
  from public.notification_outbox outbox
  where outbox.channel = 'telegram'
    and outbox.provider_message_id = 'telegram:' || p_reply_to_message_id::text
    and outbox.event_type in (
      'race_feed_proposal_review_required',
      'race_feed_secondary_consensus_review_required'
    )
  order by outbox.delivered_at desc nulls last, outbox.created_at desc
  limit 1;

  if outbox_row.id is null then
    return jsonb_build_object('status', 'ignored');
  end if;

  if coalesce(outbox_row.payload ->> 'proposalId', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    proposal_id_value := (outbox_row.payload ->> 'proposalId')::uuid;
  end if;
  begin
    meeting_date_value := nullif(outbox_row.payload ->> 'meetingDate', '')::date;
  exception when invalid_datetime_format then
    meeting_date_value := null;
  end;

  insert into app_private.telegram_race_feedback (
    telegram_update_id,
    incoming_message_id,
    reply_to_message_id,
    chat_id,
    telegram_user_id,
    telegram_username,
    telegram_display_name,
    notification_outbox_id,
    proposal_id,
    event_type,
    meeting_venue,
    meeting_date,
    feedback_text,
    parsed_hint,
    metadata
  ) values (
    p_telegram_update_id,
    p_incoming_message_id,
    p_reply_to_message_id,
    p_chat_id,
    p_telegram_user_id,
    nullif(left(btrim(coalesce(p_telegram_username, '')), 80), ''),
    nullif(left(btrim(coalesce(p_telegram_display_name, '')), 160), ''),
    outbox_row.id,
    proposal_id_value,
    outbox_row.event_type,
    nullif(left(btrim(coalesce(outbox_row.payload ->> 'meetingVenue', '')), 160), ''),
    meeting_date_value,
    feedback_text_value,
    parsed_hint_value,
    metadata_value
  )
  on conflict (telegram_update_id) do nothing
  returning id into feedback_id;

  if feedback_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  perform app_private.enqueue_in_app_notification(
    outbox_row.user_id,
    'telegram_race_feedback_received',
    'telegram-race-feedback:' || feedback_id::text,
    'Telegram race correction received',
    left(feedback_text_value, 500)
  );

  return jsonb_build_object(
    'status', 'recorded',
    'feedbackId', feedback_id,
    'proposalId', proposal_id_value
  );
end;
$$;

create or replace function public.admin_list_telegram_race_feedback(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    app_private.current_user_is_owner()
    or app_private.current_user_has_role('administrator'::public.app_role)
  ) then
    raise exception 'Administrator access with two-factor authentication is required.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', feedback.id,
        'proposalId', feedback.proposal_id,
        'eventType', feedback.event_type,
        'meetingVenue', feedback.meeting_venue,
        'meetingDate', feedback.meeting_date,
        'feedbackText', feedback.feedback_text,
        'parsedHint', feedback.parsed_hint,
        'status', feedback.status,
        'telegramUsername', feedback.telegram_username,
        'telegramDisplayName', feedback.telegram_display_name,
        'reviewNote', feedback.review_note,
        'createdAt', feedback.created_at,
        'reviewedAt', feedback.reviewed_at
      ) order by feedback.created_at desc
    )
    from (
      select rows.*
      from app_private.telegram_race_feedback rows
      order by rows.created_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) feedback
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_update_telegram_race_feedback(
  p_feedback_id uuid,
  p_status text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_row app_private.telegram_race_feedback%rowtype;
  status_value text := lower(btrim(coalesce(p_status, '')));
  review_note_value text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  if not (
    app_private.current_user_is_owner()
    or app_private.current_user_has_role('administrator'::public.app_role)
  ) then
    raise exception 'Administrator access with two-factor authentication is required.';
  end if;
  if status_value not in ('reviewed', 'dismissed', 'applied') then
    raise exception 'Telegram feedback status is invalid.';
  end if;
  if review_note_value is not null
    and char_length(review_note_value) not between 3 and 1000 then
    raise exception 'Review notes must contain between 3 and 1000 characters.';
  end if;

  update app_private.telegram_race_feedback feedback
  set status = status_value,
      review_note = review_note_value,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      updated_at = now()
  where feedback.id = p_feedback_id
  returning feedback.* into updated_row;

  if updated_row.id is null then
    raise exception 'Telegram race feedback was not found.';
  end if;

  return jsonb_build_object(
    'id', updated_row.id,
    'status', updated_row.status,
    'reviewedAt', updated_row.reviewed_at
  );
end;
$$;

revoke all on function public.record_telegram_race_feedback(
  bigint, bigint, bigint, bigint, bigint, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.record_telegram_race_feedback(
  bigint, bigint, bigint, bigint, bigint, text, text, text, jsonb, jsonb
) to service_role;

revoke all on function public.admin_list_telegram_race_feedback(integer)
from public, anon, service_role;
grant execute on function public.admin_list_telegram_race_feedback(integer)
to authenticated;

revoke all on function public.admin_update_telegram_race_feedback(uuid, text, text)
from public, anon, service_role;
grant execute on function public.admin_update_telegram_race_feedback(uuid, text, text)
to authenticated;

create or replace function app_private.enqueue_race_feed_review_alert(p_proposal_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.race_feed_proposals%rowtype;
  recipient record;
  recipient_count integer := 0;
  confidence_threshold_value numeric := 90;
  incident_key_value text;
  payload_value jsonb;
begin
  select * into proposal_row
  from public.race_feed_proposals
  where id = p_proposal_id;

  if proposal_row.id is null
    or proposal_row.status not in ('pending', 'quarantined') then
    return 0;
  end if;

  select coalesce(settings.confidence_threshold, 90)
  into confidence_threshold_value
  from public.race_feed_settings settings
  where settings.singleton = true;

  if proposal_row.status = 'pending'
    and proposal_row.confidence_score >= coalesce(confidence_threshold_value, 90)
    and not proposal_row.has_critical_conflict then
    return 0;
  end if;

  incident_key_value := 'race-feed-proposal-review:' || coalesce(
    nullif(proposal_row.proposal_hash, ''),
    proposal_row.meeting_key || ':' || proposal_row.change_type
  );
  payload_value := jsonb_build_object(
    'reviewKind', 'proposal_changes',
    'feedbackEnabled', true,
    'proposalId', proposal_row.id,
    'meetingVenue', proposal_row.venue,
    'meetingDate', proposal_row.meeting_date,
    'changeType', proposal_row.change_type,
    'confidenceScore', proposal_row.confidence_score,
    'distinctSourceCount', proposal_row.distinct_source_count,
    'approvedSourceCount', proposal_row.approved_source_count,
    'hasCriticalConflict', proposal_row.has_critical_conflict,
    'conflictSummary', proposal_row.conflict_summary,
    'status', proposal_row.status,
    'adminUrl', 'https://www.mrcracing.co.za/admin/racing/'
  );

  for recipient in
    with recipients as (
      select owners.user_id
      from public.platform_owners owners
      union
      select roles.user_id
      from public.user_roles roles
      where roles.role = 'administrator'
        and not exists (select 1 from public.platform_owners)
    )
    select user_id from recipients
  loop
    perform app_private.enqueue_channel_notification(
      recipient.user_id,
      'race_feed_proposal_review_required',
      'telegram',
      incident_key_value,
      payload_value
    );
    perform app_private.enqueue_in_app_notification(
      recipient.user_id,
      'race_feed_proposal_review_required',
      incident_key_value,
      'Race-feed change review required',
      proposal_row.venue || ' on ' || proposal_row.meeting_date::text ||
        ' has factual changes or a source conflict waiting for review.'
    );
    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

revoke all on function app_private.enqueue_race_feed_review_alert(uuid)
from public, anon, authenticated, service_role;

comment on table app_private.telegram_race_feedback is
  'Authenticated Telegram replies linked to delivered race-change alerts. Entries are review-only and never mutate race data automatically.';

comment on function public.record_telegram_race_feedback(
  bigint, bigint, bigint, bigint, bigint, text, text, text, jsonb, jsonb
) is 'Records an idempotent, authenticated Telegram reply against its originating race-change notification without applying any race-data change.';

comment on function public.admin_list_telegram_race_feedback(integer) is
  'Lists Telegram race correction feedback for MFA-verified administrators.';

comment on function public.admin_update_telegram_race_feedback(uuid, text, text) is
  'Updates the audited review state of Telegram race correction feedback.';

comment on function app_private.enqueue_race_feed_review_alert(uuid) is
  'Queues a review alert whose worker renders only factual database differences; unchanged proposals are suppressed at delivery time.';
