alter table public.race_feed_runs
  drop constraint if exists race_feed_runs_status_check;

alter table public.race_feed_runs
  add constraint race_feed_runs_status_check
  check (status in (
    'running',
    'unchanged',
    'succeeded',
    'failed',
    'quarantined',
    'rejected',
    'skipped',
    'pending_approval'
  ));

alter table public.race_feed_runs
  add column if not exists search_model_name text,
  add column if not exists extraction_model_name text,
  add column if not exists search_query_count integer not null default 0 check (search_query_count >= 0),
  add column if not exists evidence_count integer not null default 0 check (evidence_count >= 0),
  add column if not exists task_count integer not null default 0 check (task_count >= 0);

create table if not exists public.race_feed_settings (
  singleton boolean primary key default true check (singleton),
  confidence_threshold integer not null default 95 check (confidence_threshold between 50 and 100),
  minimum_approved_sources integer not null default 2 check (minimum_approved_sources between 1 and 10),
  auto_approve_new_meetings boolean not null default false,
  auto_approve_routine_changes boolean not null default false,
  auto_approve_results boolean not null default false,
  future_lookahead_days integer not null default 7 check (future_lookahead_days between 1 and 14),
  daily_search_limit integer not null default 450 check (daily_search_limit between 1 and 500),
  last_weekly_discovery_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.race_feed_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.race_source_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  display_name text not null,
  status text not null default 'evidence_only'
    check (status in ('approved', 'evidence_only', 'blocked')),
  reliability_score integer not null default 50 check (reliability_score between 0 and 100),
  reuse_basis text,
  direct_fetch_allowed boolean not null default false,
  can_auto_approve boolean not null default false,
  last_reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.race_source_domains (
  domain,
  display_name,
  status,
  reliability_score,
  reuse_basis,
  direct_fetch_allowed,
  can_auto_approve
)
values
  (
    'raceform.co.za',
    'Raceform',
    'evidence_only',
    75,
    'Evidence only until automated and commercial reuse permission is documented.',
    false,
    false
  ),
  (
    'tote.co.za',
    'Tote South Africa',
    'evidence_only',
    80,
    'Evidence only until commercial reuse permission is documented.',
    false,
    false
  ),
  (
    'nhra.co.za',
    'National Horseracing Authority',
    'evidence_only',
    90,
    'Authoritative evidence, but auto-approval requires documented reuse permission.',
    false,
    false
  )
on conflict (domain) do nothing;

insert into public.race_feed_sources (
  name,
  source_name,
  source_url,
  extraction_hint,
  is_enabled
)
values (
  'Gemini grounded search',
  'Gemini Grounded Search',
  'https://ai.google.dev/gemini-api/docs/google-search',
  'South African horse-racing calendar, meeting, runner and official-result evidence.',
  true
)
on conflict (name) do update
set
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  extraction_hint = excluded.extraction_hint,
  is_enabled = true;

create table if not exists public.race_feed_tasks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.race_feed_sources(id) on delete cascade,
  run_id uuid references public.race_feed_runs(id) on delete set null,
  task_key text not null unique,
  task_type text not null check (task_type in (
    'weekly_calendar',
    'meeting_schedule',
    'race_detail',
    'result_refresh',
    'manual_research'
  )),
  state text not null default 'pending'
    check (state in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  meeting_id uuid references public.race_meetings(id) on delete cascade,
  fixture_id uuid references public.fixtures(id) on delete cascade,
  meeting_external_id text,
  venue text,
  meeting_date date,
  race_number integer check (race_number is null or race_number > 0),
  task_payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 20 check (max_attempts > 0),
  last_error text,
  last_completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.race_feed_fragments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.race_feed_tasks(id) on delete cascade,
  run_id uuid not null references public.race_feed_runs(id) on delete cascade,
  source_id uuid not null references public.race_feed_sources(id) on delete cascade,
  fragment_type text not null check (fragment_type in (
    'weekly_calendar',
    'meeting_schedule',
    'race_detail',
    'result'
  )),
  meeting_key text,
  meeting_external_id text,
  venue text,
  meeting_date date,
  race_number integer check (race_number is null or race_number > 0),
  payload jsonb not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  content_hash text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (task_id, content_hash)
);

create table if not exists public.race_feed_proposals (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.race_feed_sources(id) on delete cascade,
  run_id uuid not null references public.race_feed_runs(id) on delete cascade,
  source_task_id uuid references public.race_feed_tasks(id) on delete set null,
  parent_proposal_id uuid references public.race_feed_proposals(id) on delete set null,
  meeting_key text not null,
  meeting_external_id text not null,
  venue text not null,
  meeting_date date not null,
  proposal_version integer not null default 1 check (proposal_version > 0),
  proposal_hash text not null unique,
  change_type text not null check (change_type in ('new_meeting', 'routine_change', 'result')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'auto_approved', 'rejected', 'quarantined', 'failed')),
  snapshot jsonb not null,
  current_diff jsonb not null default '{}'::jsonb,
  validation_outcome jsonb not null default '{}'::jsonb,
  confidence_score numeric(5, 2) not null default 0 check (confidence_score between 0 and 100),
  confidence_breakdown jsonb not null default '{}'::jsonb,
  distinct_source_count integer not null default 0 check (distinct_source_count >= 0),
  approved_source_count integer not null default 0 check (approved_source_count >= 0),
  has_critical_conflict boolean not null default false,
  conflict_summary text,
  auto_approval_eligible boolean not null default false,
  research_guidance text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  applied_at timestamptz,
  apply_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_key, proposal_version)
);

