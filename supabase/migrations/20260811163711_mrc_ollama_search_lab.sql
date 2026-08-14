begin;

create table if not exists public.race_search_trials (
  id uuid primary key default gen_random_uuid(),
  search_type text not null,
  parent_trial_id uuid references public.race_search_trials(id) on delete restrict,
  retry_of_trial_id uuid references public.race_search_trials(id) on delete restrict,
  canonical_query text not null,
  date_from date not null,
  date_to date not null,
  venue text,
  meeting_date date,
  additional_guidance text,
  provider_name text not null default 'ollama',
  provider_model text not null default 'ollama-web-search',
  status text not null default 'running',
  results jsonb not null default '[]'::jsonb,
  provider_request_count integer not null default 1,
  unique_domain_count integer not null default 0,
  error_code text,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint race_search_trials_search_type_check
    check (search_type in ('upcoming_calendar', 'meeting_detail')),
  constraint race_search_trials_status_check
    check (status in ('running', 'succeeded', 'failed', 'approved', 'rejected')),
  constraint race_search_trials_date_window_check
    check (date_to >= date_from),
  constraint race_search_trials_results_array_check
    check (jsonb_typeof(results) = 'array'),
  constraint race_search_trials_request_count_check
    check (provider_request_count between 0 and 10),
  constraint race_search_trials_domain_count_check
    check (unique_domain_count between 0 and 100),
  constraint race_search_trials_query_length_check
    check (char_length(canonical_query) between 10 and 1500),
  constraint race_search_trials_guidance_length_check
    check (additional_guidance is null or char_length(additional_guidance) <= 500),
  constraint race_search_trials_meeting_shape_check
    check (
      (search_type = 'upcoming_calendar' and parent_trial_id is null and venue is null and meeting_date is null)
      or
      (search_type = 'meeting_detail' and parent_trial_id is not null and nullif(btrim(venue), '') is not null and meeting_date is not null)
    ),
  constraint race_search_trials_retry_self_check
    check (retry_of_trial_id is null or retry_of_trial_id <> id)
);

create table if not exists public.race_search_trial_reviews (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null unique references public.race_search_trials(id) on delete restrict,
  reviewer_id uuid references auth.users(id) on delete set null,
  decision text not null,
  review_note text not null,
  created_at timestamptz not null default now(),
  constraint race_search_trial_reviews_decision_check
    check (decision in ('approve', 'reject')),
  constraint race_search_trial_reviews_note_check
    check (char_length(btrim(review_note)) between 5 and 1000)
);

create index if not exists race_search_trials_created_at_idx
  on public.race_search_trials (created_at desc);

create index if not exists race_search_trials_status_created_idx
  on public.race_search_trials (status, created_at desc);

create index if not exists race_search_trials_parent_idx
  on public.race_search_trials (parent_trial_id, created_at desc)
  where parent_trial_id is not null;

create index if not exists race_search_trials_retry_idx
  on public.race_search_trials (retry_of_trial_id, created_at desc)
  where retry_of_trial_id is not null;

create or replace function app_private.prevent_race_search_review_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Race search reviews are immutable.';
end;
$$;

drop trigger if exists race_search_trial_reviews_immutable
  on public.race_search_trial_reviews;

create trigger race_search_trial_reviews_immutable
before update or delete on public.race_search_trial_reviews
for each row execute function app_private.prevent_race_search_review_mutation();

