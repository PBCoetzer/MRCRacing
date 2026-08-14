create table if not exists app_private.hermes_race_jobs (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null unique,
  schema_version integer not null default 1 check (schema_version = 1),
  task_type text not null check (
    task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh', 'manual_research')
  ),
  source_task_id uuid references public.race_feed_tasks(id) on delete set null,
  source_run_id uuid references public.race_feed_runs(id) on delete set null,
  venue text,
  meeting_date date,
  race_number integer check (race_number is null or race_number > 0),
  required_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(required_fields) = 'array'),
  permitted_sources jsonb not null default '[]'::jsonb check (jsonb_typeof(permitted_sources) = 'array'),
  task_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(task_payload) = 'object'),
  state text not null default 'queued' check (
    state in ('queued', 'leased', 'returned', 'accepted', 'failed')
  ),
  attempt integer not null default 0 check (attempt between 0 and 3),
  max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  available_at timestamptz not null default now(),
  deadline timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  result_status text check (result_status is null or result_status in ('succeeded', 'partial', 'blocked')),
  result_payload jsonb,
  result_sources jsonb,
  result_confidence numeric(5,4) check (result_confidence is null or result_confidence between 0 and 1),
  result_warnings jsonb,
  result_conflicts jsonb,
  evidence_hash text,
  handoff_status text not null default 'pending' check (
    handoff_status in ('pending', 'shadow', 'proposal_created', 'failed', 'not_applicable')
  ),
  proposal_id uuid references public.race_feed_proposals(id) on delete set null,
  error_code text,
  error_detail text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deadline is null or deadline > created_at),
  check (
    (state <> 'leased')
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create table if not exists app_private.hermes_race_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references app_private.hermes_race_jobs(id) on delete cascade,
  event_type text not null,
  worker_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app_private.hermes_race_rate_limits (
  actor text not null,
  route text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (actor, route, bucket_start)
);

create index if not exists hermes_race_jobs_claim_idx
on app_private.hermes_race_jobs (state, available_at, created_at)
where state in ('queued', 'leased');

create index if not exists hermes_race_jobs_source_task_idx
on app_private.hermes_race_jobs (source_task_id, created_at desc)
where source_task_id is not null;

create index if not exists hermes_race_job_events_job_idx
on app_private.hermes_race_job_events (job_id, created_at desc);

alter table app_private.hermes_race_jobs enable row level security;
alter table app_private.hermes_race_jobs force row level security;
alter table app_private.hermes_race_job_events enable row level security;
alter table app_private.hermes_race_job_events force row level security;
alter table app_private.hermes_race_rate_limits enable row level security;
alter table app_private.hermes_race_rate_limits force row level security;

create or replace function app_private.check_hermes_race_rate_limit(
  p_actor text,
  p_route text,
  p_limit integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  current_bucket timestamptz := date_trunc('minute', now());
begin
  if nullif(btrim(p_actor), '') is null or nullif(btrim(p_route), '') is null then
    raise exception 'Rate-limit actor and route are required.';
  end if;
  if p_limit < 1 or p_limit > 600 then
    raise exception 'Rate-limit threshold is invalid.';
  end if;

  insert into app_private.hermes_race_rate_limits (actor, route, bucket_start, request_count)
  values (left(p_actor, 160), left(p_route, 80), current_bucket, 1)
  on conflict (actor, route, bucket_start) do update
  set request_count = app_private.hermes_race_rate_limits.request_count + 1
  returning request_count into current_count;

  if random() < 0.01 then
    delete from app_private.hermes_race_rate_limits
    where bucket_start < now() - interval '1 day';
  end if;

  return current_count <= p_limit;
end;
$$;

create or replace function app_private.enqueue_hermes_race_job(p_job jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
  created_value boolean := false;
  correlation_value text := nullif(btrim(p_job ->> 'correlation_id'), '');
begin
  if correlation_value is null or length(correlation_value) > 160 then
    raise exception 'A correlation_id of 1 to 160 characters is required.';
  end if;

  if coalesce(p_job ->> 'task_type', '') not in (
    'weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh', 'manual_research'
  ) then
    raise exception 'Unsupported Hermes race task type.';
  end if;

  insert into app_private.hermes_race_jobs (
    correlation_id,
    schema_version,
    task_type,
    source_task_id,
    source_run_id,
    venue,
    meeting_date,
    race_number,
    required_fields,
    permitted_sources,
    task_payload,
    available_at,
    deadline
  )
  values (
    correlation_value,
    coalesce((p_job ->> 'schema_version')::integer, 1),
    p_job ->> 'task_type',
    nullif(p_job ->> 'source_task_id', '')::uuid,
    nullif(p_job ->> 'source_run_id', '')::uuid,
    nullif(btrim(p_job ->> 'venue'), ''),
    nullif(p_job ->> 'meeting_date', '')::date,
    nullif(p_job ->> 'race_number', '')::integer,
    coalesce(p_job -> 'required_fields', '[]'::jsonb),
    coalesce(p_job -> 'permitted_sources', '[]'::jsonb),
    coalesce(p_job -> 'task_payload', '{}'::jsonb),
    coalesce(nullif(p_job ->> 'available_at', '')::timestamptz, now()),
    nullif(p_job ->> 'deadline', '')::timestamptz
  )
  on conflict (correlation_id) do nothing
  returning * into job_row;

  if job_row.id is not null then
    created_value := true;
    insert into app_private.hermes_race_job_events (job_id, event_type, detail)
    values (job_row.id, 'queued', jsonb_build_object('correlation_id', correlation_value));
  else
    select * into job_row
    from app_private.hermes_race_jobs
    where correlation_id = correlation_value;
  end if;

  return jsonb_build_object('created', created_value, 'job', to_jsonb(job_row));
end;
$$;

create or replace function app_private.claim_hermes_race_job(p_worker_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
  worker_value text := nullif(btrim(p_worker_id), '');
begin
  if worker_value is null or length(worker_value) > 160 then
    raise exception 'A valid worker id is required.';
  end if;

  update app_private.hermes_race_jobs
  set
    state = case when attempt >= max_attempts then 'failed' else 'queued' end,
    available_at = case when attempt >= max_attempts then available_at else now() end,
    lease_owner = null,
    lease_expires_at = null,
    error_code = case when attempt >= max_attempts then 'lease_attempts_exhausted' else error_code end,
    error_detail = case when attempt >= max_attempts then 'The Hermes worker lease expired too many times.' else error_detail end,
    updated_at = now()
  where state = 'leased'
    and lease_expires_at <= now();

  select * into job_row
  from app_private.hermes_race_jobs
  where state = 'queued'
    and available_at <= now()
    and attempt < max_attempts
    and (deadline is null or deadline > now())
  order by available_at, created_at
  for update skip locked
  limit 1;

  if job_row.id is null then
    return null;
  end if;

  update app_private.hermes_race_jobs
  set
    state = 'leased',
    attempt = attempt + 1,
    lease_owner = worker_value,
    lease_expires_at = now() + interval '15 minutes',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = job_row.id
  returning * into job_row;

  insert into app_private.hermes_race_job_events (job_id, event_type, worker_id, detail)
  values (
    job_row.id,
    'claimed',
    worker_value,
    jsonb_build_object('attempt', job_row.attempt, 'lease_expires_at', job_row.lease_expires_at)
  );

  return to_jsonb(job_row)
    - 'result_payload'
    - 'result_sources'
    - 'result_warnings'
    - 'result_conflicts'
    - 'error_detail';
end;
$$;

create or replace function app_private.heartbeat_hermes_race_job(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
begin
  update app_private.hermes_race_jobs
  set lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id
    and state = 'leased'
    and lease_owner = p_worker_id
    and lease_expires_at > now()
  returning * into job_row;

  if job_row.id is null then
    raise exception 'The Hermes race job lease is missing, expired, or owned by another worker.';
  end if;

  insert into app_private.hermes_race_job_events (job_id, event_type, worker_id)
  values (job_row.id, 'heartbeat', p_worker_id);

  return jsonb_build_object('job_id', job_row.id, 'lease_expires_at', job_row.lease_expires_at);
end;
$$;

create or replace function app_private.complete_hermes_race_job(
  p_result jsonb,
  p_worker_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
  job_id_value uuid := nullif(p_result ->> 'job_id', '')::uuid;
begin
  update app_private.hermes_race_jobs
  set
    state = 'returned',
    result_status = p_result ->> 'status',
    result_payload = p_result -> 'normalized_data',
    result_sources = p_result -> 'sources',
    result_confidence = (p_result ->> 'confidence')::numeric,
    result_warnings = coalesce(p_result -> 'warnings', '[]'::jsonb),
    result_conflicts = coalesce(p_result -> 'conflicts', '[]'::jsonb),
    evidence_hash = p_result ->> 'evidence_hash',
    lease_owner = null,
    lease_expires_at = null,
    completed_at = (p_result ->> 'completed_at')::timestamptz,
    error_code = null,
    error_detail = null,
    updated_at = now()
  where id = job_id_value
    and state = 'leased'
    and lease_owner = p_worker_id
    and lease_expires_at > now()
    and correlation_id = p_result ->> 'correlation_id'
  returning * into job_row;

  if job_row.id is null then
    raise exception 'The Hermes race job result does not match an active worker lease.';
  end if;

  insert into app_private.hermes_race_job_events (job_id, event_type, worker_id, detail)
  values (
    job_row.id,
    'result_returned',
    p_worker_id,
    jsonb_build_object('status', job_row.result_status, 'evidence_hash', job_row.evidence_hash)
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function app_private.fail_hermes_race_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
begin
  update app_private.hermes_race_jobs
  set
    state = case when attempt >= max_attempts then 'failed' else 'queued' end,
    available_at = case when attempt >= max_attempts then available_at else now() + interval '5 minutes' end,
    lease_owner = null,
    lease_expires_at = null,
    error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'worker_failure'), 120),
    error_detail = left(coalesce(nullif(btrim(p_error_detail), ''), 'Hermes worker failed.'), 2000),
    completed_at = case when attempt >= max_attempts then now() else completed_at end,
    updated_at = now()
  where id = p_job_id
    and state = 'leased'
    and lease_owner = p_worker_id
  returning * into job_row;

  if job_row.id is null then
    raise exception 'The Hermes race job failure does not match an active worker lease.';
  end if;

  insert into app_private.hermes_race_job_events (job_id, event_type, worker_id, detail)
  values (
    job_row.id,
    case when job_row.state = 'failed' then 'failed' else 'retry_scheduled' end,
    p_worker_id,
    jsonb_build_object('error_code', job_row.error_code, 'attempt', job_row.attempt)
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function app_private.record_hermes_race_handoff(
  p_job_id uuid,
  p_status text,
  p_proposal_id uuid default null,
  p_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_row app_private.hermes_race_jobs%rowtype;
begin
  if p_status not in ('shadow', 'proposal_created', 'failed', 'not_applicable') then
    raise exception 'Unsupported Hermes race handoff status.';
  end if;

  update app_private.hermes_race_jobs
  set
    state = case when p_status = 'proposal_created' then 'accepted' else state end,
    handoff_status = p_status,
    proposal_id = p_proposal_id,
    error_code = case when p_status = 'failed' then 'proposal_handoff_failed' else error_code end,
    error_detail = case when p_status = 'failed' then left(coalesce(p_error, 'Proposal handoff failed.'), 2000) else error_detail end,
    updated_at = now()
  where id = p_job_id
    and state in ('returned', 'accepted')
  returning * into job_row;

  if job_row.id is null then
    raise exception 'The Hermes race job cannot be handed off from its current state.';
  end if;

  insert into app_private.hermes_race_job_events (job_id, event_type, detail)
  values (
    job_row.id,
    'handoff_' || p_status,
    jsonb_build_object('proposal_id', p_proposal_id, 'error', p_error)
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function public.enqueue_hermes_race_job(p_job jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.enqueue_hermes_race_job(p_job);
$$;

create or replace function public.claim_hermes_race_job(p_worker_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.claim_hermes_race_job(p_worker_id);
$$;

create or replace function public.heartbeat_hermes_race_job(p_job_id uuid, p_worker_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.heartbeat_hermes_race_job(p_job_id, p_worker_id);
$$;

create or replace function public.complete_hermes_race_job(p_result jsonb, p_worker_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.complete_hermes_race_job(p_result, p_worker_id);
$$;

create or replace function public.fail_hermes_race_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.fail_hermes_race_job(p_job_id, p_worker_id, p_error_code, p_error_detail);
$$;

create or replace function public.get_hermes_race_job(p_job_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select to_jsonb(j) from app_private.hermes_race_jobs j where j.id = p_job_id;
$$;

create or replace function public.record_hermes_race_handoff(
  p_job_id uuid,
  p_status text,
  p_proposal_id uuid default null,
  p_error text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.record_hermes_race_handoff(p_job_id, p_status, p_proposal_id, p_error);
$$;

revoke all on table app_private.hermes_race_jobs from public, anon, authenticated;
revoke all on table app_private.hermes_race_job_events from public, anon, authenticated;
revoke all on table app_private.hermes_race_rate_limits from public, anon, authenticated;
grant select, insert, update on table app_private.hermes_race_jobs to service_role;
grant select, insert on table app_private.hermes_race_job_events to service_role;
grant select, insert, update, delete on table app_private.hermes_race_rate_limits to service_role;
grant usage, select on sequence app_private.hermes_race_job_events_id_seq to service_role;
grant usage on schema app_private to service_role;

revoke all on function app_private.check_hermes_race_rate_limit(text, text, integer) from public, anon, authenticated;

revoke all on function app_private.enqueue_hermes_race_job(jsonb) from public, anon, authenticated;
revoke all on function app_private.claim_hermes_race_job(text) from public, anon, authenticated;
revoke all on function app_private.heartbeat_hermes_race_job(uuid, text) from public, anon, authenticated;
revoke all on function app_private.complete_hermes_race_job(jsonb, text) from public, anon, authenticated;
revoke all on function app_private.fail_hermes_race_job(uuid, text, text, text) from public, anon, authenticated;
revoke all on function app_private.record_hermes_race_handoff(uuid, text, uuid, text) from public, anon, authenticated;

revoke all on function public.enqueue_hermes_race_job(jsonb) from public, anon, authenticated;
revoke all on function public.claim_hermes_race_job(text) from public, anon, authenticated;
revoke all on function public.heartbeat_hermes_race_job(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_hermes_race_job(jsonb, text) from public, anon, authenticated;
revoke all on function public.fail_hermes_race_job(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_hermes_race_job(uuid) from public, anon, authenticated;
revoke all on function public.record_hermes_race_handoff(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.check_hermes_race_rate_limit(
  p_actor text,
  p_route text,
  p_limit integer
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app_private.check_hermes_race_rate_limit(p_actor, p_route, p_limit);
$$;

revoke all on function public.check_hermes_race_rate_limit(text, text, integer) from public, anon, authenticated;

grant execute on function app_private.enqueue_hermes_race_job(jsonb) to service_role;
grant execute on function app_private.claim_hermes_race_job(text) to service_role;
grant execute on function app_private.heartbeat_hermes_race_job(uuid, text) to service_role;
grant execute on function app_private.complete_hermes_race_job(jsonb, text) to service_role;
grant execute on function app_private.fail_hermes_race_job(uuid, text, text, text) to service_role;
grant execute on function app_private.record_hermes_race_handoff(uuid, text, uuid, text) to service_role;
grant execute on function app_private.check_hermes_race_rate_limit(text, text, integer) to service_role;

grant execute on function public.enqueue_hermes_race_job(jsonb) to service_role;
grant execute on function public.claim_hermes_race_job(text) to service_role;
grant execute on function public.heartbeat_hermes_race_job(uuid, text) to service_role;
grant execute on function public.complete_hermes_race_job(jsonb, text) to service_role;
grant execute on function public.fail_hermes_race_job(uuid, text, text, text) to service_role;
grant execute on function public.get_hermes_race_job(uuid) to service_role;
grant execute on function public.record_hermes_race_handoff(uuid, text, uuid, text) to service_role;
grant execute on function public.check_hermes_race_rate_limit(text, text, integer) to service_role;