alter table public.race_feed_tasks
  add column if not exists parent_proposal_id uuid references public.race_feed_proposals(id) on delete set null;

create table if not exists public.race_feed_evidence (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.race_feed_proposals(id) on delete cascade,
  domain_id uuid not null references public.race_source_domains(id) on delete restrict,
  source_url text not null,
  source_title text,
  retrieved_at timestamptz not null,
  evidence_excerpt text,
  fact_scope text not null default 'meeting',
  fact_payload jsonb not null default '{}'::jsonb,
  grounding_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (proposal_id, source_url, fact_scope)
);

create table if not exists public.race_feed_proposal_reviews (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.race_feed_proposals(id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject', 'retry_research')),
  review_note text not null,
  additional_research_information text,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists race_feed_tasks_due_idx
on public.race_feed_tasks (state, due_at, task_type);

create index if not exists race_feed_tasks_meeting_idx
on public.race_feed_tasks (meeting_id, task_type, due_at)
where meeting_id is not null;

create index if not exists race_feed_fragments_meeting_idx
on public.race_feed_fragments (meeting_key, fragment_type, race_number, created_at desc)
where is_current;

create index if not exists race_feed_proposals_status_idx
on public.race_feed_proposals (status, created_at desc);

create index if not exists race_feed_proposals_meeting_idx
on public.race_feed_proposals (meeting_key, proposal_version desc);

create index if not exists race_feed_evidence_proposal_idx
on public.race_feed_evidence (proposal_id, domain_id);

create index if not exists race_feed_reviews_proposal_idx
on public.race_feed_proposal_reviews (proposal_id, created_at desc);

drop trigger if exists set_race_feed_settings_updated_at on public.race_feed_settings;
create trigger set_race_feed_settings_updated_at
before update on public.race_feed_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_race_source_domains_updated_at on public.race_source_domains;
create trigger set_race_source_domains_updated_at
before update on public.race_source_domains
for each row execute function public.set_updated_at();

drop trigger if exists set_race_feed_tasks_updated_at on public.race_feed_tasks;
create trigger set_race_feed_tasks_updated_at
before update on public.race_feed_tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_race_feed_proposals_updated_at on public.race_feed_proposals;
create trigger set_race_feed_proposals_updated_at
before update on public.race_feed_proposals
for each row execute function public.set_updated_at();

create or replace function app_private.normalize_race_source_domain(raw_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    split_part(
      regexp_replace(
        split_part(regexp_replace(lower(btrim(coalesce(raw_value, ''))), '^https?://', ''), '/', 1),
        '^www\.',
        ''
      ),
      ':',
      1
    ),
    ''
  );
$$;

create or replace function app_private.ensure_gemini_race_feed_source()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
begin
  insert into public.race_feed_sources (
    name,
    source_name,
    source_url,
    extraction_hint,
    is_enabled
  )
  values (
    'Gemini grounded search',
    'Gemini Grounded Search',
    'https://ai.google.dev/gemini-api/docs/google-search',
    'South African horse-racing calendar, meeting, runner and official-result evidence.',
    true
  )
  on conflict (name) do update
  set
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    extraction_hint = excluded.extraction_hint,
    is_enabled = true
  returning id into source_id_value;

  return source_id_value;
end;
$$;

create or replace function public.claim_race_feed_task_plan(
  p_worker_id text,
  p_trigger text default 'cron'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  settings_row public.race_feed_settings%rowtype;
  task_row public.race_feed_tasks%rowtype;
  run_row public.race_feed_runs%rowtype;
  weekly_start date;
  queries_today integer;
  run_trigger text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('mrc-race-feed-task-claim')) then
    return null;
  end if;

  source_id_value := app_private.ensure_gemini_race_feed_source();

  select *
  into settings_row
  from public.race_feed_settings
  where singleton = true;

  weekly_start := date_trunc('week', now() at time zone 'Africa/Johannesburg')::date;

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    task_payload,
    due_at
  )
  values (
    source_id_value,
    'weekly-calendar:' || weekly_start::text,
    'weekly_calendar',
    jsonb_build_object(
      'weekStart', weekly_start,
      'lookaheadDays', settings_row.future_lookahead_days,
      'countryCode', 'ZA'
    ),
    coalesce(settings_row.last_weekly_discovery_at + interval '7 days', now())
  )
  on conflict (task_key) do nothing;

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    meeting_id,
    meeting_external_id,
    venue,
    meeting_date,
    task_payload,
    due_at
  )
  select
    source_id_value,
    'result-refresh:' || meeting.id::text,
    'result_refresh',
    meeting.id,
    meeting.external_id,
    meeting.venue,
    meeting.meeting_date,
    jsonb_build_object(
      'meetingId', meeting.id,
      'meetingExternalId', meeting.external_id,
      'venue', meeting.venue,
      'meetingDate', meeting.meeting_date
    ),
    greatest(meeting.first_race_at, now())
  from public.race_meetings meeting
  where not meeting.is_test
    and meeting.first_race_at <= now()
    and coalesce(meeting.last_race_at, meeting.first_race_at) >= now() - interval '7 days'
    and exists (
      select 1
      from public.tip_cards card
      where card.meeting_id = meeting.id
        and card.status <> 'void'::public.tip_card_status
    )
  on conflict (task_key) do nothing;

  update public.race_feed_tasks
  set
    state = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = 'Worker lease expired before completion.'
  where state = 'running'
    and locked_at < now() - interval '3 minutes';

  select coalesce(sum(search_query_count), 0)::integer
  into queries_today
  from public.race_feed_runs
  where started_at >= date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';

  if queries_today >= settings_row.daily_search_limit then
    return jsonb_build_object(
      'status', 'search_limit_reached',
      'queriesToday', queries_today,
      'dailySearchLimit', settings_row.daily_search_limit
    );
  end if;

  select *
  into task_row
  from public.race_feed_tasks
  where state in ('pending', 'failed')
    and due_at <= now()
    and attempts < max_attempts
  order by
    case task_type
      when 'manual_research' then 0
      when 'race_detail' then 1
      when 'result_refresh' then 2
      when 'meeting_schedule' then 3
      else 4
    end,
    due_at,
    created_at
  for update skip locked
  limit 1;

  if task_row.id is null then
    return null;
  end if;

  run_trigger := case
    when task_row.task_type = 'manual_research' then 'manual'
    when lower(coalesce(p_trigger, 'cron')) = 'retry' then 'retry'
    else 'cron'
  end;

  insert into public.race_feed_runs (
    source_id,
    trigger_type,
    status,
    task_count,
    search_model_name,
    extraction_model_name
  )
  values (
    source_id_value,
    run_trigger,
    'running',
    1,
    'gemini-2.5-flash',
    'gemini-3.6-flash'
  )
  returning * into run_row;

  update public.race_feed_tasks
  set
    state = 'running',
    run_id = run_row.id,
    locked_at = now(),
    locked_by = left(coalesce(nullif(btrim(p_worker_id), ''), 'edge-worker'), 200),
    attempts = attempts + 1,
    last_error = null
  where id = task_row.id
  returning * into task_row;

  return jsonb_build_object(
    'status', 'claimed',
    'task', to_jsonb(task_row),
    'run', to_jsonb(run_row),
    'settings', to_jsonb(settings_row),
    'queriesToday', queries_today
  );
