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
  perform app_private.reconcile_postponed_race_meetings(
    target_run_id,
    target_source_id,
    normalized_snapshot
  );
  apply_result := app_private.apply_race_snapshot_source(
    target_run_id,
    target_source_id,
    normalized_snapshot,
    force_quarantined
  );

  if coalesce(apply_result ->> 'status', '') <> 'quarantined' then
    update public.fixtures fixtures
    set selection_lock_at = fixtures.starts_at,
        updated_at = now()
    where fixtures.starts_at > now()
      and fixtures.selection_lock_at is distinct from fixtures.starts_at
      and fixtures.result_summary is null
      and not exists (
        select 1
        from public.race_entries entries
        where entries.fixture_id = fixtures.id
          and entries.result_position is not null
      )
      and exists (
        select 1
        from public.race_change_events changes
        where changes.run_id = target_run_id
          and changes.meeting_id = fixtures.meeting_id
          and changes.entity_type = 'meeting'
          and changes.changed_fields @> array['meetingDate']::text[]
      );

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

revoke all on function app_private.apply_race_snapshot(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;

update public.fixtures fixtures
set selection_lock_at = fixtures.starts_at,
    updated_at = now()
where fixtures.meeting_id in (
    select meetings.id
    from public.race_meetings meetings
    where lower(btrim(meetings.venue)) = 'greyville'
      and meetings.meeting_date = date '2026-09-20'
      and not meetings.is_test
  )
  and fixtures.starts_at > now()
  and fixtures.result_summary is null
  and not exists (
    select 1
    from public.race_entries entries
    where entries.fixture_id = fixtures.id
      and entries.result_position is not null
  );
