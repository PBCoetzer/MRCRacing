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

  if target_channel in ('email', 'telegram') then
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

create or replace function public.claim_tip_notification_jobs(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jobs jsonb;
begin
  with queue_messages as (
    select *
    from pgmq.read(
      'tip_notifications',
      120,
      greatest(1, least(coalesce(p_limit, 20), 100))
    )
  ),
  claimed as (
    update public.notification_outbox o
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now()
    from queue_messages q
    where o.id = (q.message ->> 'outboxId')::uuid
      and o.channel in ('email', 'telegram')
      and (
        o.status in ('pending', 'failed')
        or (
          o.status = 'processing'
          and o.locked_at < now() - interval '2 minutes'
        )
      )
      and o.available_at <= now()
      and o.attempt_count < 8
    returning
      o.id,
      o.user_id,
      o.event_type,
      o.channel,
      o.dedupe_key,
      o.payload,
      o.attempt_count,
      q.msg_id as queue_message_id
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  into jobs
  from claimed;

  return jobs;
end;
$$;

create or replace function app_private.race_feed_snapshot_is_complete(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  meeting jsonb;
begin
  if jsonb_typeof(p_snapshot -> 'meetings') <> 'array'
    or jsonb_array_length(p_snapshot -> 'meetings') <> 1 then
    return false;
  end if;

  meeting := p_snapshot #> '{meetings,0}';
  if nullif(btrim(meeting ->> 'externalId'), '') is null
    or nullif(btrim(meeting ->> 'venue'), '') is null
    or nullif(btrim(meeting ->> 'meetingDate'), '') is null
    or jsonb_typeof(meeting -> 'races') <> 'array'
    or jsonb_array_length(meeting -> 'races') = 0 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(meeting -> 'races') race
    where coalesce((race ->> 'raceNumber')::integer, 0) <= 0
      or nullif(btrim(race ->> 'startsAt'), '') is null
      or nullif(btrim(race ->> 'title'), '') is null
      or coalesce((race ->> 'distanceMetres')::integer, 0) <= 0
      or jsonb_typeof(race -> 'runners') <> 'array'
      or jsonb_array_length(race -> 'runners') = 0
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(meeting -> 'races') race
    cross join lateral jsonb_array_elements(race -> 'runners') runner
    where coalesce((runner ->> 'saddleNumber')::integer, 0) <= 0
      or nullif(btrim(runner ->> 'horseName'), '') is null
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(meeting -> 'races') race
    group by (race ->> 'raceNumber')::integer
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(meeting -> 'races') race
    cross join lateral jsonb_array_elements(race -> 'runners') runner
    group by (race ->> 'raceNumber')::integer, (runner ->> 'saddleNumber')::integer
    having count(*) > 1
  ) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

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

  incident_key_value := 'race-feed-proposal-review:' || proposal_row.id::text;
  payload_value := jsonb_build_object(
    'proposalId', proposal_row.id,
    'meetingVenue', proposal_row.venue,
    'meetingDate', proposal_row.meeting_date,
    'changeType', proposal_row.change_type,
    'confidenceScore', proposal_row.confidence_score,
    'distinctSourceCount', proposal_row.distinct_source_count,
    'approvedSourceCount', proposal_row.approved_source_count,
    'hasCriticalConflict', proposal_row.has_critical_conflict,
    'status', proposal_row.status,
    'adminUrl', 'https://www.mrcracing.co.za/admin/race-feed/#proposals'
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
      'Race-feed approval required',
      proposal_row.venue || ' on ' || proposal_row.meeting_date::text ||
        ' is waiting for review at ' || proposal_row.confidence_score::text || '% confidence.'
    );
    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

create or replace function app_private.process_race_feed_proposal_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hermes_confidence numeric;
  evidence_is_approved boolean := false;
  apply_result_value jsonb;
begin
  if new.status not in ('pending', 'quarantined')
    or new.confidence_score is null then
    return new;
  end if;

  if new.status = 'pending' and new.auto_approval_eligible then
    return new;
  end if;

  select jobs.result_confidence
  into hermes_confidence
  from app_private.hermes_race_jobs jobs
  where jobs.source_task_id = new.source_task_id
    and jobs.result_status = 'succeeded'
    and coalesce(jsonb_array_length(jobs.result_conflicts), 0) = 0
  order by jobs.completed_at desc nulls last, jobs.updated_at desc
  limit 1;

  select coalesce(bool_and(
    domains.status = 'approved' and domains.can_auto_approve
  ), false)
  into evidence_is_approved
  from public.race_feed_evidence evidence
  join public.race_source_domains domains on domains.id = evidence.domain_id
  where evidence.proposal_id = new.id;

  if new.apply_result is null
    and hermes_confidence = 1
    and evidence_is_approved
    and not new.has_critical_conflict
    and app_private.race_feed_snapshot_is_complete(new.snapshot) then
    apply_result_value := app_private.apply_race_snapshot(
      new.run_id,
      new.source_id,
      new.snapshot,
      false
    );

    update public.race_feed_proposals
    set
      confidence_score = 100,
      confidence_breakdown = coalesce(confidence_breakdown, '{}'::jsonb) || jsonb_build_object(
        'weightedScore', 100,
        'oneSourceCapApplied', false,
        'backendExactConfidenceBypass', true
      ),
      auto_approval_eligible = apply_result_value ->> 'status' = 'succeeded',
      status = case
        when apply_result_value ->> 'status' = 'succeeded' then 'auto_approved'
        else 'quarantined'
      end,
      applied_at = case
        when apply_result_value ->> 'status' = 'succeeded' then now()
        else null
      end,
      apply_result = apply_result_value
    where id = new.id;

    return new;
  end if;

  perform app_private.enqueue_race_feed_review_alert(new.id);
  return new;
end;
$$;

drop trigger if exists process_race_feed_proposal_gate on public.race_feed_proposals;
create trigger process_race_feed_proposal_gate
after update of confidence_score, status, apply_result
on public.race_feed_proposals
for each row
when (new.status in ('pending', 'quarantined'))
execute function app_private.process_race_feed_proposal_gate();

revoke all on function app_private.race_feed_snapshot_is_complete(jsonb)
from public, anon, authenticated;
revoke all on function app_private.enqueue_race_feed_review_alert(uuid)
from public, anon, authenticated;
revoke all on function app_private.process_race_feed_proposal_gate()
from public, anon, authenticated;

grant execute on function public.claim_tip_notification_jobs(integer)
to service_role;

comment on function app_private.process_race_feed_proposal_gate() is
  'Auto-applies only exact 100% conflict-free Hermes proposals with complete snapshots and approved evidence; all other held proposals create one deduplicated Telegram and in-app admin alert.';
