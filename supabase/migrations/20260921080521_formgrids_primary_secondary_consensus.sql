-- Formgrids is the sole publishing source. Other domains are comparison-only
-- and may open a review alert only when at least two independent sources agree
-- on the same normalized difference.

update public.race_source_domains
set display_name = 'Formgrids',
    status = 'approved',
    reliability_score = 100,
    direct_fetch_allowed = true,
    can_auto_approve = true,
    reuse_basis = 'Primary authenticated race feed authorized by the account owner. Complete, conflict-free Formgrids snapshots may publish automatically.',
    last_reviewed_at = now(),
    updated_at = now()
where domain = 'formgrids.info';

update public.race_source_domains
set status = 'evidence_only',
    reliability_score = 85,
    direct_fetch_allowed = true,
    can_auto_approve = false,
    reuse_basis = 'Comparison-only factual evidence. Raceform may corroborate a Formgrids difference but can never publish race data automatically.',
    last_reviewed_at = now(),
    updated_at = now()
where domain = 'raceform.co.za';

update public.race_source_domains
set status = 'evidence_only',
    reliability_score = 85,
    direct_fetch_allowed = true,
    can_auto_approve = false,
    reuse_basis = 'Comparison-only factual card-change evidence. Tote may corroborate a Formgrids difference but can never publish race data automatically.',
    last_reviewed_at = now(),
    updated_at = now()
where domain = 'tote.co.za';

update public.race_feed_sources
set name = 'Tote comparison card changes',
    source_name = 'tote_comparison_card_changes',
    source_url = 'https://www.tote.co.za/fixtures/card-changes',
    extraction_hint = 'Comparison-only South African scratchings and jockey changes. Never apply directly.',
    is_enabled = true,
    updated_at = now()
where name in ('Tote official card changes', 'Tote comparison card changes')
   or source_url = 'https://www.tote.co.za/fixtures/card-changes';

insert into public.race_feed_sources (
  name,
  source_name,
  source_url,
  extraction_hint,
  is_enabled
)
select
  'Tote comparison card changes',
  'tote_comparison_card_changes',
  'https://www.tote.co.za/fixtures/card-changes',
  'Comparison-only South African scratchings and jockey changes. Never apply directly.',
  true
where not exists (
  select 1
  from public.race_feed_sources
  where name = 'Tote comparison card changes'
     or source_url = 'https://www.tote.co.za/fixtures/card-changes'
);

create table if not exists app_private.secondary_race_change_checks (
  id bigint generated always as identity primary key,
  meeting_id uuid references public.race_meetings(id) on delete cascade,
  source_domain text not null,
  source_url text,
  source_observed_at timestamptz,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('succeeded', 'failed')),
  content_hash text,
  changes_seen integer not null default 0 check (changes_seen >= 0),
  differences_seen integer not null default 0 check (differences_seen >= 0),
  consensus_created integer not null default 0 check (consensus_created >= 0),
  unmatched_changes jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text
);

create index if not exists secondary_race_change_checks_lookup_idx
on app_private.secondary_race_change_checks (
  meeting_id,
  source_domain,
  checked_at desc
);

alter table app_private.secondary_race_change_checks enable row level security;
alter table app_private.secondary_race_change_checks force row level security;
revoke all on app_private.secondary_race_change_checks from public, anon, authenticated;

create table if not exists app_private.secondary_race_change_observations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.race_meetings(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  entry_id uuid not null references public.race_entries(id) on delete cascade,
  source_domain text not null,
  source_url text,
  source_observed_at timestamptz not null,
  content_hash text not null,
  change_key text not null,
  change_type text not null check (change_type in ('runner_status', 'jockey_name')),
  race_number integer not null check (race_number > 0),
  saddle_number integer not null check (saddle_number > 0),
  horse_name text not null,
  primary_value jsonb not null,
  secondary_value jsonb not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, source_domain, change_key)
);

