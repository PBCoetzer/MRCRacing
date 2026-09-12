-- Qualifying high-confidence, conflict-free race-feed changes are operational updates,
-- not approval work. Keep Telegram for lower-confidence approvals and for
-- quarantined/critical proposals that genuinely require administrator review.

update public.race_feed_settings
set confidence_threshold = 90,
    auto_approve_new_meetings = true,
    auto_approve_routine_changes = true,
    auto_approve_results = true,
    updated_at = now()
where singleton = true;

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

  -- A normal proposal at or above the configured threshold is not approval
  -- work. Critical conflicts and quarantined apply failures remain actionable
  -- even when their computed confidence is high.
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
    'proposalId', proposal_row.id,
    'meetingVenue', proposal_row.venue,
    'meetingDate', proposal_row.meeting_date,
    'changeType', proposal_row.change_type,
    'confidenceScore', proposal_row.confidence_score,
    'distinctSourceCount', proposal_row.distinct_source_count,
    'approvedSourceCount', proposal_row.approved_source_count,
    'hasCriticalConflict', proposal_row.has_critical_conflict,
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
      'Race-feed approval required',
      proposal_row.venue || ' on ' || proposal_row.meeting_date::text ||
        ' is waiting for review at ' || proposal_row.confidence_score::text || '% confidence.'
    );
    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

revoke all on function app_private.enqueue_race_feed_review_alert(uuid)
from public, anon, authenticated, service_role;

comment on function app_private.enqueue_race_feed_review_alert(uuid) is
  'Queues deduplicated approval alerts only below the configured confidence threshold, while retaining alerts for critical conflicts and quarantined apply failures.';
