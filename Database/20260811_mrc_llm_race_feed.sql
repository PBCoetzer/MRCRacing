create extension if not exists pg_net with schema extensions;

alter table public.fixtures
  add column if not exists selection_lock_at timestamptz;

update public.fixtures
set selection_lock_at = coalesce(selection_lock_at, original_starts_at, starts_at)
where selection_lock_at is null;

alter table public.fixtures
  alter column selection_lock_at set not null;

alter table public.race_entries
  add column if not exists source_name text not null default 'manual',
  add column if not exists source_updated_at timestamptz;

alter table public.race_entries
  drop constraint if exists race_entries_status_check;

alter table public.race_entries
  add constraint race_entries_status_check
  check (status in ('active', 'scratched', 'withdrawn'));

create unique index if not exists race_entries_fixture_external_id_uidx
on public.race_entries (fixture_id, external_id)
where external_id is not null;

create table if not exists public.race_feed_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  source_name text not null,
  source_url text not null unique check (source_url ~ '^https://'),
  venue_hint text,
  extraction_hint text,
  content_start_marker text,
  content_end_marker text,
  is_enabled boolean not null default true,
  last_etag text,
  last_modified text,
  last_content_hash text,
  last_http_status integer,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.race_feed_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.race_feed_sources(id) on delete cascade,
  trigger_type text not null default 'cron'
    check (trigger_type in ('cron', 'manual', 'retry')),
  status text not null default 'running'
    check (status in ('running', 'unchanged', 'succeeded', 'failed', 'quarantined', 'rejected', 'skipped')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  http_status integer,
  source_changed boolean not null default false,
  llm_called boolean not null default false,
  model_name text,
  content_hash text,
  meetings_seen integer not null default 0 check (meetings_seen >= 0),
  races_seen integer not null default 0 check (races_seen >= 0),
  entries_seen integer not null default 0 check (entries_seen >= 0),
  changes_applied integer not null default 0 check (changes_applied >= 0),
  alerts_created integer not null default 0 check (alerts_created >= 0),
  extracted_payload jsonb,
  error_code text,
  error_message text,
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.race_change_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.race_feed_runs(id) on delete cascade,
  source_id uuid not null references public.race_feed_sources(id) on delete cascade,
  meeting_id uuid not null references public.race_meetings(id) on delete cascade,
  fixture_id uuid references public.fixtures(id) on delete cascade,
  entry_id uuid references public.race_entries(id) on delete cascade,
  entity_type text not null check (entity_type in ('meeting', 'race', 'runner', 'result')),
  change_type text not null check (change_type in ('created', 'updated', 'cancelled', 'resulted')),
  changed_fields text[] not null default '{}'::text[],
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  summary text not null,
  is_material boolean not null default true,
  source_updated_at timestamptz,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tip_card_change_alerts (
  id uuid primary key default gen_random_uuid(),
  change_event_id uuid not null references public.race_change_events(id) on delete cascade,
  tip_card_id uuid not null references public.tip_cards(id) on delete cascade,
  fixture_id uuid references public.fixtures(id) on delete set null,
  entry_id uuid references public.race_entries(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'acknowledged', 'resolved', 'locked')),
  is_after_lock boolean not null default false,
  notified_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledgement_note text,
  resolved_at timestamptz,
  resolved_revision integer check (resolved_revision is null or resolved_revision > 0),
  created_at timestamptz not null default now(),
  unique (change_event_id, tip_card_id)
);

create table if not exists app_private.race_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists race_feed_sources_enabled_idx
on public.race_feed_sources (is_enabled, last_checked_at);

create index if not exists race_feed_sources_created_by_idx
on public.race_feed_sources (created_by)
where created_by is not null;

create index if not exists race_feed_runs_source_started_idx
on public.race_feed_runs (source_id, started_at desc);

create index if not exists race_feed_runs_status_started_idx
on public.race_feed_runs (status, started_at desc);

create index if not exists race_feed_runs_reviewed_by_idx
on public.race_feed_runs (reviewed_by)
where reviewed_by is not null;

create index if not exists race_change_events_run_idx
on public.race_change_events (run_id);

create index if not exists race_change_events_source_idx
on public.race_change_events (source_id);

create index if not exists race_change_events_meeting_created_idx
on public.race_change_events (meeting_id, created_at desc);

create index if not exists race_change_events_fixture_created_idx
on public.race_change_events (fixture_id, created_at desc)
where fixture_id is not null;

create index if not exists race_change_events_entry_idx
on public.race_change_events (entry_id)
where entry_id is not null;

create index if not exists tip_card_change_alerts_card_status_idx
on public.tip_card_change_alerts (tip_card_id, status, created_at desc);

create index if not exists tip_card_change_alerts_fixture_idx
on public.tip_card_change_alerts (fixture_id)
where fixture_id is not null;

create index if not exists tip_card_change_alerts_entry_idx
on public.tip_card_change_alerts (entry_id)
where entry_id is not null;

create index if not exists tip_card_change_alerts_acknowledged_by_idx
on public.tip_card_change_alerts (acknowledged_by)
where acknowledged_by is not null;

drop trigger if exists set_race_feed_sources_updated_at on public.race_feed_sources;
create trigger set_race_feed_sources_updated_at
before update on public.race_feed_sources
for each row execute function public.set_updated_at();

create or replace function app_private.preserve_fixture_selection_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.selection_lock_at := coalesce(new.selection_lock_at, new.starts_at);
    return new;
  end if;

  if new.starts_at is distinct from old.starts_at then
    if exists (
      select 1
      from public.tip_cards
      where meeting_id = new.meeting_id
        and status in ('published', 'settled')
    ) then
      new.selection_lock_at := least(
        coalesce(old.selection_lock_at, old.starts_at),
        new.starts_at
      );
    else
      new.selection_lock_at := new.starts_at;
    end if;
  else
    new.selection_lock_at := coalesce(new.selection_lock_at, old.selection_lock_at, new.starts_at);
  end if;

  return new;
end;
$$;

drop trigger if exists preserve_fixture_selection_lock on public.fixtures;
create trigger preserve_fixture_selection_lock
before insert or update of starts_at, selection_lock_at on public.fixtures
for each row execute function app_private.preserve_fixture_selection_lock();

create or replace function app_private.enforce_race_tip_selection_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_card_id uuid := coalesce(new.tip_card_id, old.tip_card_id);
  target_fixture_id uuid := coalesce(new.fixture_id, old.fixture_id);
  card_status public.tip_card_status;
  lock_at timestamptz;
