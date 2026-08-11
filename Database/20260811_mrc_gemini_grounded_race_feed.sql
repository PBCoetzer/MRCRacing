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
    'gemini-3.6-flash',
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

create or replace function public.submit_race_feed_proposal(
  p_task_id uuid,
  p_run_id uuid,
  p_snapshot jsonb,
  p_change_type text,
  p_current_diff jsonb,
  p_validation_outcome jsonb,
  p_evidence jsonb,
  p_completeness_score numeric,
  p_agreement_score numeric,
  p_has_critical_conflict boolean default false,
  p_conflict_summary text default null,
  p_parent_proposal_id uuid default null,
  p_research_guidance text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.race_feed_tasks%rowtype;
  run_row public.race_feed_runs%rowtype;
  settings_row public.race_feed_settings%rowtype;
  proposal_row public.race_feed_proposals%rowtype;
  meeting_item jsonb;
  evidence_item jsonb;
  source_domain text;
  domain_row public.race_source_domains%rowtype;
  meeting_key_value text;
  meeting_external_id_value text;
  venue_value text;
  meeting_date_value date;
  proposal_hash_value text;
  proposal_version_value integer;
  distinct_sources integer;
  approved_sources integer;
  source_quality_score numeric;
  completeness_score numeric;
  agreement_score numeric;
  confidence_score_value numeric;
  confidence_breakdown_value jsonb;
  auto_toggle boolean;
  auto_eligible boolean;
  apply_result_value jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  if lower(coalesce(p_change_type, '')) not in ('new_meeting', 'routine_change', 'result') then
    raise exception 'Unsupported race-feed proposal change type.';
  end if;

  if jsonb_typeof(p_snapshot -> 'meetings') <> 'array'
    or jsonb_array_length(p_snapshot -> 'meetings') <> 1
    or jsonb_typeof(p_evidence) <> 'array'
  then
    raise exception 'A proposal must contain one complete meeting and an evidence array.';
  end if;

  select *
  into task_row
  from public.race_feed_tasks
  where id = p_task_id
  for update;

  select *
  into run_row
  from public.race_feed_runs
  where id = p_run_id
    and source_id = task_row.source_id
  for update;

  if task_row.id is null or run_row.id is null then
    raise exception 'Race-feed task or run was not found.';
  end if;

  select value
  into meeting_item
  from jsonb_array_elements(p_snapshot -> 'meetings')
  limit 1;

  meeting_external_id_value := nullif(btrim(meeting_item ->> 'externalId'), '');
  venue_value := nullif(btrim(meeting_item ->> 'venue'), '');
  meeting_date_value := nullif(meeting_item ->> 'meetingDate', '')::date;

  if meeting_external_id_value is null
    or venue_value is null
    or meeting_date_value is null
    or jsonb_typeof(meeting_item -> 'races') <> 'array'
    or jsonb_array_length(meeting_item -> 'races') = 0
  then
    raise exception 'The proposal meeting is incomplete.';
  end if;

  meeting_key_value := lower(regexp_replace(venue_value, '[^a-zA-Z0-9]+', '-', 'g'))
    || ':' || meeting_date_value::text;
  proposal_hash_value := encode(
    extensions.digest(
      convert_to(p_snapshot::text || '|' || p_evidence::text || '|' || lower(p_change_type), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select *
  into proposal_row
  from public.race_feed_proposals
  where proposal_hash = proposal_hash_value;

  if proposal_row.id is not null then
    return jsonb_build_object(
      'status', 'duplicate',
      'proposal', to_jsonb(proposal_row)
    );
  end if;

  select coalesce(max(proposal_version), 0) + 1
  into proposal_version_value
  from public.race_feed_proposals
  where meeting_key = meeting_key_value;

  insert into public.race_feed_proposals (
    source_id,
    run_id,
    source_task_id,
    parent_proposal_id,
    meeting_key,
    meeting_external_id,
    venue,
    meeting_date,
    proposal_version,
    proposal_hash,
    change_type,
    snapshot,
    current_diff,
    validation_outcome,
    has_critical_conflict,
    conflict_summary,
    research_guidance
  )
  values (
    task_row.source_id,
    run_row.id,
    task_row.id,
    p_parent_proposal_id,
    meeting_key_value,
    meeting_external_id_value,
    venue_value,
    meeting_date_value,
    proposal_version_value,
    proposal_hash_value,
    lower(p_change_type),
    p_snapshot,
    coalesce(p_current_diff, '{}'::jsonb),
    coalesce(p_validation_outcome, '{}'::jsonb),
    coalesce(p_has_critical_conflict, false),
    nullif(btrim(coalesce(p_conflict_summary, '')), ''),
    nullif(btrim(coalesce(p_research_guidance, '')), '')
  )
  returning * into proposal_row;

  for evidence_item in
    select value from jsonb_array_elements(p_evidence)
  loop
    source_domain := app_private.normalize_race_source_domain(
      coalesce(evidence_item ->> 'domain', evidence_item ->> 'url')
    );

    if source_domain is null or nullif(btrim(evidence_item ->> 'url'), '') is null then
      continue;
    end if;

    insert into public.race_source_domains (
      domain,
      display_name,
      status,
      reliability_score,
      direct_fetch_allowed,
      can_auto_approve
    )
    values (
      source_domain,
      coalesce(nullif(btrim(evidence_item ->> 'title'), ''), source_domain),
      'evidence_only',
      50,
      false,
      false
    )
    on conflict (domain) do nothing;

    select *
    into domain_row
    from public.race_source_domains
    where domain = source_domain;

    insert into public.race_feed_evidence (
      proposal_id,
      domain_id,
      source_url,
      source_title,
      retrieved_at,
      evidence_excerpt,
      fact_scope,
      fact_payload,
      grounding_payload
    )
    values (
      proposal_row.id,
      domain_row.id,
      btrim(evidence_item ->> 'url'),
      nullif(btrim(coalesce(evidence_item ->> 'title', '')), ''),
      coalesce(nullif(evidence_item ->> 'retrievedAt', '')::timestamptz, now()),
      nullif(left(btrim(coalesce(evidence_item ->> 'excerpt', '')), 2000), ''),
      coalesce(nullif(btrim(evidence_item ->> 'factScope'), ''), 'meeting'),
      coalesce(evidence_item -> 'factPayload', '{}'::jsonb),
      coalesce(evidence_item -> 'groundingPayload', '{}'::jsonb)
    )
    on conflict (proposal_id, source_url, fact_scope) do nothing;
  end loop;

  select
    count(distinct domain.id)::integer,
    count(distinct domain.id) filter (
      where domain.status = 'approved' and domain.can_auto_approve
    )::integer,
    coalesce(avg(
      domain.reliability_score * case
        when evidence.retrieved_at >= now() - interval '1 day' then 1.0
        when evidence.retrieved_at >= now() - interval '7 days' then 0.8
        else 0.5
      end
    ) filter (where domain.status <> 'blocked'), 0)
  into distinct_sources, approved_sources, source_quality_score
  from public.race_feed_evidence evidence
  join public.race_source_domains domain on domain.id = evidence.domain_id
  where evidence.proposal_id = proposal_row.id;

  completeness_score := greatest(0, least(100, coalesce(p_completeness_score, 0)));
  agreement_score := greatest(0, least(100, coalesce(p_agreement_score, 0)));
  source_quality_score := greatest(0, least(100, coalesce(source_quality_score, 0)));
  confidence_score_value := round(
    completeness_score * 0.20
    + source_quality_score * 0.30
    + agreement_score * 0.50,
    2
  );

  if approved_sources < 2 then
    confidence_score_value := least(confidence_score_value, 70);
  end if;
  if coalesce(p_has_critical_conflict, false) then
    confidence_score_value := least(confidence_score_value, 90);
  end if;

  confidence_breakdown_value := jsonb_build_object(
    'schemaCompleteness', completeness_score,
    'sourceQualityFreshness', round(source_quality_score, 2),
    'crossSourceAgreement', agreement_score,
    'weightedScore', confidence_score_value,
    'oneSourceCapApplied', approved_sources < 2,
    'conflictCapApplied', coalesce(p_has_critical_conflict, false)
  );

  select *
  into settings_row
  from public.race_feed_settings
  where singleton = true;

  auto_toggle := case lower(p_change_type)
    when 'new_meeting' then settings_row.auto_approve_new_meetings
    when 'routine_change' then settings_row.auto_approve_routine_changes
    else settings_row.auto_approve_results
  end;

  auto_eligible := auto_toggle
    and confidence_score_value >= settings_row.confidence_threshold
    and approved_sources >= settings_row.minimum_approved_sources
    and not coalesce(p_has_critical_conflict, false);

  update public.race_feed_proposals
  set
    confidence_score = confidence_score_value,
    confidence_breakdown = confidence_breakdown_value,
    distinct_source_count = distinct_sources,
    approved_source_count = approved_sources,
    auto_approval_eligible = auto_eligible
  where id = proposal_row.id
  returning * into proposal_row;

  update public.race_feed_runs
  set
    status = 'pending_approval',
    completed_at = now(),
    duration_ms = greatest(0, floor(extract(epoch from now() - started_at) * 1000))::integer,
    source_changed = true,
    llm_called = true,
    search_query_count = greatest(search_query_count, 1),
    evidence_count = distinct_sources,
    extracted_payload = p_snapshot,
    error_code = null,
    error_message = null
  where id = run_row.id;

  if auto_eligible then
    apply_result_value := app_private.apply_race_snapshot(
      run_row.id,
      run_row.source_id,
      p_snapshot,
      false
    );

    update public.race_feed_proposals
    set
      status = case
        when apply_result_value ->> 'status' = 'succeeded' then 'auto_approved'
        else 'quarantined'
      end,
      applied_at = case when apply_result_value ->> 'status' = 'succeeded' then now() else null end,
      apply_result = apply_result_value
    where id = proposal_row.id
    returning * into proposal_row;
  end if;

  return jsonb_build_object(
    'status', proposal_row.status,
    'proposal', to_jsonb(proposal_row)
  );
end;
$$;

create or replace function public.admin_review_race_feed_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.race_feed_proposals%rowtype;
  apply_result_value jsonb;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if lower(coalesce(p_decision, '')) not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject.';
  end if;

  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'A review note of at least five characters is required.';
  end if;

  select *
  into proposal_row
  from public.race_feed_proposals
  where id = p_proposal_id
  for update;

  if proposal_row.id is null or proposal_row.status not in ('pending', 'quarantined') then
    raise exception 'Only pending or quarantined proposals can be reviewed.';
  end if;

  insert into public.race_feed_proposal_reviews (
    proposal_id,
    decision,
    review_note,
    reviewed_by
  )
  values (
    proposal_row.id,
    lower(p_decision),
    btrim(p_note),
    (select auth.uid())
  );

  if lower(p_decision) = 'reject' then
    update public.race_feed_proposals
    set
      status = 'rejected',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      review_note = btrim(p_note)
    where id = proposal_row.id
    returning * into proposal_row;

    update public.race_feed_runs
    set
      status = 'rejected',
      review_note = btrim(p_note),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
    where id = proposal_row.run_id;
  else
    apply_result_value := app_private.apply_race_snapshot(
      proposal_row.run_id,
      proposal_row.source_id,
      proposal_row.snapshot,
      true
    );

    update public.race_feed_proposals
    set
      status = case
        when apply_result_value ->> 'status' = 'succeeded' then 'approved'
        else 'failed'
      end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      review_note = btrim(p_note),
      applied_at = case when apply_result_value ->> 'status' = 'succeeded' then now() else null end,
      apply_result = apply_result_value
    where id = proposal_row.id
    returning * into proposal_row;

    update public.race_feed_runs
    set
      review_note = btrim(p_note),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
    where id = proposal_row.run_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'race_feed_proposal_' || lower(p_decision),
    'race_feed_proposal',
    proposal_row.id,
    jsonb_build_object(
      'note', btrim(p_note),
      'confidence', proposal_row.confidence_score,
      'changeType', proposal_row.change_type
    )
  );

  return to_jsonb(proposal_row);
end;
$$;

create or replace function public.admin_request_race_feed_research(
  p_additional_information text,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  proposal_row public.race_feed_proposals%rowtype;
  task_row public.race_feed_tasks%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if char_length(btrim(coalesce(p_additional_information, ''))) < 5 then
    raise exception 'Additional research information must contain at least five characters.';
  end if;

  source_id_value := app_private.ensure_gemini_race_feed_source();

  if p_proposal_id is not null then
    select *
    into proposal_row
    from public.race_feed_proposals
    where id = p_proposal_id;

    if proposal_row.id is null then
      raise exception 'Race-feed proposal was not found.';
    end if;

    insert into public.race_feed_proposal_reviews (
      proposal_id,
      decision,
      review_note,
      additional_research_information,
      reviewed_by
    )
    values (
      proposal_row.id,
      'retry_research',
      'Additional grounded research requested.',
      btrim(p_additional_information),
      (select auth.uid())
    );
  end if;

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    parent_proposal_id,
    meeting_external_id,
    venue,
    meeting_date,
    task_payload,
    due_at,
    created_by
  )
  values (
    source_id_value,
    'manual-research:' || gen_random_uuid()::text,
    'manual_research',
    proposal_row.id,
    proposal_row.meeting_external_id,
    proposal_row.venue,
    proposal_row.meeting_date,
    jsonb_build_object(
      'additionalInformation', btrim(p_additional_information),
      'parentProposalId', proposal_row.id,
      'meetingExternalId', proposal_row.meeting_external_id,
      'venue', proposal_row.venue,
      'meetingDate', proposal_row.meeting_date
    ),
    now(),
    (select auth.uid())
  )
  returning * into task_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'race_feed_research_requested',
    'race_feed_task',
    task_row.id,
    jsonb_build_object(
      'proposalId', proposal_row.id,
      'additionalInformation', btrim(p_additional_information)
    )
  );

  return to_jsonb(task_row);
end;
$$;

create or replace function public.admin_update_race_feed_settings(
  p_confidence_threshold integer default null,
  p_minimum_approved_sources integer default null,
  p_auto_approve_new_meetings boolean default null,
  p_auto_approve_routine_changes boolean default null,
  p_auto_approve_results boolean default null,
  p_future_lookahead_days integer default null,
  p_daily_search_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row public.race_feed_settings%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  update public.race_feed_settings
  set
    confidence_threshold = coalesce(p_confidence_threshold, confidence_threshold),
    minimum_approved_sources = coalesce(p_minimum_approved_sources, minimum_approved_sources),
    auto_approve_new_meetings = coalesce(p_auto_approve_new_meetings, auto_approve_new_meetings),
    auto_approve_routine_changes = coalesce(p_auto_approve_routine_changes, auto_approve_routine_changes),
    auto_approve_results = coalesce(p_auto_approve_results, auto_approve_results),
    future_lookahead_days = coalesce(p_future_lookahead_days, future_lookahead_days),
    daily_search_limit = coalesce(p_daily_search_limit, daily_search_limit),
    updated_by = (select auth.uid())
  where singleton = true
  returning * into settings_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'race_feed_settings_updated',
    'race_feed_settings',
    null,
    to_jsonb(settings_row) - 'updated_by'
  );

  return to_jsonb(settings_row);
end;
$$;

create or replace function public.admin_upsert_race_source_domain(
  p_domain text,
  p_display_name text,
  p_status text,
  p_reliability_score integer,
  p_reuse_basis text default null,
  p_direct_fetch_allowed boolean default false,
  p_can_auto_approve boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_domain text;
  domain_row public.race_source_domains%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  normalized_domain := app_private.normalize_race_source_domain(p_domain);
  if normalized_domain is null then
    raise exception 'A valid source domain is required.';
  end if;

  if lower(coalesce(p_status, '')) not in ('approved', 'evidence_only', 'blocked') then
    raise exception 'Unsupported source-domain status.';
  end if;

  if p_reliability_score not between 0 and 100 then
    raise exception 'Reliability score must be between 0 and 100.';
  end if;

  insert into public.race_source_domains (
    domain,
    display_name,
    status,
    reliability_score,
    reuse_basis,
    direct_fetch_allowed,
    can_auto_approve,
    last_reviewed_at,
    reviewed_by
  )
  values (
    normalized_domain,
    coalesce(nullif(btrim(p_display_name), ''), normalized_domain),
    lower(p_status),
    p_reliability_score,
    nullif(btrim(coalesce(p_reuse_basis, '')), ''),
    coalesce(p_direct_fetch_allowed, false),
    coalesce(p_can_auto_approve, false) and lower(p_status) = 'approved',
    now(),
    (select auth.uid())
  )
  on conflict (domain) do update
  set
    display_name = excluded.display_name,
    status = excluded.status,
    reliability_score = excluded.reliability_score,
    reuse_basis = excluded.reuse_basis,
    direct_fetch_allowed = excluded.direct_fetch_allowed,
    can_auto_approve = excluded.can_auto_approve,
    last_reviewed_at = now(),
    reviewed_by = (select auth.uid())
  returning * into domain_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'race_source_domain_updated',
    'race_source_domain',
    domain_row.id,
    to_jsonb(domain_row) - 'reviewed_by'
  );

  return to_jsonb(domain_row);
end;
$$;

create or replace function public.get_race_llm_configuration()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  configuration jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select jsonb_build_object(
    'baseUrl', max(decrypted_secret) filter (where name = 'mrc_race_llm_base_url'),
    'apiKey', max(decrypted_secret) filter (where name = 'mrc_race_llm_api_key'),
    'model', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_model'),
      'gemini-3.6-flash'
    ),
    'searchModel', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_search_model'),
      'gemini-3.6-flash'
    ),
    'extractionModel', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_extraction_model'),
      max(decrypted_secret) filter (where name = 'mrc_race_llm_model'),
      'gemini-3.6-flash'
    ),
    'responseMode', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_response_mode'),
      'json_schema'
    )
  )
  into configuration
  from vault.decrypted_secrets
  where name in (
    'mrc_race_llm_base_url',
    'mrc_race_llm_api_key',
    'mrc_race_llm_model',
    'mrc_race_llm_search_model',
    'mrc_race_llm_extraction_model',
    'mrc_race_llm_response_mode'
  );

  return coalesce(configuration, '{}'::jsonb);
