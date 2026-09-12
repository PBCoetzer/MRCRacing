create table if not exists app_private.race_source_title_audit (
  fixture_id uuid primary key references public.fixtures(id) on delete cascade,
  source_title text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table app_private.race_source_title_audit enable row level security;
revoke all on table app_private.race_source_title_audit from public, anon, authenticated;

create or replace function app_private.mrc_race_display_title(
  target_source_title text,
  target_race_number integer,
  target_race_class text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  source_value text := regexp_replace(btrim(coalesce(target_source_title, '')), '[[:space:]]+', ' ', 'g');
  canonical_value text := regexp_replace(btrim(coalesce(target_race_class, '')), '[[:space:]]+', ' ', 'g');
  conditions_value text;
  conditions_position integer;
  matched_value text[];
begin
  canonical_value := regexp_replace(
    canonical_value,
    '(https?://|www\.)[^[:space:]]+|[[:alnum:]][[:alnum:].-]*\.(co\.za|com|net|org|io|app)[^[:space:]]*',
    ' ',
    'gi'
  );
  canonical_value := regexp_replace(canonical_value, '[[:space:]]+', ' ', 'g');
  canonical_value := nullif(btrim(canonical_value), '');

  if canonical_value is not null and (
    char_length(canonical_value) > 100
    or canonical_value ~* '(hollywoodbets|race[[:space:]]*coast|gallop[[:space:]]*tv|tabgold|4racing|lucky[[:space:]]*fish|play[[:space:]]*soccer|youcanbetonus|telebet|racing240|tote)'
  ) then
    canonical_value := null;
  end if;

  canonical_value := case lower(coalesce(canonical_value, ''))
    when 'mdn plate' then 'Maiden Plate'
    when 'open mdn' then 'Open Maiden'
    when 'mid stks' then 'Middle Stakes'
    when 'clsfd stks' then 'Classified Stakes'
    when 'pin stks' then 'Pinnacle Stakes'
    when 'con plate' then 'Conditions Plate'
    when 'hcp' then 'Handicap'
    else canonical_value
  end;

  if canonical_value is not null then
    canonical_value := regexp_replace(canonical_value, '\mMdn\M', 'Maiden', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mHCP\M', 'Handicap', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mClsfd\M', 'Classified', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mMid\M', 'Middle', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mPin\M', 'Pinnacle', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mCon\M', 'Conditions', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mCHL\M', 'Challenge', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mSpg\M', 'Spring', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mStks\M', 'Stakes', 'gi');
    canonical_value := regexp_replace(canonical_value, '\mLadys\M', 'Ladies', 'gi');
  end if;

  if canonical_value is null then
    if source_value ~* 'work[[:space:]]+riders[[:space:]]+maiden[[:space:]]+plate' then
      canonical_value := 'Work Riders Maiden Plate';
    elsif source_value ~* 'open[[:space:]]+maiden' then
      canonical_value := 'Open Maiden';
    elsif source_value ~* 'maiden[[:space:]]+plate' then
      canonical_value := 'Maiden Plate';
    elsif source_value ~* '\m(MR|FM)[[:space:]]+[0-9]+[[:space:]]+(divided[[:space:]]+)?handicap\M' then
      matched_value := regexp_match(source_value, '\m(MR|FM)[[:space:]]+([0-9]+)[[:space:]]+(divided[[:space:]]+)?handicap\M', 'i');
      canonical_value := upper(matched_value[1]) || ' ' || matched_value[2] || ' Handicap';
    elsif source_value ~* 'apprentice[[:space:]]+[A-E][[:space:]]+stakes' then
      matched_value := regexp_match(source_value, 'apprentice[[:space:]]+([A-E])[[:space:]]+stakes', 'i');
      canonical_value := 'Apprentice ' || upper(matched_value[1]) || ' Stakes';
    elsif source_value ~* '\mclass[[:space:]]+[0-9]+\M' then
      matched_value := regexp_match(source_value, '\mclass[[:space:]]+([0-9]+)\M', 'i');
      canonical_value := 'Class ' || matched_value[1];
    elsif source_value ~* '\m[A-E][[:space:]]+stakes\M' then
      matched_value := regexp_match(source_value, '\m([A-E])[[:space:]]+stakes\M', 'i');
      canonical_value := upper(matched_value[1]) || ' Stakes';
    elsif source_value ~* 'middle[[:space:]]+stakes' then
      canonical_value := 'Middle Stakes';
    elsif source_value ~* 'classified[[:space:]]+stakes' then
      canonical_value := 'Classified Stakes';
    elsif source_value ~* 'pinnacle[[:space:]]+stakes' then
      canonical_value := 'Pinnacle Stakes';
    elsif source_value ~* 'conditions[[:space:]]+plate' then
      canonical_value := 'Conditions Plate';
    else
      canonical_value := 'Race ' || greatest(coalesce(target_race_number, 1), 1)::text;
    end if;
  end if;

  if source_value ~* 'work[[:space:]]+riders' and canonical_value ~* '^Maiden Plate$' then
    canonical_value := 'Work Riders ' || canonical_value;
  elsif source_value ~* '\mapprentice\M' and canonical_value ~* '^[A-E] Stakes$' then
    canonical_value := 'Apprentice ' || canonical_value;
  end if;

  if source_value ~* '\mdivided[[:space:]]+handicap\M' and canonical_value ~* ' Handicap$' then
    canonical_value := regexp_replace(canonical_value, ' Handicap$', ' Divided Handicap', 'i');
  end if;

  conditions_position := strpos(source_value, '(');
  if conditions_position > 0 then
    conditions_value := btrim(substring(source_value from conditions_position));
    if conditions_value !~* '^\((F[[:space:]]*(and|&)[[:space:]]*M|For\M|Open\M|Non[-[:space:]])' then
      conditions_value := null;
    end if;
  end if;

  if conditions_value is not null then
    conditions_value := regexp_replace(
      conditions_value,
      '(https?://|www\.)[^[:space:]]+|[[:alnum:]][[:alnum:].-]*\.(co\.za|com|net|org|io|app)[^[:space:]]*',
      ' ',
      'gi'
    );
    conditions_value := left(regexp_replace(conditions_value, '[[:space:]]+', ' ', 'g'), 240);
  end if;

  return btrim(regexp_replace(
    canonical_value || case when nullif(conditions_value, '') is null then '' else ' ' || conditions_value end,
    '[[:space:]]+',
    ' ',
    'g'
  ));
end;
$$;

revoke all on function app_private.mrc_race_display_title(text, integer, text) from public, anon, authenticated;

create or replace function app_private.normalize_mrc_race_snapshot_titles(
  target_snapshot jsonb,
  preserve_source_title boolean default true
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized_snapshot jsonb := target_snapshot;
  meeting_index integer;
  race_index integer;
  race_item jsonb;
  source_title_value text;
  display_title_value text;
  race_number_value integer;
  race_class_value text;
begin
  if jsonb_typeof(normalized_snapshot -> 'meetings') <> 'array' then
    return normalized_snapshot;
  end if;

  for meeting_index in 0..jsonb_array_length(normalized_snapshot -> 'meetings') - 1 loop
    if jsonb_typeof(normalized_snapshot #> array['meetings', meeting_index::text, 'races']) <> 'array' then
      continue;
    end if;

    for race_index in 0..jsonb_array_length(normalized_snapshot #> array['meetings', meeting_index::text, 'races']) - 1 loop
      race_item := normalized_snapshot #> array['meetings', meeting_index::text, 'races', race_index::text];
      race_number_value := greatest(coalesce(nullif(race_item ->> 'raceNumber', '')::integer, race_index + 1), 1);
      race_class_value := nullif(btrim(coalesce(race_item ->> 'raceClass', '')), '');
      source_title_value := coalesce(
        nullif(btrim(coalesce(race_item ->> 'sourceTitle', '')), ''),
        nullif(btrim(coalesce(race_item ->> 'title', '')), ''),
        'Race ' || race_number_value::text
      );
      display_title_value := app_private.mrc_race_display_title(source_title_value, race_number_value, race_class_value);

      race_item := jsonb_set(race_item, '{title}', to_jsonb(display_title_value), true);
      if preserve_source_title then
        race_item := jsonb_set(race_item, '{sourceTitle}', to_jsonb(source_title_value), true);
      else
        race_item := race_item - 'sourceTitle';
      end if;
      normalized_snapshot := jsonb_set(
        normalized_snapshot,
        array['meetings', meeting_index::text, 'races', race_index::text],
        race_item,
        true
      );
    end loop;
  end loop;

  return normalized_snapshot;
end;
$$;

revoke all on function app_private.normalize_mrc_race_snapshot_titles(jsonb, boolean) from public, anon, authenticated;

insert into app_private.race_source_title_audit (fixture_id, source_title)
select
  fixtures.id,
  coalesce(
    nullif(btrim(coalesce(fixtures.source_payload ->> 'sourceTitle', '')), ''),
    nullif(btrim(coalesce(fixtures.source_payload ->> 'title', '')), ''),
    fixtures.title
  )
from public.fixtures
on conflict (fixture_id) do update
set source_title = excluded.source_title,
    last_seen_at = now();

with normalized as (
  select
    fixtures.id,
    app_private.mrc_race_display_title(
      coalesce(
        nullif(btrim(coalesce(fixtures.source_payload ->> 'sourceTitle', '')), ''),
        nullif(btrim(coalesce(fixtures.source_payload ->> 'title', '')), ''),
        fixtures.title
      ),
      fixtures.race_number,
      fixtures.race_class
    ) as display_title
  from public.fixtures
)
update public.fixtures
set
  title = normalized.display_title,
  source_payload = case
    when jsonb_typeof(fixtures.source_payload) = 'object'
      then jsonb_set(fixtures.source_payload - 'sourceTitle', '{title}', to_jsonb(normalized.display_title), true)
    else jsonb_build_object('title', normalized.display_title)
  end,
  updated_at = now()
from normalized
where fixtures.id = normalized.id;

with sanitized as (
  select
    meetings.id,
    (
      app_private.normalize_mrc_race_snapshot_titles(
        jsonb_build_object('meetings', jsonb_build_array(meetings.source_payload)),
        false
      ) -> 'meetings' -> 0
    ) as source_payload
  from public.race_meetings meetings
  where jsonb_typeof(meetings.source_payload) = 'object'
)
update public.race_meetings
set source_payload = sanitized.source_payload,
    updated_at = now()
from sanitized
where race_meetings.id = sanitized.id;

create or replace function app_private.prepare_fixture_mrc_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_title_value text;
begin
  if tg_op = 'UPDATE'
    and new.title is distinct from old.title
    and new.source_payload is not distinct from old.source_payload
  then
    source_title_value := nullif(btrim(coalesce(new.title, '')), '');
  else
    source_title_value := coalesce(
      nullif(btrim(coalesce(new.source_payload ->> 'sourceTitle', '')), ''),
      nullif(btrim(coalesce(new.source_payload ->> 'title', '')), ''),
      nullif(btrim(coalesce(new.title, '')), '')
    );
  end if;

  source_title_value := coalesce(source_title_value, 'Race ' || greatest(coalesce(new.race_number, 1), 1)::text);
  new.title := app_private.mrc_race_display_title(source_title_value, new.race_number, new.race_class);
  new.source_payload := case
    when jsonb_typeof(new.source_payload) = 'object'
      then jsonb_set(new.source_payload - 'sourceTitle', '{title}', to_jsonb(new.title), true)
    else jsonb_build_object('title', new.title)
  end;

  insert into app_private.race_source_title_audit (fixture_id, source_title)
  values (new.id, source_title_value)
  on conflict (fixture_id) do update
  set source_title = excluded.source_title,
      last_seen_at = now();

  return new;
end;
$$;

revoke all on function app_private.prepare_fixture_mrc_title() from public, anon, authenticated;

drop trigger if exists fixtures_prepare_mrc_title on public.fixtures;
create trigger fixtures_prepare_mrc_title
before insert or update of title, race_class, race_number, source_payload
on public.fixtures
for each row execute function app_private.prepare_fixture_mrc_title();

do $$
begin
  if to_regprocedure('app_private.apply_race_snapshot_source(uuid,uuid,jsonb,boolean)') is null then
    alter function app_private.apply_race_snapshot(uuid, uuid, jsonb, boolean)
      rename to apply_race_snapshot_source;
  end if;
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
declare
  normalized_snapshot jsonb;
  public_snapshot jsonb;
  meeting_item jsonb;
  apply_result jsonb;
  source_name_value text;
begin
  normalized_snapshot := app_private.normalize_mrc_race_snapshot_titles(target_snapshot, true);
  apply_result := app_private.apply_race_snapshot_source(
    target_run_id,
    target_source_id,
    normalized_snapshot,
    force_quarantined
  );

  if coalesce(apply_result ->> 'status', '') <> 'quarantined' then
    select source_name into source_name_value
    from public.race_feed_sources
    where id = target_source_id;

    public_snapshot := app_private.normalize_mrc_race_snapshot_titles(normalized_snapshot, false);
    for meeting_item in select value from jsonb_array_elements(public_snapshot -> 'meetings') loop
      update public.race_meetings
      set source_payload = meeting_item
      where source_name = source_name_value
        and external_id = meeting_item ->> 'externalId';
    end loop;
  end if;

  return apply_result;
end;
$$;

revoke all on function app_private.apply_race_snapshot_source(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function app_private.apply_race_snapshot(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