begin
  select status
  into card_status
  from public.tip_cards
  where id = target_card_id;

  if card_status <> 'published' then
    return coalesce(new, old);
  end if;

  select selection_lock_at
  into lock_at
  from public.fixtures
  where id = target_fixture_id;

  if lock_at <= now() then
    raise exception 'This race selection is locked because its cutoff has passed.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists enforce_race_tip_selection_lock on public.race_tip_selections;
create trigger enforce_race_tip_selection_lock
before insert or update or delete on public.race_tip_selections
for each row execute function app_private.enforce_race_tip_selection_lock();

create or replace function app_private.enforce_tip_multiple_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_card_id uuid := coalesce(new.tip_card_id, old.tip_card_id);
  target_bet_option_id uuid := coalesce(new.bet_option_id, old.bet_option_id);
  card_status public.tip_card_status;
  lock_at timestamptz;
begin
  select status
  into card_status
  from public.tip_cards
  where id = target_card_id;

  if card_status <> 'published' then
    return coalesce(new, old);
  end if;

  select cutoff_at
  into lock_at
  from public.meeting_bet_options
  where id = target_bet_option_id;

  if lock_at <= now() then
    raise exception 'This Exotic or Multiple is locked because its cutoff has passed.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists enforce_tip_multiple_lock on public.tip_card_multiples;
create trigger enforce_tip_multiple_lock
before insert or update or delete on public.tip_card_multiples
for each row execute function app_private.enforce_tip_multiple_lock();

create or replace function app_private.enforce_tip_multiple_selection_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_multiple_id uuid := coalesce(new.multiple_id, old.multiple_id);
  target_fixture_id uuid := coalesce(new.fixture_id, old.fixture_id);
  card_status public.tip_card_status;
  lock_at timestamptz;
begin
  select
    c.status,
    least(o.cutoff_at, f.selection_lock_at)
  into card_status, lock_at
  from public.tip_card_multiples m
  join public.tip_cards c on c.id = m.tip_card_id
  join public.meeting_bet_options o on o.id = m.bet_option_id
  join public.fixtures f on f.id = target_fixture_id
  where m.id = target_multiple_id;

  if card_status = 'published' and lock_at <= now() then
    raise exception 'This Exotic or Multiple selection is locked because its cutoff has passed.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists enforce_tip_multiple_selection_lock on public.tip_card_multiple_selections;
create trigger enforce_tip_multiple_selection_lock
before insert or update or delete on public.tip_card_multiple_selections
for each row execute function app_private.enforce_tip_multiple_selection_lock();