end;
$$;

alter table public.race_feed_settings enable row level security;
alter table public.race_source_domains enable row level security;
alter table public.race_feed_tasks enable row level security;
alter table public.race_feed_fragments enable row level security;
alter table public.race_feed_proposals enable row level security;
alter table public.race_feed_evidence enable row level security;
alter table public.race_feed_proposal_reviews enable row level security;

drop policy if exists race_feed_settings_admin_read on public.race_feed_settings;
create policy race_feed_settings_admin_read
on public.race_feed_settings
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_source_domains_admin_read on public.race_source_domains;
create policy race_source_domains_admin_read
on public.race_source_domains
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_tasks_admin_read on public.race_feed_tasks;
create policy race_feed_tasks_admin_read
on public.race_feed_tasks
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_fragments_admin_read on public.race_feed_fragments;
create policy race_feed_fragments_admin_read
on public.race_feed_fragments
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_proposals_admin_read on public.race_feed_proposals;
create policy race_feed_proposals_admin_read
on public.race_feed_proposals
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_evidence_admin_read on public.race_feed_evidence;
create policy race_feed_evidence_admin_read
on public.race_feed_evidence
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_proposal_reviews_admin_read on public.race_feed_proposal_reviews;
create policy race_feed_proposal_reviews_admin_read
on public.race_feed_proposal_reviews
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

