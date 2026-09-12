create or replace function app_private.enforce_tip_card_race_outcome_refresh()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  canonical_winner_position integer;
  canonical_place_position integer;
  canonical_official_winner_id uuid;
  canonical_result_summary text;
  canonical_source_updated_at timestamptz;
  canonical_winner_hit boolean;
  canonical_evidence_hash text;
begin
  if tg_op = 'DELETE' then
    raise exception 'This audit record is immutable.';
  end if;

  if new.id is distinct from old.id
    or new.tip_card_id is distinct from old.tip_card_id
    or new.fixture_id is distinct from old.fixture_id
    or new.selected_winner_entry_id is distinct from old.selected_winner_entry_id
    or new.selected_place_entry_id is distinct from old.selected_place_entry_id
    or new.settled_at < old.settled_at then
    raise exception 'This audit record is immutable.';
  end if;

  select
    selected_winner.result_position,
    selected_place.result_position,
    official_winner.id,
    fixtures.result_summary,
    fixtures.source_updated_at
  into
    canonical_winner_position,
    canonical_place_position,
    canonical_official_winner_id,
    canonical_result_summary,
    canonical_source_updated_at
  from public.fixtures fixtures
  left join public.race_entries selected_winner
    on selected_winner.id = old.selected_winner_entry_id
    and selected_winner.fixture_id = fixtures.id
  left join public.race_entries selected_place
    on selected_place.id = old.selected_place_entry_id
    and selected_place.fixture_id = fixtures.id
  left join lateral (
    select entries.id
    from public.race_entries entries
    where entries.fixture_id = fixtures.id
      and entries.result_position = 1
    order by entries.id
    limit 1
  ) official_winner on true
  where fixtures.id = old.fixture_id;

  if not found then
    raise exception 'Outcome fixture no longer exists.';
  end if;

  canonical_winner_hit := case
    when old.selected_winner_entry_id is null
      or canonical_winner_position is null then null
    else canonical_winner_position = 1
  end;

  canonical_evidence_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'fixtureId', old.fixture_id,
          'resultSummary', canonical_result_summary,
          'winnerEntryId', canonical_official_winner_id,
          'winnerPosition', canonical_winner_position,
          'placePosition', canonical_place_position,
          'sourceUpdatedAt', canonical_source_updated_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if new.selected_winner_position is distinct from canonical_winner_position
    or new.winner_hit is distinct from canonical_winner_hit
    or new.selected_place_position is distinct from canonical_place_position
    or new.official_winner_entry_id is distinct from canonical_official_winner_id
    or new.result_summary is distinct from canonical_result_summary
    or new.evidence_hash is distinct from canonical_evidence_hash then
    raise exception 'Outcome refresh does not match the canonical official result.';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    null,
    'tip_card_race_outcome_refreshed',
    'tip_card_race_outcome',
    old.id,
    jsonb_build_object(
      'fixtureId', old.fixture_id,
      'previousEvidenceHash', old.evidence_hash,
      'newEvidenceHash', new.evidence_hash,
      'previousWinnerPosition', old.selected_winner_position,
      'newWinnerPosition', new.selected_winner_position,
      'previousPlacePosition', old.selected_place_position,
      'newPlacePosition', new.selected_place_position,
      'previousResultSummary', old.result_summary,
      'newResultSummary', new.result_summary,
      'refreshedAt', new.settled_at
    )
  );

  return new;
end;
$$;

revoke all on function app_private.enforce_tip_card_race_outcome_refresh()
from public, anon, authenticated;

drop trigger if exists protect_tip_card_race_outcomes
on public.tip_card_race_outcomes;

create trigger protect_tip_card_race_outcomes
before update or delete on public.tip_card_race_outcomes
for each row execute function app_private.enforce_tip_card_race_outcome_refresh();