create index if not exists secondary_race_change_observations_consensus_idx
on app_private.secondary_race_change_observations (
  meeting_id,
  change_key,
  source_observed_at desc
);

alter table app_private.secondary_race_change_observations enable row level security;
alter table app_private.secondary_race_change_observations force row level security;
revoke all on app_private.secondary_race_change_observations from public, anon, authenticated;

create table if not exists app_private.secondary_race_change_incidents (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.race_meetings(id) on delete cascade,
  change_key text not null,
  fingerprint text not null,
  source_count integer not null check (source_count >= 2),
  sources jsonb not null check (jsonb_typeof(sources) = 'array'),
  difference jsonb not null check (jsonb_typeof(difference) = 'object'),
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (meeting_id, fingerprint)
);

create index if not exists secondary_race_change_incidents_open_idx
on app_private.secondary_race_change_incidents (meeting_id, detected_at desc)
where resolved_at is null;

alter table app_private.secondary_race_change_incidents enable row level security;
alter table app_private.secondary_race_change_incidents force row level security;
revoke all on app_private.secondary_race_change_incidents from public, anon, authenticated;

create or replace function app_private.secondary_race_change_summary(
  target_race_number integer,
  target_saddle_number integer,
  target_horse_name text,
  target_change_type text,
  target_primary_value jsonb,
  target_secondary_value jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case target_change_type
    when 'runner_status' then format(
      'Race %s · #%s %s · status: Formgrids %s → secondary %s',
      target_race_number,
      target_saddle_number,
      target_horse_name,
      coalesce(target_primary_value ->> 'status', 'unknown'),
      coalesce(target_secondary_value ->> 'status', 'unknown')
    )
    when 'jockey_name' then format(
      'Race %s · #%s %s · jockey: Formgrids %s → secondary %s',
      target_race_number,
      target_saddle_number,
      target_horse_name,
      coalesce(target_primary_value ->> 'jockeyName', 'not listed'),
      coalesce(target_secondary_value ->> 'jockeyName', 'not listed')
    )
    else format('Race %s · #%s %s · secondary-source difference', target_race_number, target_saddle_number, target_horse_name)
  end;
$$;

create or replace function app_private.refresh_secondary_race_change_consensus(
  target_meeting_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_row public.race_meetings%rowtype;
  consensus record;
  recipient record;
  incident_id uuid;
  fingerprint_value text;
  difference_summary text;
  source_domains jsonb;
  source_urls jsonb;
  active_fingerprints text[] := array[]::text[];
  created_count integer := 0;
begin
  select * into meeting_row
  from public.race_meetings
  where id = target_meeting_id;

  if meeting_row.id is null then
    raise exception 'The target race meeting was not found.';
  end if;

  for consensus in
    select
      observations.change_key,
      observations.change_type,
      observations.fixture_id,
      observations.entry_id,
      observations.race_number,
      observations.saddle_number,
      observations.horse_name,
      observations.primary_value,
      observations.secondary_value,
      count(distinct observations.source_domain)::integer as source_count,
      jsonb_agg(
        jsonb_build_object(
          'domain', observations.source_domain,
          'url', observations.source_url,
          'observedAt', observations.source_observed_at,
          'contentHash', observations.content_hash
        ) order by observations.source_domain
      ) as sources
    from app_private.secondary_race_change_observations observations
    where observations.meeting_id = target_meeting_id
      and observations.source_observed_at >= now() - interval '30 minutes'
    group by
      observations.change_key,
      observations.change_type,
      observations.fixture_id,
      observations.entry_id,
      observations.race_number,
      observations.saddle_number,
      observations.horse_name,
      observations.primary_value,
      observations.secondary_value
    having count(distinct observations.source_domain) >= 2
  loop
    fingerprint_value := encode(
      extensions.digest(
        convert_to(
          target_meeting_id::text || '|' || consensus.change_key || '|' ||
          consensus.primary_value::text || '|' || consensus.secondary_value::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    active_fingerprints := array_append(active_fingerprints, fingerprint_value);
    difference_summary := app_private.secondary_race_change_summary(
      consensus.race_number,
      consensus.saddle_number,
      consensus.horse_name,
      consensus.change_type,
      consensus.primary_value,
      consensus.secondary_value
    );

    incident_id := null;
    insert into app_private.secondary_race_change_incidents (
      meeting_id,
      change_key,
      fingerprint,
      source_count,
      sources,
      difference
    )
    values (
      target_meeting_id,
      consensus.change_key,
      fingerprint_value,
      consensus.source_count,
      consensus.sources,
      jsonb_build_object(
        'changeType', consensus.change_type,
        'fixtureId', consensus.fixture_id,
        'entryId', consensus.entry_id,
        'raceNumber', consensus.race_number,
        'saddleNumber', consensus.saddle_number,
        'horseName', consensus.horse_name,
        'primaryValue', consensus.primary_value,
        'secondaryValue', consensus.secondary_value,
        'summary', difference_summary
      )
    )
    on conflict (meeting_id, fingerprint) do nothing
    returning id into incident_id;

    update app_private.secondary_race_change_incidents
    set source_count = consensus.source_count,
        sources = consensus.sources,
        updated_at = now(),
        resolved_at = null
    where meeting_id = target_meeting_id
      and fingerprint = fingerprint_value;

    if incident_id is null then
      continue;
    end if;

    select coalesce(jsonb_agg(source_item ->> 'domain'), '[]'::jsonb),
           coalesce(jsonb_agg(source_item ->> 'url'), '[]'::jsonb)
    into source_domains, source_urls
    from jsonb_array_elements(consensus.sources) source_item;

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
        'race_feed_secondary_consensus_review_required',
        'telegram',
        'secondary-race-consensus:' || fingerprint_value,
        jsonb_build_object(
          'reviewKind', 'secondary_consensus',
          'meetingVenue', meeting_row.venue,
          'meetingDate', meeting_row.meeting_date,
          'changeType', 'secondary_source_difference',
          'differenceSummary', difference_summary,
          'sourceDomains', source_domains,
          'sourceUrls', source_urls,
          'adminUrl', 'https://www.mrcracing.co.za/admin/racing/'
        )
      );
      perform app_private.enqueue_in_app_notification(
        recipient.user_id,
        'race_feed_secondary_consensus_review_required',
        'secondary-race-consensus:' || fingerprint_value,
        'Race sources disagree with Formgrids',
        difference_summary || ' Confirmed by ' || consensus.source_count::text || ' comparison sources.'
      );
    end loop;
    created_count := created_count + 1;
  end loop;

  update app_private.secondary_race_change_incidents incidents
  set resolved_at = now(),
      updated_at = now()
  where incidents.meeting_id = target_meeting_id
    and incidents.resolved_at is null
    and not (incidents.fingerprint = any(active_fingerprints));

  return created_count;
end;
$$;

create or replace function public.record_secondary_race_change_list(
  p_meeting_id uuid,
  p_source_domain text,
  p_source_url text,
  p_source_observed_at timestamptz,
  p_content_hash text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_row public.race_meetings%rowtype;
  entry_row public.race_entries%rowtype;
  source_domain_value text;
  item jsonb;
  race_number_value integer;
  saddle_number_value integer;
  horse_name_value text;
  status_value text;
  jockey_name_value text;
  comment_value text;
  change_key_value text;
  changes_seen integer := 0;
  differences_seen integer := 0;
  consensus_created integer := 0;
  unmatched_changes jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Secondary race changes must be a JSON object.';
  end if;

  source_domain_value := app_private.normalize_race_source_domain(p_source_domain);
  if source_domain_value is null or source_domain_value = 'formgrids.info' then
    raise exception 'A non-Formgrids comparison source is required.';
  end if;
  if not exists (
    select 1
    from public.race_source_domains domains
    where domains.domain = source_domain_value
      and domains.status <> 'blocked'
      and not domains.can_auto_approve
  ) then
    raise exception 'The comparison source is not enabled for evidence-only use.';
  end if;
  if p_source_observed_at is null
    or p_source_observed_at > now() + interval '5 minutes'
    or p_source_observed_at < now() - interval '30 minutes'
  then
    raise exception 'Comparison evidence must be fresh.';
  end if;
  if nullif(btrim(coalesce(p_content_hash, '')), '') is null then
    raise exception 'A comparison evidence hash is required.';
  end if;

  select * into meeting_row
  from public.race_meetings
  where id = p_meeting_id
    and not is_test;
  if meeting_row.id is null then
    raise exception 'The target race meeting was not found.';
  end if;

  delete from app_private.secondary_race_change_observations
  where meeting_id = p_meeting_id
    and source_domain = source_domain_value;

  for item in
    select value
    from jsonb_array_elements(
      coalesce(p_changes -> 'statusChanges', '[]'::jsonb) ||
      coalesce(p_changes -> 'scratchings', '[]'::jsonb)
    )
  loop
    changes_seen := changes_seen + 1;
    race_number_value := nullif(item ->> 'raceNumber', '')::integer;
    saddle_number_value := nullif(item ->> 'saddleNumber', '')::integer;
    horse_name_value := nullif(btrim(item ->> 'horseName'), '');
    status_value := lower(nullif(btrim(item ->> 'status'), ''));
    comment_value := nullif(btrim(item ->> 'comment'), '');

    if race_number_value is null or saddle_number_value is null or horse_name_value is null
      or status_value not in ('active', 'reserve', 'scratched', 'withdrawn')
    then
      unmatched_changes := unmatched_changes || jsonb_build_array(
        jsonb_build_object('kind', 'status', 'reason', 'invalid_payload', 'change', item)
      );
      continue;
    end if;

    select entries.* into entry_row
    from public.fixtures fixtures
    join public.race_entries entries on entries.fixture_id = fixtures.id
    where fixtures.meeting_id = p_meeting_id
      and fixtures.race_number = race_number_value
      and entries.saddle_number = saddle_number_value
    limit 1;

    if entry_row.id is null
      or lower(regexp_replace(entry_row.horse_name, '[^a-z0-9]+', '', 'gi'))
        <> lower(regexp_replace(horse_name_value, '[^a-z0-9]+', '', 'gi'))
    then
      unmatched_changes := unmatched_changes || jsonb_build_array(
        jsonb_build_object('kind', 'status', 'reason', 'runner_not_matched', 'change', item)
      );
      continue;
    end if;
    if entry_row.status::text = status_value then
      continue;
    end if;

    change_key_value := 'runner:' || entry_row.id::text || ':status:' || status_value;
    insert into app_private.secondary_race_change_observations (
      meeting_id, fixture_id, entry_id, source_domain, source_url,
      source_observed_at, content_hash, change_key, change_type,
      race_number, saddle_number, horse_name, primary_value,
      secondary_value, detail
    ) values (
      p_meeting_id, entry_row.fixture_id, entry_row.id, source_domain_value,
      p_source_url, p_source_observed_at, p_content_hash, change_key_value,
      'runner_status', race_number_value, saddle_number_value,
      entry_row.horse_name, jsonb_build_object('status', entry_row.status::text),
      jsonb_build_object('status', status_value),
      jsonb_build_object('comment', comment_value)
    )
    on conflict (meeting_id, source_domain, change_key) do update
    set source_url = excluded.source_url,
        source_observed_at = excluded.source_observed_at,
        content_hash = excluded.content_hash,
        primary_value = excluded.primary_value,
        secondary_value = excluded.secondary_value,
        detail = excluded.detail,
        updated_at = now();
    differences_seen := differences_seen + 1;
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_changes -> 'jockeyChanges', '[]'::jsonb))
  loop
    changes_seen := changes_seen + 1;
    race_number_value := nullif(item ->> 'raceNumber', '')::integer;
    saddle_number_value := nullif(item ->> 'saddleNumber', '')::integer;
    horse_name_value := nullif(btrim(item ->> 'horseName'), '');
    jockey_name_value := nullif(btrim(item ->> 'jockeyName'), '');
    comment_value := nullif(btrim(item ->> 'comment'), '');

    if race_number_value is null or saddle_number_value is null
      or horse_name_value is null or jockey_name_value is null
    then
      unmatched_changes := unmatched_changes || jsonb_build_array(
        jsonb_build_object('kind', 'jockey', 'reason', 'invalid_payload', 'change', item)
      );
      continue;
    end if;

    select entries.* into entry_row
    from public.fixtures fixtures
    join public.race_entries entries on entries.fixture_id = fixtures.id
    where fixtures.meeting_id = p_meeting_id
      and fixtures.race_number = race_number_value
      and entries.saddle_number = saddle_number_value
    limit 1;

    if entry_row.id is null
      or lower(regexp_replace(entry_row.horse_name, '[^a-z0-9]+', '', 'gi'))
        <> lower(regexp_replace(horse_name_value, '[^a-z0-9]+', '', 'gi'))
    then
      unmatched_changes := unmatched_changes || jsonb_build_array(
        jsonb_build_object('kind', 'jockey', 'reason', 'runner_not_matched', 'change', item)
      );
      continue;
    end if;
    if lower(regexp_replace(coalesce(entry_row.jockey_name, ''), '[^a-z0-9]+', '', 'gi'))
      = lower(regexp_replace(jockey_name_value, '[^a-z0-9]+', '', 'gi'))
    then
      continue;
    end if;

    change_key_value := 'runner:' || entry_row.id::text || ':jockey:' ||
      lower(regexp_replace(jockey_name_value, '[^a-z0-9]+', '', 'gi'));
    insert into app_private.secondary_race_change_observations (
      meeting_id, fixture_id, entry_id, source_domain, source_url,
      source_observed_at, content_hash, change_key, change_type,
      race_number, saddle_number, horse_name, primary_value,
      secondary_value, detail
    ) values (
      p_meeting_id, entry_row.fixture_id, entry_row.id, source_domain_value,
      p_source_url, p_source_observed_at, p_content_hash, change_key_value,
      'jockey_name', race_number_value, saddle_number_value,
      entry_row.horse_name, jsonb_build_object('jockeyName', entry_row.jockey_name),
      jsonb_build_object('jockeyName', jockey_name_value),
      jsonb_build_object('comment', comment_value)
    )
    on conflict (meeting_id, source_domain, change_key) do update
    set source_url = excluded.source_url,
        source_observed_at = excluded.source_observed_at,
        content_hash = excluded.content_hash,
        primary_value = excluded.primary_value,
        secondary_value = excluded.secondary_value,
        detail = excluded.detail,
        updated_at = now();
    differences_seen := differences_seen + 1;
  end loop;

  consensus_created := app_private.refresh_secondary_race_change_consensus(p_meeting_id);

  insert into app_private.secondary_race_change_checks (
    meeting_id, source_domain, source_url, source_observed_at, status,
    content_hash, changes_seen, differences_seen, consensus_created,
    unmatched_changes
  ) values (
    p_meeting_id, source_domain_value, p_source_url, p_source_observed_at,
    'succeeded', p_content_hash, changes_seen, differences_seen,
    consensus_created, unmatched_changes
  );

  return jsonb_build_object(
    'status', 'observed',
    'sourceDomain', source_domain_value,
    'changesSeen', changes_seen,
    'differencesSeen', differences_seen,
    'consensusCreated', consensus_created,
    'unmatchedChanges', unmatched_changes,
    'raceDataChanged', false
  );
end;
$$;

revoke all on function public.record_secondary_race_change_list(uuid, text, text, timestamptz, text, jsonb)
from public, anon, authenticated;
grant execute on function public.record_secondary_race_change_list(uuid, text, text, timestamptz, text, jsonb)
to service_role;

create or replace function public.record_secondary_race_change_snapshot(
  p_meeting_id uuid,
  p_source_domain text,
  p_source_url text,
  p_source_observed_at timestamptz,
  p_content_hash text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_row public.race_meetings%rowtype;
  snapshot_meeting jsonb;
  status_changes jsonb;
  jockey_changes jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if jsonb_typeof(p_snapshot -> 'meetings') <> 'array'
    or jsonb_array_length(p_snapshot -> 'meetings') <> 1
  then
    raise exception 'A comparison snapshot must contain exactly one meeting.';
  end if;

  select * into meeting_row
  from public.race_meetings
  where id = p_meeting_id
    and not is_test;
  if meeting_row.id is null then
    raise exception 'The target race meeting was not found.';
  end if;

  select value into snapshot_meeting
  from jsonb_array_elements(p_snapshot -> 'meetings')
  limit 1;
  if nullif(snapshot_meeting ->> 'meetingDate', '')::date is distinct from meeting_row.meeting_date
    or lower(regexp_replace(coalesce(snapshot_meeting ->> 'venue', ''), '[^a-z0-9]+', '', 'gi'))
      <> lower(regexp_replace(meeting_row.venue, '[^a-z0-9]+', '', 'gi'))
  then
    raise exception 'The comparison snapshot does not match the target meeting.';
  end if;

  with runner_rows as (
    select
      (race ->> 'raceNumber')::integer as race_number,
      runner
    from jsonb_array_elements(snapshot_meeting -> 'races') race
    cross join lateral jsonb_array_elements(race -> 'runners') runner
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'raceNumber', race_number,
      'saddleNumber', nullif(runner ->> 'saddleNumber', '')::integer,
      'horseName', runner ->> 'horseName',
      'status', lower(runner ->> 'status'),
      'comment', 'Secondary comparison snapshot'
    )) filter (where nullif(runner ->> 'status', '') is not null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'raceNumber', race_number,
      'saddleNumber', nullif(runner ->> 'saddleNumber', '')::integer,
      'horseName', runner ->> 'horseName',
      'jockeyName', runner ->> 'jockeyName',
      'comment', 'Secondary comparison snapshot'
    )) filter (where nullif(btrim(runner ->> 'jockeyName'), '') is not null), '[]'::jsonb)
  into status_changes, jockey_changes
  from runner_rows;

  return public.record_secondary_race_change_list(
    p_meeting_id,
    p_source_domain,
    p_source_url,
    p_source_observed_at,
    p_content_hash,
    jsonb_build_object(
      'statusChanges', status_changes,
      'jockeyChanges', jockey_changes
    )
  );
end;
$$;

revoke all on function public.record_secondary_race_change_snapshot(uuid, text, text, timestamptz, text, jsonb)
from public, anon, authenticated;
grant execute on function public.record_secondary_race_change_snapshot(uuid, text, text, timestamptz, text, jsonb)
to service_role;

create or replace function public.get_secondary_tote_change_targets(
  p_local_date date
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'meetingId', meetings.id,
    'venue', meetings.venue,
    'meetingDate', meetings.meeting_date,
    'cachedSourceUrl', latest.source_url
  ) order by meetings.first_race_at), '[]'::jsonb)
  from public.race_meetings meetings
  left join lateral (
    select checks.source_url
    from app_private.secondary_race_change_checks checks
    where checks.meeting_id = meetings.id
      and checks.source_domain = 'tote.co.za'
      and checks.status = 'succeeded'
      and checks.source_url is not null
    order by checks.checked_at desc
    limit 1
  ) latest on true
  where meetings.meeting_date = p_local_date
    and not meetings.is_test
    and meetings.status in ('scheduled', 'in_progress')
    and meetings.last_race_at >= now() - interval '30 minutes';