revoke all on table public.race_feed_settings from public, anon, authenticated;
revoke all on table public.race_source_domains from public, anon, authenticated;
revoke all on table public.race_feed_tasks from public, anon, authenticated;
revoke all on table public.race_feed_fragments from public, anon, authenticated;
revoke all on table public.race_feed_proposals from public, anon, authenticated;
revoke all on table public.race_feed_evidence from public, anon, authenticated;
revoke all on table public.race_feed_proposal_reviews from public, anon, authenticated;

grant select on table public.race_feed_settings to authenticated;
grant select on table public.race_source_domains to authenticated;
grant select on table public.race_feed_tasks to authenticated;
grant select on table public.race_feed_fragments to authenticated;
grant select on table public.race_feed_proposals to authenticated;
grant select on table public.race_feed_evidence to authenticated;
grant select on table public.race_feed_proposal_reviews to authenticated;

grant all on table public.race_feed_settings to service_role;
grant all on table public.race_source_domains to service_role;
grant all on table public.race_feed_tasks to service_role;
grant all on table public.race_feed_fragments to service_role;
grant all on table public.race_feed_proposals to service_role;
grant all on table public.race_feed_evidence to service_role;
grant all on table public.race_feed_proposal_reviews to service_role;

revoke all on function public.claim_race_feed_task_plan(text, text) from public, anon, authenticated;
grant execute on function public.claim_race_feed_task_plan(text, text) to service_role;