create or replace function app_private.verify_race_worker_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.race_worker_tokens
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and is_active = true
      and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.verify_race_worker_request(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    return false;
  end if;

  return app_private.verify_race_worker_token(p_token);
end;
$$;

create or replace function app_private.card_change_is_editable(
  target_tip_card_id uuid,
  target_fixture_id uuid,
  target_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.race_tip_selections s
      join public.fixtures f on f.id = s.fixture_id
      where s.tip_card_id = target_tip_card_id
        and (target_fixture_id is null or s.fixture_id = target_fixture_id)
        and (
          target_entry_id is null
          or s.winner_entry_id = target_entry_id
          or s.place_entry_id = target_entry_id
        )
        and f.selection_lock_at > now()
    )
    or exists (
      select 1
      from public.tip_card_multiples m
      join public.meeting_bet_options o on o.id = m.bet_option_id
      where m.tip_card_id = target_tip_card_id
        and o.cutoff_at > now()
        and (
          o.bet_type = 'other'
          or target_fixture_id is null
          or exists (
            select 1
            from public.meeting_bet_legs l
            where l.bet_option_id = o.id
              and l.fixture_id = target_fixture_id
          )
        )
    );
$$;

create or replace function app_private.queue_tipster_race_change_alerts(target_change_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.race_change_events%rowtype;
  target record;
  alert_id uuid;
  alert_count integer := 0;
  is_editable boolean;
  alert_status text;
  alert_title text;
  alert_body text;
begin
  select *
  into event_row
  from public.race_change_events
  where id = target_change_event_id;

  if event_row.id is null or not event_row.is_material then
    return 0;
  end if;

  for target in
    select distinct
      c.id as tip_card_id,
      c.title as card_title,
      c.revision,
      t.user_id as tipster_user_id,
      t.display_name as tipster_name,
      m.venue,
      m.meeting_date,
      f.race_number,
      coalesce(p.email_notifications_enabled, true) as email_notifications_enabled
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    join public.race_meetings m on m.id = c.meeting_id
    left join public.fixtures f on f.id = event_row.fixture_id
    left join public.profiles p on p.id = t.user_id
    where c.meeting_id = event_row.meeting_id
      and c.status = 'published'
      and (
        event_row.entity_type = 'meeting'
        or exists (
          select 1
          from public.race_tip_selections s
          where s.tip_card_id = c.id
            and s.fixture_id = event_row.fixture_id
            and (
              event_row.entry_id is null
              or s.winner_entry_id = event_row.entry_id
              or s.place_entry_id = event_row.entry_id
            )
        )
        or exists (
          select 1
          from public.tip_card_multiples tm
          join public.meeting_bet_options mbo on mbo.id = tm.bet_option_id
          where tm.tip_card_id = c.id
            and (
              mbo.bet_type = 'other'
              or exists (
                select 1
                from public.meeting_bet_legs mbl
                where mbl.bet_option_id = mbo.id
                  and mbl.fixture_id = event_row.fixture_id
              )
            )
        )
      )
  loop
    is_editable := app_private.card_change_is_editable(
      target.tip_card_id,
      event_row.fixture_id,
      event_row.entry_id
    );
    alert_status := case when is_editable then 'pending' else 'locked' end;

    insert into public.tip_card_change_alerts (
      change_event_id,
      tip_card_id,
      fixture_id,
      entry_id,
      status,
      is_after_lock,
      notified_at
    )
    values (
      event_row.id,
      target.tip_card_id,
      event_row.fixture_id,
      event_row.entry_id,
      alert_status,
      not is_editable,
      now()
    )
    on conflict (change_event_id, tip_card_id) do nothing
    returning id into alert_id;

    if alert_id is null then
      continue;
    end if;

    alert_title := case
      when is_editable then 'Race data changed — review required'
      else 'Race data changed after the tip locked'
    end;
    alert_body := event_row.summary || case
      when is_editable then ' Review the affected tip before its cutoff.'
      else ' The affected tip remains locked.'
    end;

    insert into public.notifications (user_id, title, body)
    values (target.tipster_user_id, alert_title, alert_body);

    if target.email_notifications_enabled then
      perform app_private.enqueue_notification(
        target.tipster_user_id,
        'tip_card_race_data_changed',
        'race-change:' || event_row.id::text ||
          ':tip-card:' || target.tip_card_id::text ||
          ':user:' || target.tipster_user_id::text ||
          ':email',
        jsonb_build_object(
          'template', 'tip_card_race_data_changed',
          'tipCardId', target.tip_card_id,
          'revision', target.revision,
          'cardTitle', target.card_title,
          'tipsterName', target.tipster_name,
          'meetingVenue', target.venue,
          'meetingDate', target.meeting_date,
          'raceNumber', target.race_number,
          'changeSummary', event_row.summary,
          'changedFields', event_row.changed_fields,
          'beforeValues', event_row.before_values,
          'afterValues', event_row.after_values,
          'isAfterLock', not is_editable,
          'tipsterUrl', 'https://www.mrcracing.co.za/tipster/manage-tips/?card=' || target.tip_card_id::text
        )
      );
    end if;

    alert_count := alert_count + 1;
    alert_id := null;
  end loop;

  return alert_count;
end;
$$;

create or replace function app_private.record_race_change(
  target_run_id uuid,
  target_source_id uuid,
  target_meeting_id uuid,
  target_fixture_id uuid,
  target_entry_id uuid,
  target_entity_type text,
  target_change_type text,
  target_changed_fields text[],
  target_before_values jsonb,
  target_after_values jsonb,
  target_summary text,
  target_source_updated_at timestamptz,
  target_is_material boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_id uuid;
  alert_count integer := 0;
  fingerprint_value text;
begin
  fingerprint_value := md5(
    target_source_id::text || ':' ||
    coalesce(target_meeting_id::text, '') || ':' ||
    coalesce(target_fixture_id::text, '') || ':' ||
    coalesce(target_entry_id::text, '') || ':' ||
    coalesce(target_before_values, '{}'::jsonb)::text || ':' ||
    coalesce(target_after_values, '{}'::jsonb)::text
  );

  insert into public.race_change_events (
    run_id,
    source_id,
    meeting_id,
    fixture_id,
    entry_id,
    entity_type,
    change_type,
    changed_fields,
    before_values,
    after_values,
    summary,
    is_material,
    source_updated_at,
    fingerprint
  )
  values (
    target_run_id,
    target_source_id,
    target_meeting_id,
    target_fixture_id,
    target_entry_id,
    target_entity_type,
    target_change_type,
    coalesce(target_changed_fields, '{}'::text[]),
    coalesce(target_before_values, '{}'::jsonb),
    coalesce(target_after_values, '{}'::jsonb),
    target_summary,
    target_is_material,
    target_source_updated_at,
    fingerprint_value
  )
  on conflict (fingerprint) do nothing
  returning id into change_id;

  if change_id is not null and target_is_material then
    alert_count := app_private.queue_tipster_race_change_alerts(change_id);
  end if;

  return jsonb_build_object(
    'changeId', change_id,
    'inserted', change_id is not null,
    'alertsCreated', alert_count
  );
end;
$$;

create or replace function app_private.apply_race_snapshot(
  target_run_id uuid,
  target_source_id uuid,
  target_snapshot jsonb,
  force_quarantined boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
<<snapshot_apply>>
declare
  source_row public.race_feed_sources%rowtype;
  run_row public.race_feed_runs%rowtype;
  sport_id_value uuid;
  snapshot_at timestamptz;
  meeting_item jsonb;
  race_item jsonb;
  runner_item jsonb;
  meeting_row public.race_meetings%rowtype;
  fixture_row public.fixtures%rowtype;
  entry_row public.race_entries%rowtype;
  meeting_external_id text;
  race_external_id text;
  runner_external_id text;
  incoming_meeting_status text;
  incoming_race_status text;
  incoming_runner_status text;
  incoming_first_race_at timestamptz;
  incoming_last_race_at timestamptz;
  incoming_starts_at timestamptz;
  incoming_source_updated_at timestamptz;
  incoming_result_summary text;
  incoming_result_position integer;
  incoming_saddle_number integer;
  incoming_draw integer;
  incoming_weight numeric(5, 1);
  before_values jsonb;
  after_values jsonb;
  changed_fields text[];
  record_result jsonb;
  meetings_seen integer := 0;
  races_seen integer := 0;
  entries_seen integer := 0;
  changes_applied integer := 0;
  alerts_created integer := 0;
  destructive_changes integer := 0;
  quarantine_reason text;
  started_milliseconds bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('mrc-race-feed-ingest')) then
    raise exception 'Another race-feed ingestion is already running.';
  end if;

  select *
  into source_row
  from public.race_feed_sources
  where id = target_source_id;

  select *
  into run_row
  from public.race_feed_runs
  where id = target_run_id
    and source_id = target_source_id
  for update;

  if source_row.id is null or run_row.id is null then
    raise exception 'Race-feed source or run was not found.';
  end if;

  if jsonb_typeof(target_snapshot -> 'meetings') <> 'array'
    or jsonb_array_length(target_snapshot -> 'meetings') = 0
  then
    raise exception 'The normalized snapshot must contain at least one meeting.';
  end if;

  select id
  into sport_id_value
  from public.sports
  where slug = 'horse-racing'
  limit 1;

  if sport_id_value is null then
    raise exception 'Horse racing sport configuration is missing.';
  end if;

  snapshot_at := coalesce(
    nullif(target_snapshot ->> 'snapshotAt', '')::timestamptz,
    now()
  );
  started_milliseconds := floor(extract(epoch from run_row.started_at) * 1000)::bigint;

  for meeting_item in
    select value from jsonb_array_elements(target_snapshot -> 'meetings')
  loop
    meeting_external_id := nullif(btrim(meeting_item ->> 'externalId'), '');

    if meeting_external_id is null
      or nullif(btrim(meeting_item ->> 'venue'), '') is null
      or nullif(meeting_item ->> 'meetingDate', '') is null
      or jsonb_typeof(meeting_item -> 'races') <> 'array'
      or jsonb_array_length(meeting_item -> 'races') = 0
    then
      raise exception 'A meeting is missing its identity, venue, date, or races.';
    end if;

    if (
      select count(distinct (race_value ->> 'raceNumber')::integer)
      from jsonb_array_elements(meeting_item -> 'races') race_value
    ) <> jsonb_array_length(meeting_item -> 'races') then
      raise exception 'A meeting contains duplicate race numbers.';
    end if;

    select min((race_value ->> 'startsAt')::timestamptz),
           max((race_value ->> 'startsAt')::timestamptz)
    into incoming_first_race_at, incoming_last_race_at
    from jsonb_array_elements(meeting_item -> 'races') race_value;

    select *
    into meeting_row
    from public.race_meetings
    where source_name = source_row.source_name
      and external_id = meeting_external_id;

    if meeting_row.id is not null and (
      lower(meeting_row.venue) <> lower(btrim(meeting_item ->> 'venue'))
      or meeting_row.meeting_date <> (meeting_item ->> 'meetingDate')::date
    ) then
      destructive_changes := destructive_changes + 1;
      quarantine_reason := 'The source attempted to change an existing meeting venue or date.';
    end if;

    for race_item in
      select value from jsonb_array_elements(meeting_item -> 'races')
    loop
      race_external_id := nullif(btrim(race_item ->> 'externalId'), '');

      if race_external_id is null
        or coalesce((race_item ->> 'raceNumber')::integer, 0) <= 0
        or nullif(race_item ->> 'startsAt', '') is null
        or jsonb_typeof(race_item -> 'runners') <> 'array'
      then
        raise exception 'A race is missing its identity, number, time, or runners.';
      end if;

      if (
        select count(distinct (runner_value ->> 'saddleNumber')::integer)
        from jsonb_array_elements(race_item -> 'runners') runner_value
      ) <> jsonb_array_length(race_item -> 'runners') then
        raise exception 'A race contains duplicate saddle numbers.';
      end if;

      if meeting_row.id is not null then
        select *
        into fixture_row
        from public.fixtures
        where meeting_id = meeting_row.id
          and (
            (source_name = source_row.source_name and external_id = race_external_id)
            or race_number = (race_item ->> 'raceNumber')::integer
          )
        order by case when external_id = race_external_id then 0 else 1 end
        limit 1;

        incoming_result_summary := nullif(btrim(race_item ->> 'resultSummary'), '');

        if fixture_row.id is not null
          and fixture_row.result_summary is not null
          and incoming_result_summary is not null
          and fixture_row.result_summary <> incoming_result_summary
        then
          destructive_changes := destructive_changes + 1;
          quarantine_reason := 'The source attempted to replace an existing official result.';
        end if;

        for runner_item in
          select value from jsonb_array_elements(race_item -> 'runners')
        loop
          if fixture_row.id is null then
            continue;
          end if;

          runner_external_id := nullif(btrim(runner_item ->> 'externalId'), '');
          incoming_saddle_number := (runner_item ->> 'saddleNumber')::integer;

          select *
          into entry_row
          from public.race_entries
          where fixture_id = fixture_row.id
            and (
              (runner_external_id is not null and external_id = runner_external_id)
              or saddle_number = incoming_saddle_number
            )
          order by case when external_id = runner_external_id then 0 else 1 end
          limit 1;

          if entry_row.id is not null
            and lower(entry_row.horse_name) <> lower(btrim(runner_item ->> 'horseName'))
          then
            destructive_changes := destructive_changes + 1;
            if destructive_changes > 2 then
              quarantine_reason := 'The source attempted to replace several runner identities.';
            end if;
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  if destructive_changes > 0 and not force_quarantined then
    update public.race_feed_runs
    set
      status = 'quarantined',
      completed_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from now()) * 1000)::bigint - started_milliseconds)::integer,
      extracted_payload = target_snapshot,
      error_code = 'anomalous_change',
      error_message = coalesce(quarantine_reason, 'The source contained an anomalous destructive change.'),
      meetings_seen = jsonb_array_length(target_snapshot -> 'meetings')
    where id = target_run_id;

    return jsonb_build_object(
      'status', 'quarantined',
      'reason', coalesce(quarantine_reason, 'The source contained an anomalous destructive change.'),
      'changesApplied', 0,
      'alertsCreated', 0
    );
  end if;

  for meeting_item in
    select value from jsonb_array_elements(target_snapshot -> 'meetings')
  loop
    meetings_seen := meetings_seen + 1;
    meeting_external_id := btrim(meeting_item ->> 'externalId');
    incoming_meeting_status := lower(coalesce(nullif(meeting_item ->> 'status', ''), 'scheduled'));

    if incoming_meeting_status not in ('scheduled', 'in_progress', 'completed', 'cancelled') then
      raise exception 'Meeting status % is invalid.', incoming_meeting_status;
    end if;

    select min((race_value ->> 'startsAt')::timestamptz),
           max((race_value ->> 'startsAt')::timestamptz)
    into incoming_first_race_at, incoming_last_race_at
    from jsonb_array_elements(meeting_item -> 'races') race_value;

    select *
    into meeting_row
    from public.race_meetings
    where source_name = source_row.source_name
      and external_id = meeting_external_id
    for update;

    if meeting_row.id is null then
      insert into public.race_meetings (
        sport_id,
        external_id,
        venue,
        country_code,
        meeting_date,
        first_race_at,
        last_race_at,
        status,
        is_test,
        source_name,
        source_url,
        source_updated_at,
        source_payload
      )
      values (
        sport_id_value,
        meeting_external_id,
        btrim(meeting_item ->> 'venue'),
        upper(coalesce(nullif(meeting_item ->> 'countryCode', ''), 'ZA')),
        (meeting_item ->> 'meetingDate')::date,
        incoming_first_race_at,
        incoming_last_race_at,
        incoming_meeting_status::public.race_meeting_status,
        false,
        source_row.source_name,
        source_row.source_url,
        snapshot_at,
        meeting_item
      )
      returning * into meeting_row;
    else
      before_values := jsonb_build_object(
        'status', meeting_row.status,
        'firstRaceAt', meeting_row.first_race_at,
        'lastRaceAt', meeting_row.last_race_at
      );
      after_values := jsonb_build_object(
        'status', incoming_meeting_status,
        'firstRaceAt', incoming_first_race_at,
        'lastRaceAt', incoming_last_race_at
      );
      changed_fields := '{}'::text[];

      if meeting_row.status::text <> incoming_meeting_status then
        changed_fields := array_append(changed_fields, 'status');
      end if;
      if meeting_row.first_race_at is distinct from incoming_first_race_at then
        changed_fields := array_append(changed_fields, 'firstRaceAt');
      end if;
      if meeting_row.last_race_at is distinct from incoming_last_race_at then
        changed_fields := array_append(changed_fields, 'lastRaceAt');
      end if;

      update public.race_meetings
      set
        first_race_at = incoming_first_race_at,
        last_race_at = incoming_last_race_at,
        status = incoming_meeting_status::public.race_meeting_status,
        source_url = source_row.source_url,
        source_updated_at = snapshot_at,
        source_payload = meeting_item
      where id = meeting_row.id
      returning * into meeting_row;

      if cardinality(changed_fields) > 0 then
        record_result := app_private.record_race_change(
          target_run_id,
          target_source_id,
          meeting_row.id,
          null,
          null,
          'meeting',
          case when incoming_meeting_status = 'cancelled' then 'cancelled' else 'updated' end,
          changed_fields,
          before_values,
          after_values,
          meeting_row.venue || ' meeting changed: ' || array_to_string(changed_fields, ', ') || '.',
          snapshot_at,
          true
        );
        if coalesce((record_result ->> 'inserted')::boolean, false) then
          changes_applied := changes_applied + 1;
          alerts_created := alerts_created + coalesce((record_result ->> 'alertsCreated')::integer, 0);
        end if;
      end if;
    end if;

    for race_item in
      select value from jsonb_array_elements(meeting_item -> 'races')
    loop
      races_seen := races_seen + 1;
      race_external_id := btrim(race_item ->> 'externalId');
      incoming_starts_at := (race_item ->> 'startsAt')::timestamptz;
      incoming_race_status := lower(coalesce(nullif(race_item ->> 'status', ''), 'scheduled'));
      incoming_result_summary := nullif(btrim(race_item ->> 'resultSummary'), '');
      incoming_source_updated_at := coalesce(
        nullif(race_item ->> 'sourceUpdatedAt', '')::timestamptz,
        snapshot_at
      );

      if incoming_race_status not in ('scheduled', 'in_progress', 'completed', 'cancelled', 'abandoned', 'delayed') then
        raise exception 'Race status % is invalid.', incoming_race_status;
      end if;

      select *
      into fixture_row
      from public.fixtures
      where meeting_id = meeting_row.id
        and (
          (source_name = source_row.source_name and external_id = race_external_id)
          or race_number = (race_item ->> 'raceNumber')::integer
        )
      order by case when external_id = race_external_id then 0 else 1 end
      limit 1
      for update;

      if fixture_row.id is null then
        insert into public.fixtures (
          sport_id,
          meeting_id,
          external_id,
          race_number,
          league,
          title,
          venue,
          starts_at,
          selection_lock_at,
          distance_m,
          race_class,
          status,
          result_summary,
          source_name,
          source_url,
          source_updated_at,
          source_payload
        )
        values (
          sport_id_value,
          meeting_row.id,
          race_external_id,
          (race_item ->> 'raceNumber')::integer,
          'South African Horse Racing',
          coalesce(nullif(btrim(race_item ->> 'title'), ''), 'Race ' || (race_item ->> 'raceNumber')),
          meeting_row.venue,
          incoming_starts_at,
          incoming_starts_at,
          nullif(race_item ->> 'distanceMetres', '')::integer,
          nullif(btrim(race_item ->> 'raceClass'), ''),
          incoming_race_status,
          incoming_result_summary,
          source_row.source_name,
          source_row.source_url,
          incoming_source_updated_at,
          race_item
        )
        returning * into fixture_row;

        record_result := app_private.record_race_change(
          target_run_id,
          target_source_id,
          meeting_row.id,
          fixture_row.id,
          null,
          'race',
          'created',
          array['race'],
          '{}'::jsonb,
          jsonb_build_object('raceNumber', fixture_row.race_number, 'startsAt', fixture_row.starts_at),
          meeting_row.venue || ' Race ' || fixture_row.race_number || ' was added.',
          incoming_source_updated_at,
          true
        );
        if coalesce((record_result ->> 'inserted')::boolean, false) then
          changes_applied := changes_applied + 1;
          alerts_created := alerts_created + coalesce((record_result ->> 'alertsCreated')::integer, 0);
        end if;
      else
        before_values := jsonb_build_object(
          'title', fixture_row.title,
          'startsAt', fixture_row.starts_at,
          'distanceMetres', fixture_row.distance_m,
          'raceClass', fixture_row.race_class,
          'status', fixture_row.status,
          'resultSummary', fixture_row.result_summary
        );
        after_values := jsonb_build_object(
          'title', coalesce(nullif(btrim(race_item ->> 'title'), ''), fixture_row.title),
          'startsAt', incoming_starts_at,
          'distanceMetres', coalesce(nullif(race_item ->> 'distanceMetres', '')::integer, fixture_row.distance_m),
          'raceClass', coalesce(nullif(btrim(race_item ->> 'raceClass'), ''), fixture_row.race_class),
          'status', incoming_race_status,
          'resultSummary', coalesce(incoming_result_summary, fixture_row.result_summary)
        );
        changed_fields := '{}'::text[];

        if fixture_row.title is distinct from after_values ->> 'title' then changed_fields := array_append(changed_fields, 'title'); end if;
        if fixture_row.starts_at is distinct from incoming_starts_at then changed_fields := array_append(changed_fields, 'startsAt'); end if;
        if fixture_row.distance_m is distinct from nullif(after_values ->> 'distanceMetres', '')::integer then changed_fields := array_append(changed_fields, 'distanceMetres'); end if;
        if fixture_row.race_class is distinct from after_values ->> 'raceClass' then changed_fields := array_append(changed_fields, 'raceClass'); end if;
        if fixture_row.status is distinct from incoming_race_status then changed_fields := array_append(changed_fields, 'status'); end if;
        if fixture_row.result_summary is distinct from after_values ->> 'resultSummary' then changed_fields := array_append(changed_fields, 'resultSummary'); end if;

        update public.fixtures
        set
          external_id = race_external_id,
          title = after_values ->> 'title',
          venue = meeting_row.venue,
          starts_at = incoming_starts_at,
          distance_m = nullif(after_values ->> 'distanceMetres', '')::integer,
          race_class = nullif(after_values ->> 'raceClass', ''),
          status = incoming_race_status,
          result_summary = nullif(after_values ->> 'resultSummary', ''),
          source_name = source_row.source_name,
          source_url = source_row.source_url,
          source_updated_at = incoming_source_updated_at,
          source_payload = race_item
        where id = fixture_row.id
        returning * into fixture_row;

        if cardinality(changed_fields) > 0 then
          record_result := app_private.record_race_change(
            target_run_id,
            target_source_id,
            meeting_row.id,
            fixture_row.id,
            null,
            case when 'resultSummary' = any(changed_fields) then 'result' else 'race' end,
            case
              when incoming_race_status in ('cancelled', 'abandoned') then 'cancelled'
              when 'resultSummary' = any(changed_fields) then 'resulted'
              else 'updated'
            end,
            changed_fields,
            before_values,
            after_values,
            meeting_row.venue || ' Race ' || fixture_row.race_number || ' changed: ' || array_to_string(changed_fields, ', ') || '.',
            incoming_source_updated_at,
            true
          );
          if coalesce((record_result ->> 'inserted')::boolean, false) then
            changes_applied := changes_applied + 1;
            alerts_created := alerts_created + coalesce((record_result ->> 'alertsCreated')::integer, 0);
          end if;
        end if;
      end if;

      for runner_item in
        select value from jsonb_array_elements(race_item -> 'runners')
      loop
        entries_seen := entries_seen + 1;
        runner_external_id := nullif(btrim(runner_item ->> 'externalId'), '');
        incoming_saddle_number := (runner_item ->> 'saddleNumber')::integer;
        incoming_draw := nullif(runner_item ->> 'draw', '')::integer;
        incoming_weight := nullif(runner_item ->> 'carriedWeight', '')::numeric(5, 1);
        incoming_runner_status := lower(coalesce(nullif(runner_item ->> 'status', ''), 'active'));
        incoming_result_position := nullif(runner_item ->> 'resultPosition', '')::integer;

        if incoming_saddle_number <= 0
          or nullif(btrim(runner_item ->> 'horseName'), '') is null
          or incoming_runner_status not in ('active', 'scratched', 'withdrawn')
        then
          raise exception 'A runner contains invalid identity or status data.';
        end if;

        select *
        into entry_row
        from public.race_entries
        where fixture_id = fixture_row.id
          and (
            (runner_external_id is not null and external_id = runner_external_id)
            or saddle_number = incoming_saddle_number
          )
        order by case when external_id = runner_external_id then 0 else 1 end
        limit 1
        for update;

        if entry_row.id is null then
          insert into public.race_entries (
            fixture_id,
            external_id,
            saddle_number,
            horse_name,
            jockey_name,
            trainer_name,
            draw,
            carried_weight,
            odds,
            status,
            result_position,
            source_name,
            source_updated_at,
            source_payload
          )
          values (
            fixture_row.id,
            runner_external_id,
            incoming_saddle_number,
            btrim(runner_item ->> 'horseName'),
            nullif(btrim(runner_item ->> 'jockeyName'), ''),
            nullif(btrim(runner_item ->> 'trainerName'), ''),
            incoming_draw,
            incoming_weight,
            null,
            incoming_runner_status,
            incoming_result_position,
            source_row.source_name,
            snapshot_at,
            runner_item
          )
          returning * into entry_row;

          record_result := app_private.record_race_change(
            target_run_id,
            target_source_id,
            meeting_row.id,
            fixture_row.id,
            entry_row.id,
            'runner',
            'created',
            array['runner'],
            '{}'::jsonb,
            jsonb_build_object('saddleNumber', entry_row.saddle_number, 'horseName', entry_row.horse_name),
            entry_row.horse_name || ' was added to ' || meeting_row.venue || ' Race ' || fixture_row.race_number || '.',
            snapshot_at,
            true
          );
          if coalesce((record_result ->> 'inserted')::boolean, false) then
            changes_applied := changes_applied + 1;
            alerts_created := alerts_created + coalesce((record_result ->> 'alertsCreated')::integer, 0);
          end if;
        else
          before_values := jsonb_build_object(
            'saddleNumber', entry_row.saddle_number,
            'horseName', entry_row.horse_name,
            'jockeyName', entry_row.jockey_name,
            'trainerName', entry_row.trainer_name,
            'draw', entry_row.draw,
            'carriedWeight', entry_row.carried_weight,
            'status', entry_row.status,
            'resultPosition', entry_row.result_position
          );
          after_values := jsonb_build_object(
            'saddleNumber', incoming_saddle_number,
            'horseName', btrim(runner_item ->> 'horseName'),
            'jockeyName', coalesce(nullif(btrim(runner_item ->> 'jockeyName'), ''), entry_row.jockey_name),
            'trainerName', coalesce(nullif(btrim(runner_item ->> 'trainerName'), ''), entry_row.trainer_name),
            'draw', coalesce(incoming_draw, entry_row.draw),
            'carriedWeight', coalesce(incoming_weight, entry_row.carried_weight),
            'status', incoming_runner_status,
            'resultPosition', coalesce(incoming_result_position, entry_row.result_position)
          );
          changed_fields := '{}'::text[];

          if entry_row.saddle_number is distinct from incoming_saddle_number then changed_fields := array_append(changed_fields, 'saddleNumber'); end if;
          if entry_row.horse_name is distinct from after_values ->> 'horseName' then changed_fields := array_append(changed_fields, 'horseName'); end if;
          if entry_row.jockey_name is distinct from after_values ->> 'jockeyName' then changed_fields := array_append(changed_fields, 'jockeyName'); end if;
          if entry_row.trainer_name is distinct from after_values ->> 'trainerName' then changed_fields := array_append(changed_fields, 'trainerName'); end if;
          if entry_row.draw is distinct from nullif(after_values ->> 'draw', '')::integer then changed_fields := array_append(changed_fields, 'draw'); end if;
          if entry_row.carried_weight is distinct from nullif(after_values ->> 'carriedWeight', '')::numeric(5, 1) then changed_fields := array_append(changed_fields, 'carriedWeight'); end if;
          if entry_row.status is distinct from incoming_runner_status then changed_fields := array_append(changed_fields, 'status'); end if;
          if entry_row.result_position is distinct from nullif(after_values ->> 'resultPosition', '')::integer then changed_fields := array_append(changed_fields, 'resultPosition'); end if;

          update public.race_entries
          set
            external_id = coalesce(runner_external_id, external_id),
            saddle_number = incoming_saddle_number,
            horse_name = after_values ->> 'horseName',
            jockey_name = nullif(after_values ->> 'jockeyName', ''),
            trainer_name = nullif(after_values ->> 'trainerName', ''),
            draw = nullif(after_values ->> 'draw', '')::integer,
            carried_weight = nullif(after_values ->> 'carriedWeight', '')::numeric(5, 1),
            odds = null,
            status = incoming_runner_status,
            result_position = nullif(after_values ->> 'resultPosition', '')::integer,
            source_name = source_row.source_name,
            source_updated_at = snapshot_at,
            source_payload = runner_item
          where id = entry_row.id
          returning * into entry_row;

          if cardinality(changed_fields) > 0 then
            record_result := app_private.record_race_change(
              target_run_id,
              target_source_id,
              meeting_row.id,
              fixture_row.id,
              entry_row.id,
              case when 'resultPosition' = any(changed_fields) then 'result' else 'runner' end,
              case
                when 'resultPosition' = any(changed_fields) then 'resulted'
                else 'updated'
              end,
              changed_fields,
              before_values,
              after_values,
              entry_row.horse_name || ' changed in ' || meeting_row.venue || ' Race ' || fixture_row.race_number || ': ' || array_to_string(changed_fields, ', ') || '.',
              snapshot_at,
              true
            );
            if coalesce((record_result ->> 'inserted')::boolean, false) then
              changes_applied := changes_applied + 1;
              alerts_created := alerts_created + coalesce((record_result ->> 'alertsCreated')::integer, 0);
            end if;
          end if;
        end if;
      end loop;
    end loop;
  end loop;

  update public.race_feed_runs
  set
    status = 'succeeded',
    completed_at = now(),
    duration_ms = greatest(0, floor(extract(epoch from now()) * 1000)::bigint - started_milliseconds)::integer,
    meetings_seen = snapshot_apply.meetings_seen,
    races_seen = snapshot_apply.races_seen,
    entries_seen = snapshot_apply.entries_seen,
    changes_applied = snapshot_apply.changes_applied,
    alerts_created = snapshot_apply.alerts_created,
    extracted_payload = target_snapshot,
    error_code = null,
    error_message = null
  where id = target_run_id;

  return jsonb_build_object(
    'status', 'succeeded',
    'meetingsSeen', meetings_seen,
    'racesSeen', races_seen,
    'entriesSeen', entries_seen,
    'changesApplied', changes_applied,
    'alertsCreated', alerts_created
  );