create or replace function public.claim_race_search_trial(
  p_created_by uuid,
  p_search_type text,
  p_canonical_query text,
  p_date_from date,
  p_date_to date,
  p_venue text default null,
  p_meeting_date date default null,
  p_additional_guidance text default null,
  p_parent_trial_id uuid default null,
  p_retry_of_trial_id uuid default null,
  p_provider_name text default 'ollama',
  p_provider_model text default 'ollama-web-search'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  daily_limit integer;
  used_requests integer;
  local_day_start timestamptz;
  local_day_end timestamptz;
  parent_trial public.race_search_trials%rowtype;
  retry_trial public.race_search_trials%rowtype;
  inserted_trial public.race_search_trials%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('mrc-race-search-daily-limit', 0));

  if p_created_by is null
    or not exists (
      select 1
      from public.user_roles
      where user_id = p_created_by
        and role = 'administrator'
    )
    or not app_private.account_is_active(p_created_by)
  then
    raise exception 'Administrator access required.';
  end if;

  if p_search_type not in ('upcoming_calendar', 'meeting_detail') then
    raise exception 'Unsupported race search type.';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'A valid search date window is required.';
  end if;
  if char_length(btrim(coalesce(p_canonical_query, ''))) not between 10 and 1500 then
    raise exception 'A valid canonical query is required.';
  end if;
  if char_length(coalesce(p_additional_guidance, '')) > 500 then
    raise exception 'Additional guidance is too long.';
  end if;

  if p_retry_of_trial_id is not null then
    select * into retry_trial
    from public.race_search_trials
    where id = p_retry_of_trial_id;
    if not found or retry_trial.search_type <> p_search_type or retry_trial.status = 'running' then
      raise exception 'The retry trial is invalid.';
    end if;
    if retry_trial.date_from <> p_date_from
      or retry_trial.date_to <> p_date_to
      or retry_trial.parent_trial_id is distinct from p_parent_trial_id
      or retry_trial.venue is distinct from nullif(btrim(coalesce(p_venue, '')), '')
      or retry_trial.meeting_date is distinct from p_meeting_date
    then
      raise exception 'A retry must preserve the original search scope.';
    end if;
  end if;

  if p_search_type = 'upcoming_calendar' then
    if p_parent_trial_id is not null or p_venue is not null or p_meeting_date is not null then
      raise exception 'Upcoming-calendar searches cannot use meeting detail fields.';
    end if;
  else
    if p_parent_trial_id is null or nullif(btrim(coalesce(p_venue, '')), '') is null or p_meeting_date is null then
      raise exception 'Meeting-detail searches require an approved parent, venue and meeting date.';
    end if;

    select * into parent_trial
    from public.race_search_trials
    where id = p_parent_trial_id
      and search_type = 'upcoming_calendar'
      and status = 'approved';
    if not found then
      raise exception 'Approve an upcoming-calendar search before requesting meeting details.';
    end if;
    if p_meeting_date < parent_trial.date_from or p_meeting_date > parent_trial.date_to then
      raise exception 'Meeting date must fall inside the approved search window.';
    end if;
    if p_date_from <> p_meeting_date or p_date_to <> p_meeting_date then
      raise exception 'Meeting-detail searches must use the meeting date as their date window.';
    end if;
  end if;

  select daily_search_limit into daily_limit
  from public.race_feed_settings
  where singleton = true;
  daily_limit := coalesce(daily_limit, 25);

  local_day_start := ((now() at time zone 'Africa/Johannesburg')::date::timestamp at time zone 'Africa/Johannesburg');
  local_day_end := local_day_start + interval '1 day';

  select
    coalesce((
      select sum(search_query_count)
      from public.race_feed_runs
      where started_at >= local_day_start
        and started_at < local_day_end
    ), 0)
    + coalesce((
      select sum(provider_request_count)
      from public.race_search_trials
      where created_at >= local_day_start
        and created_at < local_day_end
    ), 0)
  into used_requests;

  if used_requests >= daily_limit then
    return jsonb_build_object(
      'status', 'search_limit_reached',
      'dailyLimit', daily_limit,
      'usedRequests', used_requests
    );
  end if;

  insert into public.race_search_trials (
    search_type,
    parent_trial_id,
    retry_of_trial_id,
    canonical_query,
    date_from,
    date_to,
    venue,
    meeting_date,
    additional_guidance,
    provider_name,
    provider_model,
    status,
    provider_request_count,
    created_by
  ) values (
    p_search_type,
    p_parent_trial_id,
    p_retry_of_trial_id,
    btrim(p_canonical_query),
    p_date_from,
    p_date_to,
    nullif(btrim(coalesce(p_venue, '')), ''),
    p_meeting_date,
    nullif(btrim(coalesce(p_additional_guidance, '')), ''),
    p_provider_name,
    p_provider_model,
    'running',
    1,
    p_created_by
  ) returning * into inserted_trial;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    p_created_by,
    'race_search_trial_started',
    'race_search_trial',
    inserted_trial.id,
    jsonb_build_object(
      'searchType', inserted_trial.search_type,
      'dateFrom', inserted_trial.date_from,
      'dateTo', inserted_trial.date_to,
      'parentTrialId', inserted_trial.parent_trial_id,
      'retryOfTrialId', inserted_trial.retry_of_trial_id,
      'provider', inserted_trial.provider_name
    )
  );

  return jsonb_build_object(
    'status', 'claimed',
    'trialId', inserted_trial.id,
    'dailyLimit', daily_limit,
    'usedRequests', used_requests + 1
  );
end;
$$;

