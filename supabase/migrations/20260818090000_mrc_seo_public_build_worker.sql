-- Public SEO projections and the private static-site build queue.

alter table public.tipsters
  add column if not exists slug text;

alter table public.race_meetings
  add column if not exists venue_slug text;

create or replace function app_private.public_slug(value text)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    lower(extensions.unaccent(coalesce(value, ''))),
    '[^a-z0-9]+',
    '-',
    'g'
  ));
$$;

update public.tipsters
set slug = concat(
  coalesce(nullif(app_private.public_slug(display_name), ''), 'tipster'),
  '-',
  left(replace(id::text, '-', ''), 8)
)
where slug is null or btrim(slug) = '';

update public.race_meetings
set venue_slug = coalesce(
  nullif(app_private.public_slug(venue), ''),
  concat('meeting-', left(replace(id::text, '-', ''), 8))
)
where venue_slug is null or btrim(venue_slug) = '';

alter table public.tipsters
  alter column slug set not null;

alter table public.race_meetings
  alter column venue_slug set not null;

create unique index if not exists tipsters_slug_uidx
on public.tipsters (slug);

create index if not exists race_meetings_public_route_idx
on public.race_meetings (venue_slug, meeting_date desc)
where is_test = false;

create or replace function app_private.ensure_public_slugs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'tipsters' then
    if new.slug is null or btrim(new.slug) = '' then
      new.slug := concat(
        coalesce(nullif(app_private.public_slug(new.display_name), ''), 'tipster'),
        '-',
        left(replace(new.id::text, '-', ''), 8)
      );
    end if;
  elsif tg_table_name = 'race_meetings' then
    if new.venue_slug is null or btrim(new.venue_slug) = '' then
      new.venue_slug := coalesce(
        nullif(app_private.public_slug(new.venue), ''),
        concat('meeting-', left(replace(new.id::text, '-', ''), 8))
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_tipster_public_slug on public.tipsters;
create trigger ensure_tipster_public_slug
before insert or update of display_name, slug on public.tipsters
for each row execute function app_private.ensure_public_slugs();

drop trigger if exists ensure_meeting_public_slug on public.race_meetings;
create trigger ensure_meeting_public_slug
before insert or update of venue, venue_slug on public.race_meetings
for each row execute function app_private.ensure_public_slugs();

create table if not exists public.site_build_jobs (
  id uuid primary key default gen_random_uuid(),
  job_kind text not null default 'content' check (job_kind in ('content', 'code')),
  status text not null default 'queued' check (status in ('queued', 'leased', 'succeeded', 'failed', 'cancelled')),
  reason text not null check (char_length(reason) between 3 and 500),
  entity_type text,
  entity_id uuid,
  requested_commit_sha text,
  content_snapshot jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  output_sha256 text,
  deployed_commit_sha text,
  build_manifest jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists site_build_jobs_one_queued_kind_uidx
on public.site_build_jobs (job_kind)
where status = 'queued';

create index if not exists site_build_jobs_claim_idx
on public.site_build_jobs (status, available_at, created_at);

alter table public.site_build_jobs enable row level security;
revoke all on public.site_build_jobs from public, anon, authenticated;

drop trigger if exists set_site_build_jobs_updated_at on public.site_build_jobs;
create trigger set_site_build_jobs_updated_at
before update on public.site_build_jobs
for each row execute function public.set_updated_at();

create or replace function app_private.queue_site_content_build(
  p_reason text,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued_id uuid;
begin
  insert into public.site_build_jobs (
    job_kind,
    status,
    reason,
    entity_type,
    entity_id,
    content_snapshot,
    available_at
  ) values (
    'content',
    'queued',
    left(coalesce(nullif(btrim(p_reason), ''), 'Public content changed'), 500),
    p_entity_type,
    p_entity_id,
    jsonb_build_object('queuedAt', now()),
    now() + interval '90 seconds'
  )
  on conflict (job_kind) where status = 'queued'
  do update set
    reason = excluded.reason,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    content_snapshot = public.site_build_jobs.content_snapshot || excluded.content_snapshot,
    available_at = greatest(public.site_build_jobs.available_at, excluded.available_at),
    updated_at = now()
  returning id into queued_id;

  return queued_id;
end;
$$;

create or replace function app_private.queue_site_build_from_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_id uuid;
begin
  record_id := case when tg_op = 'DELETE' then old.id else new.id end;
  perform app_private.queue_site_content_build(
    concat(tg_table_name, ' ', lower(tg_op)),
    tg_table_name,
    record_id
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists queue_site_build_blog_posts on public.blog_posts;
create trigger queue_site_build_blog_posts
after insert or update or delete on public.blog_posts
for each row execute function app_private.queue_site_build_from_change();

drop trigger if exists queue_site_build_tipsters on public.tipsters;
create trigger queue_site_build_tipsters
after insert or update or delete on public.tipsters
for each row execute function app_private.queue_site_build_from_change();

drop trigger if exists queue_site_build_race_meetings on public.race_meetings;
create trigger queue_site_build_race_meetings
after insert or update or delete on public.race_meetings
for each row execute function app_private.queue_site_build_from_change();

drop trigger if exists queue_site_build_fixtures on public.fixtures;
create trigger queue_site_build_fixtures
after insert or update or delete on public.fixtures
for each row execute function app_private.queue_site_build_from_change();

drop trigger if exists queue_site_build_race_entries on public.race_entries;
create trigger queue_site_build_race_entries
after insert or update or delete on public.race_entries
for each row execute function app_private.queue_site_build_from_change();

create or replace function public.get_public_build_manifest()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'blogPosts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', posts.slug,
        'lastModified', posts.updated_at
      ) order by posts.updated_at desc)
      from public.blog_posts posts
      where posts.status = 'published' and posts.slug is not null
    ), '[]'::jsonb),
    'tipsters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', tipsters.slug,
        'lastModified', greatest(tipsters.updated_at, coalesce(stats.updated_at, tipsters.updated_at))
      ) order by tipsters.ranking nulls last, tipsters.display_name)
      from public.tipsters tipsters
      left join public.tipster_performance_stats stats on stats.tipster_id = tipsters.id
      where tipsters.is_verified
    ), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'venueSlug', meetings.venue_slug,
        'meetingDate', meetings.meeting_date,
        'lastModified', greatest(meetings.updated_at, coalesce(meetings.source_updated_at, meetings.updated_at))
      ) order by meetings.meeting_date desc, meetings.venue)
      from public.race_meetings meetings
      where not meetings.is_test
        and meetings.meeting_date between current_date - 365 and current_date + 90
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_public_blog_article(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', posts.id,
    'slug', posts.slug,
    'title', posts.title,
    'excerpt', posts.excerpt,
    'bodyMarkdown', posts.body_markdown,
    'coverImagePath', posts.cover_image_path,
    'publishedAt', posts.published_at,
    'updatedAt', posts.updated_at,
    'author', tipsters.display_name,
    'authorSlug', tipsters.slug,
    'authorPhotoPath', tipsters.photo_path
  )
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.status = 'published'
    and posts.slug = btrim(p_slug)
    and tipsters.is_verified
  limit 1;
