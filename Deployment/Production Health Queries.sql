-- Run from an administrator-only SQL session.
-- Results are aggregate and intentionally exclude customer identifiers, payloads, and error text.

select
  status::text,
  channel,
  count(*) as item_count,
  min(created_at) filter (where status::text in ('queued', 'processing')) as oldest_opened_at,
  max(attempt_count) as highest_attempt_count
from public.notification_outbox
where created_at >= now() - interval '24 hours'
group by status::text, channel
order by status::text, channel;

select
  status,
  count(*) as message_count,
  min(created_at) as oldest_created_at,
  max(latest_event_at) as latest_provider_event_at
from public.auth_email_messages
where created_at >= now() - interval '24 hours'
group by status
order by status;

select
  count(*) filter (
    where accepted_at is not null
      and delivered_at is null
      and bounced_at is null
      and complained_at is null
      and suppressed_at is null
      and failed_at is null
      and accepted_at < now() - interval '10 minutes'
  ) as accepted_without_terminal_event,
  count(*) filter (where bounced_at >= now() - interval '24 hours') as bounced_last_24h,
  count(*) filter (where complained_at >= now() - interval '24 hours') as complained_last_24h,
  count(*) filter (where suppressed_at >= now() - interval '24 hours') as suppressed_last_24h,
  count(*) filter (where failed_at >= now() - interval '24 hours') as failed_last_24h
from public.auth_email_messages;

select
  status,
  count(*) as job_count,
  min(created_at) filter (where status in ('queued', 'processing')) as oldest_open_job_at,
  max(completed_at) filter (where status = 'completed') as latest_completed_at
from public.site_build_jobs
where created_at >= now() - interval '7 days'
group by status
order by status;

select
  status,
  count(*) as run_count,
  max(completed_at) filter (where status = 'completed') as latest_completed_at,
  max(started_at) as latest_started_at
from public.race_feed_runs
where started_at >= now() - interval '24 hours'
group by status
order by status;

select
  state,
  count(*) as job_count,
  min(created_at) filter (where state in ('available', 'leased')) as oldest_open_job_at,
  count(*) filter (where deadline < now() and state not in ('completed', 'cancelled')) as missed_deadline_count,
  count(*) filter (where attempt >= max_attempts and state <> 'completed') as exhausted_attempt_count
from app_private.hermes_race_jobs
where created_at >= now() - interval '7 days'
group by state
order by state;

select
  provider,
  status::text,
  count(*) as payment_count,
  max(updated_at) as latest_updated_at
from public.payments
where created_at >= now() - interval '24 hours'
group by provider, status::text
order by provider, status::text;