end;
$$;

create or replace function public.complete_race_feed_task_plan(
  p_task_id uuid,
  p_run_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_search_query_count integer default 0,
  p_evidence_count integer default 0,
  p_extracted_payload jsonb default null,
  p_next_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.race_feed_tasks%rowtype;
  normalized_status text;
  next_due_at_value timestamptz;
  next_state text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  normalized_status := lower(coalesce(p_status, 'failed'));
  if normalized_status not in ('succeeded', 'failed', 'skipped', 'unchanged', 'pending_approval') then
    raise exception 'Unsupported task completion status.';
  end if;

  select *
  into task_row
  from public.race_feed_tasks
  where id = p_task_id
    and run_id = p_run_id
  for update;

  if task_row.id is null then
    raise exception 'Race-feed task lease was not found.';
  end if;

  if task_row.task_type = 'result_refresh' and normalized_status in ('succeeded', 'unchanged', 'pending_approval') then
    if p_next_due_at is not null then
      next_due_at_value := p_next_due_at;
    elsif now() <= coalesce(
      (select last_race_at from public.race_meetings where id = task_row.meeting_id),
      now()
    ) + interval '4 hours' then
      next_due_at_value := now() + interval '5 minutes';
    elsif now() <= coalesce(
      (select last_race_at from public.race_meetings where id = task_row.meeting_id),
      now() - interval '8 days'
    ) + interval '72 hours' then
      next_due_at_value := now() + interval '6 hours';
    elsif now() <= coalesce(
      (select last_race_at from public.race_meetings where id = task_row.meeting_id),
      now() - interval '8 days'
    ) + interval '7 days' then
      next_due_at_value := now() + interval '1 day';
    end if;
  end if;

  if normalized_status = 'failed' then
    next_state := 'failed';
    next_due_at_value := coalesce(p_next_due_at, now() + interval '5 minutes');
  elsif next_due_at_value is not null then
    next_state := 'pending';
  else
    next_state := 'completed';
  end if;

  update public.race_feed_tasks
  set
    state = next_state,
    due_at = coalesce(next_due_at_value, due_at),
    locked_at = null,
    locked_by = null,
    last_error = case when normalized_status = 'failed' then left(coalesce(p_error_message, 'Race-feed task failed.'), 1000) else null end,
    last_completed_at = case when normalized_status <> 'failed' then now() else last_completed_at end
  where id = task_row.id;

  update public.race_feed_runs
  set
    status = normalized_status,
    completed_at = now(),
    duration_ms = greatest(0, floor(extract(epoch from now() - started_at) * 1000))::integer,
    search_query_count = greatest(0, coalesce(p_search_query_count, 0)),
    evidence_count = greatest(0, coalesce(p_evidence_count, 0)),
    llm_called = coalesce(p_search_query_count, 0) > 0,
    extracted_payload = coalesce(p_extracted_payload, extracted_payload),
    error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
    error_message = nullif(left(coalesce(p_error_message, ''), 1000), '')
  where id = p_run_id
    and status <> 'succeeded';

  if task_row.task_type = 'weekly_calendar'
    and normalized_status in ('succeeded', 'unchanged', 'pending_approval')
  then
    update public.race_feed_settings
    set last_weekly_discovery_at = now()
    where singleton = true;
  end if;

  return jsonb_build_object(
    'taskId', task_row.id,
    'runId', p_run_id,
    'state', next_state,
    'nextDueAt', next_due_at_value
  );
end;
$$;

;
