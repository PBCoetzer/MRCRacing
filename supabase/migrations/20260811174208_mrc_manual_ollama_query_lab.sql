begin;

alter table public.race_search_trials
  add column if not exists query_mode text not null default 'recommended';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.race_search_trials'::regclass
      and conname = 'race_search_trials_query_mode_check'
  ) then
    alter table public.race_search_trials
      add constraint race_search_trials_query_mode_check
      check (query_mode in ('recommended', 'manual'));
  end if;
end;
$$;

drop function if exists public.claim_race_search_trial(
  uuid, text, text, date, date, text, date, text, uuid, uuid, text, text
);

create function public.claim_race_search_trial(
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
  p_provider_model text default 'ollama-web-search',
  p_query_mode text default 'recommended'
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
  if p_query_mode not in ('recommended', 'manual') then
    raise exception 'Unsupported race search query mode.';
  end if;
  if p_query_mode = 'manual' and p_search_type <> 'upcoming_calendar' then
    raise exception 'Manual queries are limited to upcoming-calendar searches.';
  end if;
  if p_query_mode = 'manual'
    and nullif(btrim(coalesce(p_additional_guidance, '')), '') is not null
  then
    raise exception 'Manual queries cannot include separate guidance.';
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
    if retry_trial.query_mode <> p_query_mode
      or retry_trial.canonical_query <> btrim(p_canonical_query)
    then
      raise exception 'A retry must preserve the original query and query mode.';
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
    query_mode,
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
    p_query_mode,
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
      'queryMode', inserted_trial.query_mode,
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
    'queryMode', inserted_trial.query_mode,
    'dailyLimit', daily_limit,
    'usedRequests', used_requests + 1
  );
end;
$$;

revoke all on function public.claim_race_search_trial(
  uuid, text, text, date, date, text, date, text, uuid, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.claim_race_search_trial(
  uuid, text, text, date, date, text, date, text, uuid, uuid, text, text, text
) to service_role;

notify pgrst, 'reload schema';

commit;
;
