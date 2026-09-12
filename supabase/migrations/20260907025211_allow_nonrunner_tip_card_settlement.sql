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
  on conflict (tip_card_id, fixture_id) do nothing;

  perform app_private.refresh_tipster_performance_stats();
  return settled_count;
end;
$$;

select app_private.settle_completed_tip_cards();

revoke all on function app_private.settle_completed_tip_cards()
from public, anon, authenticated;

comment on function app_private.settle_completed_tip_cards() is
  'Settles published tip cards after complete official results arrive, while treating scratched and withdrawn selections as terminal non-runners.';
