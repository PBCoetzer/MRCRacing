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

;