end;
$$;

create or replace function public.ingest_race_snapshot(
  p_run_id uuid,
  p_source_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  return app_private.apply_race_snapshot(p_run_id, p_source_id, p_snapshot, false);
end;
$$;

create or replace function public.admin_upsert_race_feed_source(
  p_source_id uuid,
  p_name text,
  p_source_name text,
  p_source_url text,
  p_venue_hint text default null,
  p_extraction_hint text default null,
  p_content_start_marker text default null,
  p_content_end_marker text default null,
  p_is_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.race_feed_sources%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null
    or nullif(btrim(coalesce(p_source_name, '')), '') is null
    or coalesce(p_source_url, '') !~ '^https://'
  then
    raise exception 'A name, source label, and HTTPS URL are required.';
  end if;

  if p_source_id is null then
    insert into public.race_feed_sources (
      name,
      source_name,
      source_url,
      venue_hint,
      extraction_hint,
      content_start_marker,
      content_end_marker,
      is_enabled,
      created_by
    )
    values (
      btrim(p_name),
      btrim(p_source_name),
      btrim(p_source_url),
      nullif(btrim(coalesce(p_venue_hint, '')), ''),
      nullif(btrim(coalesce(p_extraction_hint, '')), ''),
      nullif(coalesce(p_content_start_marker, ''), ''),
      nullif(coalesce(p_content_end_marker, ''), ''),
      p_is_enabled,
      (select auth.uid())
    )
    returning * into source_row;
  else
    update public.race_feed_sources
    set
      name = btrim(p_name),
      source_name = btrim(p_source_name),
      source_url = btrim(p_source_url),
      venue_hint = nullif(btrim(coalesce(p_venue_hint, '')), ''),
      extraction_hint = nullif(btrim(coalesce(p_extraction_hint, '')), ''),
      content_start_marker = nullif(coalesce(p_content_start_marker, ''), ''),
      content_end_marker = nullif(coalesce(p_content_end_marker, ''), ''),
      is_enabled = p_is_enabled,
      last_content_hash = case
        when source_url is distinct from btrim(p_source_url)
          or content_start_marker is distinct from nullif(coalesce(p_content_start_marker, ''), '')
          or content_end_marker is distinct from nullif(coalesce(p_content_end_marker, ''), '')
        then null
        else last_content_hash
      end,
      last_etag = case when source_url is distinct from btrim(p_source_url) then null else last_etag end,
      last_modified = case when source_url is distinct from btrim(p_source_url) then null else last_modified end
    where id = p_source_id
    returning * into source_row;
  end if;

  if source_row.id is null then
    raise exception 'Race-feed source was not found.';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when p_source_id is null then 'race_feed_source_created' else 'race_feed_source_updated' end,
    'race_feed_source',
    source_row.id,
    jsonb_build_object('name', source_row.name, 'sourceUrl', source_row.source_url, 'enabled', source_row.is_enabled)
  );

  return to_jsonb(source_row);
end;
$$;

create or replace function public.admin_review_race_feed_run(
  p_run_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.race_feed_runs%rowtype;
  result_value jsonb;
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
  into run_row
  from public.race_feed_runs
  where id = p_run_id
  for update;

  if run_row.id is null or run_row.status <> 'quarantined' or run_row.extracted_payload is null then
    raise exception 'Only a quarantined run with an extracted payload can be reviewed.';
  end if;

  if lower(p_decision) = 'reject' then
    update public.race_feed_runs
    set
      status = 'rejected',
      review_note = btrim(p_note),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
    where id = run_row.id
    returning to_jsonb(race_feed_runs.*) into result_value;
  else
    result_value := app_private.apply_race_snapshot(
      run_row.id,
      run_row.source_id,
      run_row.extracted_payload,
      true
    );

    update public.race_feed_runs
    set
      review_note = btrim(p_note),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
    where id = run_row.id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'race_feed_run_' || lower(p_decision),
    'race_feed_run',
    run_row.id,
    jsonb_build_object('note', btrim(p_note))
  );

  return result_value;
end;
$$;

create or replace function public.tipster_get_card_change_alerts(p_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'status', a.status,
      'isAfterLock', a.is_after_lock,
      'createdAt', a.created_at,
      'acknowledgedAt', a.acknowledged_at,
      'resolvedAt', a.resolved_at,
      'resolvedRevision', a.resolved_revision,
      'fixtureId', a.fixture_id,
      'entryId', a.entry_id,
      'summary', e.summary,
      'changedFields', e.changed_fields,
      'beforeValues', e.before_values,
      'afterValues', e.after_values,
      'raceNumber', f.race_number,
      'horseName', re.horse_name,
      'changeCreatedAt', e.created_at
    ) order by a.created_at desc
  ), '[]'::jsonb)
  from public.tip_card_change_alerts a
  join public.tip_cards c on c.id = a.tip_card_id
  join public.race_change_events e on e.id = a.change_event_id
  left join public.fixtures f on f.id = a.fixture_id
  left join public.race_entries re on re.id = a.entry_id
  where a.tip_card_id = p_card_id
    and c.tipster_id = app_private.current_tipster_id();