$$;

revoke all on function public.get_secondary_tote_change_targets(date)
from public, anon, authenticated;
grant execute on function public.get_secondary_tote_change_targets(date)
to service_role;

create or replace function public.record_secondary_race_change_failure(
  p_meeting_id uuid,
  p_source_domain text,
  p_source_url text,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_domain_value text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  source_domain_value := app_private.normalize_race_source_domain(p_source_domain);
  insert into app_private.secondary_race_change_checks (
    meeting_id, source_domain, source_url, status, error_code, error_message
  ) values (
    p_meeting_id,
    coalesce(source_domain_value, 'unknown-source'),
    p_source_url,
    'failed',
    left(coalesce(nullif(btrim(p_error_code), ''), 'secondary_change_check_failed'), 120),
    left(coalesce(nullif(btrim(p_error_message), ''), 'Unknown comparison-source failure.'), 1000)
  );
  return jsonb_build_object('status', 'recorded');
end;
$$;

revoke all on function public.record_secondary_race_change_failure(uuid, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.record_secondary_race_change_failure(uuid, text, text, text, text)
to service_role;

create or replace function app_private.prefer_formgrids_for_hermes_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  comparison_source text;
begin
  if new.task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh')
    and coalesce(new.task_payload ->> 'provider', '') = 'hermes'
    and coalesce((new.task_payload ->> 'delegate_to_hermes')::boolean, false)
  then
    if coalesce((new.task_payload ->> 'comparison_only')::boolean, false) then
      comparison_source := app_private.normalize_race_source_domain(
        new.task_payload ->> 'comparison_source'
      );
      if comparison_source is null or comparison_source = 'formgrids.info' then
        raise exception 'Comparison tasks require one non-Formgrids source.';
      end if;
      new.task_payload := jsonb_set(
        new.task_payload,
        '{permitted_sources}',
        jsonb_build_array(comparison_source),
        true
      );
    else
      new.task_payload := jsonb_set(
        jsonb_set(
          new.task_payload,
          '{permitted_sources}',
          jsonb_build_array('formgrids.info'),
          true
        ),
        '{primary_source}',
        to_jsonb('formgrids.info'::text),
        true
      );
    end if;
  end if;
  return new;
end;
$$;

update public.race_feed_tasks
set task_payload = jsonb_set(
      jsonb_set(
        task_payload,
        '{permitted_sources}',
        jsonb_build_array('formgrids.info'),
        true
      ),
      '{primary_source}',
      to_jsonb('formgrids.info'::text),
      true
    ),
    updated_at = now()
where state = 'pending'
  and task_type in ('weekly_calendar', 'meeting_schedule', 'race_detail', 'result_refresh')
  and coalesce(task_payload ->> 'provider', '') = 'hermes'
  and coalesce((task_payload ->> 'delegate_to_hermes')::boolean, false)
  and not coalesce((task_payload ->> 'comparison_only')::boolean, false);

create or replace function app_private.queue_secondary_race_comparisons()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  target record;
  time_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
  inserted_count integer := 0;
begin
  if (now() at time zone 'Africa/Johannesburg')::time < time '05:00'
    or (now() at time zone 'Africa/Johannesburg')::time > time '21:00'
  then
    return 0;
  end if;

  source_id_value := app_private.ensure_hermes_local_source();
  for target in
    select meetings.id, meetings.venue, meetings.meeting_date
    from public.race_meetings meetings
    where meetings.meeting_date = (now() at time zone 'Africa/Johannesburg')::date
      and not meetings.is_test
      and meetings.status in ('scheduled', 'in_progress')
      and meetings.last_race_at >= now() - interval '30 minutes'
  loop
    insert into public.race_feed_tasks (
      source_id, task_key, task_type, meeting_id, venue, meeting_date,
      task_payload, due_at, max_attempts
    ) values (
      source_id_value,
      'secondary-comparison:' || target.id::text || ':raceform.co.za:' || time_bucket::text,
      'meeting_schedule',
      target.id,
      target.venue,
      target.meeting_date,
      jsonb_build_object(
        'provider', 'hermes',
        'delegate_to_hermes', true,
        'comparison_only', true,
        'primary_source', 'formgrids.info',
        'comparison_source', 'raceform.co.za',
        'permitted_sources', jsonb_build_array('raceform.co.za')
      ),
      now(),
      4
    )
    on conflict (task_key) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function app_private.queue_secondary_race_comparisons()
from public, anon, authenticated, service_role;

create or replace function app_private.process_race_feed_proposal_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hermes_confidence numeric;
  evidence_is_approved boolean := false;
  formgrids_only boolean := false;
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

  select
    coalesce(bool_and(domains.status = 'approved' and domains.can_auto_approve), false),
    count(*) > 0 and bool_and(domains.domain = 'formgrids.info')
  into evidence_is_approved, formgrids_only
  from public.race_feed_evidence evidence
  join public.race_source_domains domains on domains.id = evidence.domain_id
  where evidence.proposal_id = new.id;

  if new.apply_result is null
    and new.change_type in ('new_meeting', 'routine_change')
    and formgrids_only
    and hermes_confidence >= 0.90
    and not new.has_critical_conflict
    and app_private.race_feed_snapshot_is_complete(new.snapshot)
  then
    apply_result_value := app_private.apply_race_snapshot(
      new.run_id,
      new.source_id,
      new.snapshot,
      false
    );
    update public.race_feed_proposals
    set confidence_breakdown = coalesce(confidence_breakdown, '{}'::jsonb) || jsonb_build_object(
          'primarySource', 'formgrids.info',
          'authoritativePrimaryBypass', true,
          'secondarySourcesCanAutoApply', false
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

  if new.apply_result is null
    and hermes_confidence = 1
    and evidence_is_approved
    and not new.has_critical_conflict
    and app_private.race_feed_snapshot_is_complete(new.snapshot)
  then
    apply_result_value := app_private.apply_race_snapshot(
      new.run_id,
      new.source_id,
      new.snapshot,
      false
    );
    update public.race_feed_proposals
    set confidence_score = 100,
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

revoke all on function app_private.process_race_feed_proposal_gate()
from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mrc-sync-official-tote-card-changes') then
    perform cron.unschedule('mrc-sync-official-tote-card-changes');
  end if;
  if exists (select 1 from cron.job where jobname = 'mrc-check-official-tote-freshness') then
    perform cron.unschedule('mrc-check-official-tote-freshness');
  end if;
  if exists (select 1 from cron.job where jobname = 'mrc-sync-secondary-tote-changes') then
    perform cron.unschedule('mrc-sync-secondary-tote-changes');
  end if;
  perform cron.schedule(
    'mrc-sync-secondary-tote-changes',
    '*/3 3-18 * * *',
    $cron$
      select net.http_post(
        url := 'https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/sync-race-data',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-mrc-worker-token', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'mrc_race_worker_token'
            limit 1
          )
        ),
        body := jsonb_build_object('trigger', 'cron', 'mode', 'secondary_changes'),
        timeout_milliseconds := 45000
      );
    $cron$
  );

  if exists (select 1 from cron.job where jobname = 'mrc-queue-secondary-race-comparisons') then
    perform cron.unschedule('mrc-queue-secondary-race-comparisons');
  end if;
  perform cron.schedule(
    'mrc-queue-secondary-race-comparisons',
    '*/10 * * * *',
    'select app_private.queue_secondary_race_comparisons();'
  );
end;
$$;

comment on function public.record_secondary_race_change_list(uuid, text, text, timestamptz, text, jsonb) is
  'Records fresh comparison-only runner differences without mutating Formgrids-backed race data; two matching source domains open a review alert.';

comment on function public.record_secondary_race_change_snapshot(uuid, text, text, timestamptz, text, jsonb) is
  'Normalizes a single-source comparison snapshot into evidence-only differences and never publishes it.';

comment on function app_private.queue_secondary_race_comparisons() is
  'Queues isolated Raceform comparison jobs; ordinary publishing jobs remain Formgrids-only.';