$$;

create or replace function public.get_public_tipster_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', tipsters.id,
    'slug', tipsters.slug,
    'displayName', tipsters.display_name,
    'biography', tipsters.biography,
    'photoPath', tipsters.photo_path,
    'ranking', tipsters.ranking,
    'winnerStrikeRate', stats.winner_strike_rate,
    'settledWinnerTips', coalesce(stats.settled_winner_tips, 0),
    'winnerHits', coalesce(stats.winner_hits, 0),
    'statsUpdatedAt', stats.updated_at,
    'updatedAt', tipsters.updated_at
  )
  from public.tipsters tipsters
  left join public.tipster_performance_stats stats on stats.tipster_id = tipsters.id
  where tipsters.is_verified and tipsters.slug = btrim(p_slug)
  limit 1;
$$;

create or replace function public.get_public_race_meeting(
  p_venue_slug text,
  p_meeting_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', meetings.id,
    'venue', meetings.venue,
    'venueSlug', meetings.venue_slug,
    'countryCode', meetings.country_code,
    'meetingDate', meetings.meeting_date,
    'firstRaceAt', meetings.first_race_at,
    'lastRaceAt', meetings.last_race_at,
    'status', meetings.status,
    'sourceName', meetings.source_name,
    'sourceUrl', meetings.source_url,
    'sourceUpdatedAt', meetings.source_updated_at,
    'updatedAt', meetings.updated_at,
    'races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fixtures.id,
        'raceNumber', fixtures.race_number,
        'title', fixtures.title,
        'startsAt', fixtures.starts_at,
        'status', fixtures.status,
        'distanceMetres', fixtures.distance_m,
        'raceClass', fixtures.race_class,
        'resultSummary', fixtures.result_summary,
        'sourceName', fixtures.source_name,
        'sourceUrl', fixtures.source_url,
        'sourceUpdatedAt', fixtures.source_updated_at,
        'runners', coalesce((
          select jsonb_agg(jsonb_build_object(
            'saddleNumber', entries.saddle_number,
            'horseName', entries.horse_name,
            'jockeyName', entries.jockey_name,
            'trainerName', entries.trainer_name,
            'draw', entries.draw,
            'carriedWeight', entries.carried_weight,
            'status', entries.status,
            'resultPosition', entries.result_position,
            'sourceUpdatedAt', entries.source_updated_at
          ) order by coalesce(entries.result_position, 9999), entries.saddle_number)
          from public.race_entries entries
          where entries.fixture_id = fixtures.id
        ), '[]'::jsonb)
      ) order by fixtures.race_number nulls last, fixtures.starts_at)
      from public.fixtures fixtures
      where fixtures.meeting_id = meetings.id
    ), '[]'::jsonb)
  )
  from public.race_meetings meetings
  where not meetings.is_test
    and meetings.venue_slug = btrim(p_venue_slug)
    and meetings.meeting_date = p_meeting_date
  order by meetings.updated_at desc
  limit 1;