create or replace function app_private.settle_completed_tip_cards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  settled_count integer := 0;
begin
  update public.tip_cards cards
  set status = 'settled'
  from public.race_meetings meetings
  where meetings.id = cards.meeting_id
    and meetings.status = 'completed'
    and cards.status = 'published'
    and exists (
      select 1
      from public.fixtures fixtures
      where fixtures.meeting_id = meetings.id
    )
    and not exists (
      select 1
      from public.fixtures fixtures
      left join public.race_tip_selections selections
        on selections.tip_card_id = cards.id
        and selections.fixture_id = fixtures.id
      left join public.race_entries selected_winner
        on selected_winner.id = selections.winner_entry_id
      left join public.race_entries selected_place
        on selected_place.id = selections.place_entry_id
      where fixtures.meeting_id = meetings.id
        and (
          fixtures.status not in ('completed', 'cancelled', 'abandoned')
          or (
            fixtures.status = 'completed'
            and (
              (
                select count(*)
                from public.race_entries official_winner
                where official_winner.fixture_id = fixtures.id
                  and official_winner.result_position = 1
              ) <> 1
              or (
                selections.winner_entry_id is not null
                and selected_winner.result_position is null
                and coalesce(selected_winner.status, 'active')
                  not in ('scratched', 'withdrawn')
              )
              or (
                selections.place_entry_id is not null
                and selected_place.result_position is null
                and coalesce(selected_place.status, 'active')
                  not in ('scratched', 'withdrawn')
              )
            )
          )
        )
    );
  get diagnostics settled_count = row_count;

  insert into public.tip_card_race_outcomes (
    tip_card_id,
    fixture_id,
    selected_winner_entry_id,
    selected_winner_position,
    winner_hit,
    selected_place_entry_id,
    selected_place_position,
    official_winner_entry_id,
    result_summary,
    evidence_hash,
    settled_at
  )
  select
    cards.id,
    fixtures.id,
    selections.winner_entry_id,
    selected_winner.result_position,
    case
      when selections.winner_entry_id is null
        or selected_winner.result_position is null then null
      else selected_winner.result_position = 1
    end,
    selections.place_entry_id,
    selected_place.result_position,
    official_winner.id,
    fixtures.result_summary,
    encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'fixtureId', fixtures.id,
            'resultSummary', fixtures.result_summary,
            'winnerEntryId', official_winner.id,
            'winnerPosition', selected_winner.result_position,
            'placePosition', selected_place.result_position,
            'sourceUpdatedAt', fixtures.source_updated_at
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    now()
  from public.tip_cards cards
  join public.race_meetings meetings
    on meetings.id = cards.meeting_id
  join public.fixtures fixtures
    on fixtures.meeting_id = meetings.id
  left join public.race_tip_selections selections
    on selections.tip_card_id = cards.id
    and selections.fixture_id = fixtures.id
  left join public.race_entries selected_winner
    on selected_winner.id = selections.winner_entry_id
  left join public.race_entries selected_place
    on selected_place.id = selections.place_entry_id
  left join lateral (
    select entries.id
    from public.race_entries entries
    where entries.fixture_id = fixtures.id
      and entries.result_position = 1
    order by entries.id
    limit 1
  ) official_winner on true
  where cards.status = 'settled'
    and meetings.status = 'completed'
    and fixtures.status in ('completed', 'cancelled', 'abandoned')
    and (
      fixtures.status in ('cancelled', 'abandoned')
      or (
        fixtures.status = 'completed'
        and official_winner.id is not null
        and (
          selections.winner_entry_id is null
          or selected_winner.result_position is not null
          or coalesce(selected_winner.status, 'active')
            in ('scratched', 'withdrawn')
        )
        and (
          selections.place_entry_id is null
          or selected_place.result_position is not null
          or coalesce(selected_place.status, 'active')
            in ('scratched', 'withdrawn')
        )
      )
    )
  on conflict (tip_card_id, fixture_id) do update
  set
    selected_winner_entry_id = excluded.selected_winner_entry_id,
    selected_winner_position = excluded.selected_winner_position,
    winner_hit = excluded.winner_hit,
    selected_place_entry_id = excluded.selected_place_entry_id,
    selected_place_position = excluded.selected_place_position,
    official_winner_entry_id = excluded.official_winner_entry_id,
    result_summary = excluded.result_summary,
    evidence_hash = excluded.evidence_hash,
    settled_at = excluded.settled_at
  where public.tip_card_race_outcomes.selected_winner_entry_id
      is distinct from excluded.selected_winner_entry_id
    or public.tip_card_race_outcomes.selected_winner_position
      is distinct from excluded.selected_winner_position
    or public.tip_card_race_outcomes.winner_hit
      is distinct from excluded.winner_hit
    or public.tip_card_race_outcomes.selected_place_entry_id
      is distinct from excluded.selected_place_entry_id
    or public.tip_card_race_outcomes.selected_place_position
      is distinct from excluded.selected_place_position
    or public.tip_card_race_outcomes.official_winner_entry_id
      is distinct from excluded.official_winner_entry_id
    or public.tip_card_race_outcomes.result_summary
      is distinct from excluded.result_summary
    or public.tip_card_race_outcomes.evidence_hash
      is distinct from excluded.evidence_hash;

  perform app_private.refresh_tipster_performance_stats();
  return settled_count;
end;
$$;

select app_private.settle_completed_tip_cards();

revoke all on function app_private.settle_completed_tip_cards()
from public, anon, authenticated;

comment on function app_private.settle_completed_tip_cards() is
  'Settles complete tip cards and refreshes existing race outcomes whenever official results or selected-entry evidence changes.';