$$;

create or replace function public.acknowledge_tip_card_change(
  p_alert_id uuid,
  p_note text default 'Reviewed; the current tip remains valid.'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_row public.tip_card_change_alerts%rowtype;
begin
  update public.tip_card_change_alerts a
  set
    status = 'acknowledged',
    acknowledged_at = now(),
    acknowledged_by = (select auth.uid()),
    acknowledgement_note = nullif(btrim(coalesce(p_note, '')), '')
  from public.tip_cards c
  where a.id = p_alert_id
    and c.id = a.tip_card_id
    and c.tipster_id = app_private.current_tipster_id()
    and a.status = 'pending'
  returning a.* into alert_row;

  if alert_row.id is null then
    raise exception 'Pending race-data alert was not found.';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'tip_card_race_change_acknowledged',
    'tip_card_change_alert',
    alert_row.id,
    jsonb_build_object('note', alert_row.acknowledgement_note)
  );

  return to_jsonb(alert_row);
end;
$$;

create or replace function app_private.resolve_tip_card_change_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision_type = 'correction' then
    update public.tip_card_change_alerts
    set
      status = 'resolved',
      resolved_at = now(),
      resolved_revision = new.revision
    where tip_card_id = new.tip_card_id
      and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists resolve_tip_card_change_alerts on public.tip_card_revisions;