$$;

create or replace function public.claim_site_build_job(
  p_worker_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.site_build_jobs%rowtype;
begin
  if char_length(btrim(coalesce(p_worker_id, ''))) not between 3 and 160 then
    raise exception 'A valid worker identifier is required.';
  end if;

  update public.site_build_jobs
  set
    status = 'queued',
    lease_owner = null,
    lease_expires_at = null,
    available_at = now()
  where status = 'leased'
    and lease_expires_at < now()
    and attempt_count < 3;

  select * into claimed
  from public.site_build_jobs
  where status = 'queued'
    and available_at <= now()
    and attempt_count < 3
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.site_build_jobs
  set
    status = 'leased',
    lease_owner = btrim(p_worker_id),
    lease_expires_at = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))),
    attempt_count = attempt_count + 1,
    started_at = coalesce(started_at, now()),
    last_error = null
  where id = claimed.id
  returning * into claimed;

  return to_jsonb(claimed);
end;
$$;

create or replace function public.heartbeat_site_build_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.site_build_jobs
  set lease_expires_at = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600)))
  where id = p_job_id
    and status = 'leased'
    and lease_owner = btrim(p_worker_id)
    and lease_expires_at >= now();
  return found;
end;
$$;

create or replace function public.complete_site_build_job(
  p_job_id uuid,
  p_worker_id text,
  p_deployed_commit_sha text,
  p_output_sha256 text,
  p_build_manifest jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.site_build_jobs
  set
    status = 'succeeded',
    deployed_commit_sha = nullif(btrim(p_deployed_commit_sha), ''),
    output_sha256 = nullif(btrim(p_output_sha256), ''),
    build_manifest = coalesce(p_build_manifest, '{}'::jsonb),
    completed_at = now(),
    lease_owner = null,
    lease_expires_at = null
  where id = p_job_id
    and status = 'leased'
    and lease_owner = btrim(p_worker_id);
  return found;
end;
$$;

create or replace function public.fail_site_build_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed public.site_build_jobs%rowtype;
begin
  update public.site_build_jobs
  set
    status = case when attempt_count >= 3 then 'failed' else 'queued' end,
    available_at = case
      when attempt_count >= 3 then available_at
      else now() + make_interval(mins => attempt_count * 5)
    end,
    completed_at = case when attempt_count >= 3 then now() else null end,
    last_error = left(regexp_replace(coalesce(p_error, 'Build failed.'), '[\r\n]+', ' ', 'g'), 1000),
    lease_owner = null,
    lease_expires_at = null
  where id = p_job_id
    and status = 'leased'
    and lease_owner = btrim(p_worker_id)
  returning * into failed;
  return case when failed.id is null then null else to_jsonb(failed) end;
end;
$$;

revoke all on function app_private.public_slug(text) from public, anon, authenticated;
revoke all on function app_private.ensure_public_slugs() from public, anon, authenticated;
revoke all on function app_private.queue_site_content_build(text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.queue_site_build_from_change() from public, anon, authenticated;

revoke all on function public.get_public_build_manifest() from public;
grant execute on function public.get_public_build_manifest() to anon, authenticated;
revoke all on function public.get_public_blog_article(text) from public;
grant execute on function public.get_public_blog_article(text) to anon, authenticated;
revoke all on function public.get_public_tipster_profile(text) from public;
grant execute on function public.get_public_tipster_profile(text) to anon, authenticated;
revoke all on function public.get_public_race_meeting(text, date) from public;
grant execute on function public.get_public_race_meeting(text, date) to anon, authenticated;

revoke all on function public.claim_site_build_job(text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_site_build_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_site_build_job(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_site_build_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_site_build_job(text, integer) to service_role;
grant execute on function public.heartbeat_site_build_job(uuid, text, integer) to service_role;
grant execute on function public.complete_site_build_job(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.fail_site_build_job(uuid, text, text) to service_role;

select app_private.queue_site_content_build('SEO route foundation deployed', 'migration', null);