create or replace function public.complete_race_search_trial(
  p_trial_id uuid,
  p_status text,
  p_results jsonb default '[]'::jsonb,
  p_unique_domain_count integer default 0,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Unsupported race search completion status.';
  end if;
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'Race search results must be a JSON array.';
  end if;

  update public.race_search_trials
  set
    status = p_status,
    results = case when p_status = 'succeeded' then coalesce(p_results, '[]'::jsonb) else '[]'::jsonb end,
    unique_domain_count = greatest(0, least(coalesce(p_unique_domain_count, 0), 100)),
    error_code = case when p_status = 'failed' then left(nullif(btrim(coalesce(p_error_code, '')), ''), 100) else null end,
    error_message = case when p_status = 'failed' then left(nullif(btrim(coalesce(p_error_message, '')), ''), 500) else null end,
    completed_at = now(),
    updated_at = now()
  where id = p_trial_id
    and status = 'running';

  if not found then
    raise exception 'Race search trial is not running.';
  end if;
end;
$$;

create or replace function public.admin_review_race_search_trial(
  p_trial_id uuid,
  p_decision text,
  p_review_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_decision text := lower(btrim(coalesce(p_decision, '')));
  trial public.race_search_trials%rowtype;
begin
  if actor_id is null
    or not app_private.current_user_has_role('administrator')
    or not app_private.current_user_account_active()
  then
    raise exception 'Administrator access required.';
  end if;
  if normalized_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject.';
  end if;
  if char_length(btrim(coalesce(p_review_note, ''))) not between 5 and 1000 then
    raise exception 'A review note of at least five characters is required.';
  end if;

  select * into trial
  from public.race_search_trials
  where id = p_trial_id
  for update;

  if not found then
    raise exception 'Race search trial was not found.';
  end if;
  if trial.status <> 'succeeded' then
    raise exception 'Only a successful unreviewed search can be reviewed.';
  end if;

  insert into public.race_search_trial_reviews (trial_id, reviewer_id, decision, review_note)
  values (trial.id, actor_id, normalized_decision, btrim(p_review_note));

  update public.race_search_trials
  set
    status = case when normalized_decision = 'approve' then 'approved' else 'rejected' end,
    reviewed_at = now(),
    updated_at = now()
  where id = trial.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'race_search_trial_' || case when normalized_decision = 'approve' then 'approved' else 'rejected' end,
    'race_search_trial',
    trial.id,
    jsonb_build_object(
      'searchType', trial.search_type,
      'decision', normalized_decision,
      'reviewNote', btrim(p_review_note)
    )
  );

  return jsonb_build_object(
    'trialId', trial.id,
    'status', case when normalized_decision = 'approve' then 'approved' else 'rejected' end
  );
end;
$$;

alter table public.race_search_trials enable row level security;
alter table public.race_search_trial_reviews enable row level security;

drop policy if exists race_search_trials_admin_read on public.race_search_trials;
create policy race_search_trials_admin_read
on public.race_search_trials
for select
to authenticated
using (
  app_private.current_user_account_active()
  and app_private.current_user_has_role('administrator')
);

drop policy if exists race_search_trial_reviews_admin_read on public.race_search_trial_reviews;
create policy race_search_trial_reviews_admin_read
on public.race_search_trial_reviews
for select
to authenticated
using (
  app_private.current_user_account_active()
  and app_private.current_user_has_role('administrator')
);

revoke all on public.race_search_trials from public, anon, authenticated;
revoke all on public.race_search_trial_reviews from public, anon, authenticated;
grant select on public.race_search_trials to authenticated;
grant select on public.race_search_trial_reviews to authenticated;

revoke all on function public.claim_race_search_trial(
  uuid, text, text, date, date, text, date, text, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.claim_race_search_trial(
  uuid, text, text, date, date, text, date, text, uuid, uuid, text, text
) to service_role;

revoke all on function public.complete_race_search_trial(
  uuid, text, jsonb, integer, text, text
) from public, anon, authenticated;
grant execute on function public.complete_race_search_trial(
  uuid, text, jsonb, integer, text, text
) to service_role;

revoke all on function public.admin_review_race_search_trial(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_review_race_search_trial(uuid, text, text)
  to authenticated;

update public.race_feed_settings
set
  auto_approve_new_meetings = false,
  auto_approve_routine_changes = false,
  auto_approve_results = false,
  updated_at = now()
where singleton = true;

do $$
declare
  race_job_id bigint;
  cancelled_task_id uuid;
begin
  select jobid into race_job_id
  from cron.job
  where jobname = 'mrc-sync-race-data'
  limit 1;

  if race_job_id is not null then
    perform cron.alter_job(job_id => race_job_id, active => false);
  end if;

  with cancelled as (
    update public.race_feed_tasks
    set
      state = 'cancelled',
      locked_at = null,
      locked_by = null,
      last_error = 'Cancelled while automated race processing is paused for the administrator Ollama Search Lab pilot.',
      updated_at = now()
    where task_type = 'weekly_calendar'
      and state in ('pending', 'running', 'failed')
    returning id
  )
  select id into cancelled_task_id
  from cancelled
  order by id
  limit 1;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    'race_feed_automation_paused',
    'race_feed',
    cancelled_task_id,
    jsonb_build_object(
      'cronJob', 'mrc-sync-race-data',
      'cronPaused', race_job_id is not null,
      'cancelledTaskId', cancelled_task_id,
      'reason', 'Administrator Ollama Search Lab pilot'
    )
  );
end;
$$;

commit;
;