create trigger resolve_tip_card_change_alerts
after insert on public.tip_card_revisions
for each row execute function app_private.resolve_tip_card_change_alerts();

create or replace function app_private.configure_race_feed_cron(target_project_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_token text := encode(extensions.gen_random_bytes(32), 'hex');
  existing_secret_id uuid;
  scheduled_job_id bigint;
begin
  if target_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'A valid Supabase project URL is required.';
  end if;

  update app_private.race_worker_tokens
  set is_active = false
  where is_active = true;

  insert into app_private.race_worker_tokens (token_hash)
  values (encode(extensions.digest(worker_token, 'sha256'), 'hex'));

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'mrc_race_worker_token'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      worker_token,
      'mrc_race_worker_token',
      'Rotating token for the MRC race-feed Cron worker.'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      worker_token,
      'mrc_race_worker_token',
      'Rotating token for the MRC race-feed Cron worker.'
    );
  end if;

  perform cron.unschedule('mrc-sync-race-data')
  where exists (
    select 1 from cron.job where jobname = 'mrc-sync-race-data'
  );

  scheduled_job_id := cron.schedule(
    'mrc-sync-race-data',
    '2-59/5 * * * *',
    format(
      $command$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-mrc-worker-token', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'mrc_race_worker_token'
              limit 1
            )
          ),
          body := jsonb_build_object('trigger', 'cron'),
          timeout_milliseconds := 145000
        );
      $command$,
      rtrim(target_project_url, '/') || '/functions/v1/sync-race-data'
    )
  );

  return jsonb_build_object(
    'jobId', scheduled_job_id,
    'jobName', 'mrc-sync-race-data',
    'schedule', '2-59/5 * * * *'
  );