revoke all on function public.complete_race_feed_task_plan(uuid, uuid, text, text, text, integer, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_race_feed_task_plan(uuid, uuid, text, text, text, integer, integer, jsonb, timestamptz) to service_role;

revoke all on function public.submit_race_feed_proposal(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, numeric, numeric, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_race_feed_proposal(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, numeric, numeric, boolean, text, uuid, text) to service_role;

revoke all on function public.admin_review_race_feed_proposal(uuid, text, text) from public, anon;
grant execute on function public.admin_review_race_feed_proposal(uuid, text, text) to authenticated;

revoke all on function public.admin_request_race_feed_research(text, uuid) from public, anon;
grant execute on function public.admin_request_race_feed_research(text, uuid) to authenticated;

revoke all on function public.admin_update_race_feed_settings(integer, integer, boolean, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.admin_update_race_feed_settings(integer, integer, boolean, boolean, boolean, integer, integer) to authenticated;

revoke all on function public.admin_upsert_race_source_domain(text, text, text, integer, text, boolean, boolean) from public, anon;
grant execute on function public.admin_upsert_race_source_domain(text, text, text, integer, text, boolean, boolean) to authenticated;

revoke all on function public.get_race_llm_configuration() from public, anon, authenticated;
grant execute on function public.get_race_llm_configuration() to service_role;

revoke all on function app_private.normalize_race_source_domain(text) from public, anon, authenticated;
revoke all on function app_private.ensure_gemini_race_feed_source() from public, anon, authenticated;