end;
$$;

alter table public.race_feed_sources enable row level security;
alter table public.race_feed_runs enable row level security;
alter table public.race_change_events enable row level security;
alter table public.tip_card_change_alerts enable row level security;

drop policy if exists race_feed_sources_admin_all on public.race_feed_sources;
create policy race_feed_sources_admin_all
on public.race_feed_sources
for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_runs_admin_read on public.race_feed_runs;
create policy race_feed_runs_admin_read
on public.race_feed_runs
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_change_events_admin_read on public.race_change_events;
create policy race_change_events_admin_read
on public.race_change_events
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists tip_card_change_alerts_admin_read on public.tip_card_change_alerts;
drop policy if exists tip_card_change_alerts_owner_read on public.tip_card_change_alerts;
drop policy if exists tip_card_change_alerts_authorized_read on public.tip_card_change_alerts;
create policy tip_card_change_alerts_authorized_read
on public.tip_card_change_alerts
for select
to authenticated
using (
  app_private.current_user_has_role('administrator')
  or exists (
      select 1
      from public.tip_cards c
      where c.id = tip_card_change_alerts.tip_card_id
        and c.tipster_id = app_private.current_tipster_id()
    )
);

revoke all on table public.race_feed_sources from public, anon, authenticated;
revoke all on table public.race_feed_runs from public, anon, authenticated;
revoke all on table public.race_change_events from public, anon, authenticated;
revoke all on table public.tip_card_change_alerts from public, anon, authenticated;

grant select on table public.race_feed_sources to authenticated;
grant select on table public.race_feed_runs to authenticated;
grant select on table public.race_change_events to authenticated;
grant select on table public.tip_card_change_alerts to authenticated;

revoke all on function public.ingest_race_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_race_snapshot(uuid, uuid, jsonb) to service_role;

revoke all on function public.admin_upsert_race_feed_source(uuid, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_upsert_race_feed_source(uuid, text, text, text, text, text, text, text, boolean) to authenticated;

revoke all on function public.admin_review_race_feed_run(uuid, text, text) from public, anon;
grant execute on function public.admin_review_race_feed_run(uuid, text, text) to authenticated;

revoke all on function public.tipster_get_card_change_alerts(uuid) from public, anon;
grant execute on function public.tipster_get_card_change_alerts(uuid) to authenticated;

revoke all on function public.acknowledge_tip_card_change(uuid, text) from public, anon;
grant execute on function public.acknowledge_tip_card_change(uuid, text) to authenticated;

revoke all on function app_private.verify_race_worker_token(text) from public, anon, authenticated;
grant execute on function app_private.verify_race_worker_token(text) to service_role;

revoke all on function public.verify_race_worker_request(text) from public, anon, authenticated;
grant execute on function public.verify_race_worker_request(text) to service_role;

revoke all on function app_private.configure_race_feed_cron(text) from public, anon, authenticated;

revoke all on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb) from authenticated;

insert into public.audit_logs (actor_id, action, entity_type, metadata)
values (
  null,
  'race_feed_schema_installed',
  'system',
  jsonb_build_object('migration', '20260811_mrc_llm_race_feed')
);
