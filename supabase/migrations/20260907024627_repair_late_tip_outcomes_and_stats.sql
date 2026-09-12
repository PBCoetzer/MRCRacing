create or replace function app_private.refresh_tipster_performance_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with effective_outcomes as (
    select
      outcomes.id,
      outcomes.tip_card_id,
      outcomes.selected_winner_entry_id,
      coalesce(
        selected_winner.result_position,
        outcomes.selected_winner_position
      ) as selected_winner_position,
      outcomes.selected_place_entry_id,
      coalesce(
        selected_place.result_position,
        outcomes.selected_place_position
      ) as selected_place_position
    from public.tip_card_race_outcomes outcomes
    left join public.race_entries selected_winner
      on selected_winner.id = outcomes.selected_winner_entry_id
    left join public.race_entries selected_place
      on selected_place.id = outcomes.selected_place_entry_id
  )
  insert into public.tipster_performance_stats (
    tipster_id,
    published_winner_tips,
    settled_winner_tips,
    winner_hits,
    winner_strike_rate,
    published_place_tips,
    settled_place_tips,
    place_hits,
    place_strike_rate,
    roi_percent,
    updated_at
  )
  select
    tipsters.id,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
        and outcomes.selected_winner_position is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
        and outcomes.selected_winner_position = 1
    )::integer,
    case
      when count(outcomes.id) filter (
        where outcomes.selected_winner_entry_id is not null
          and outcomes.selected_winner_position is not null
      ) = 0 then null
      else round(
        count(outcomes.id) filter (
          where outcomes.selected_winner_entry_id is not null
            and outcomes.selected_winner_position = 1
        )::numeric
          / count(outcomes.id) filter (
            where outcomes.selected_winner_entry_id is not null
              and outcomes.selected_winner_position is not null
          )::numeric * 100,
        2
      )
    end,
    count(outcomes.id) filter (
      where outcomes.selected_place_entry_id is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_place_entry_id is not null
        and outcomes.selected_place_position is not null
    )::integer,
    count(outcomes.id) filter (
      where outcomes.selected_place_entry_id is not null
        and outcomes.selected_place_position between 1 and 3
    )::integer,
    case
      when count(outcomes.id) filter (
        where outcomes.selected_place_entry_id is not null
          and outcomes.selected_place_position is not null
      ) = 0 then null
      else round(
        count(outcomes.id) filter (
          where outcomes.selected_place_entry_id is not null
            and outcomes.selected_place_position between 1 and 3
        )::numeric
          / count(outcomes.id) filter (
            where outcomes.selected_place_entry_id is not null
              and outcomes.selected_place_position is not null
          )::numeric * 100,
        2
      )
    end,
    null::numeric,
    now()
  from public.tipsters tipsters
  left join public.tip_cards cards
    on cards.tipster_id = tipsters.id
    and cards.status = 'settled'
  left join effective_outcomes outcomes
    on outcomes.tip_card_id = cards.id
  where tipsters.is_verified = true
  group by tipsters.id
  on conflict (tipster_id) do update
  set
    published_winner_tips = excluded.published_winner_tips,
    settled_winner_tips = excluded.settled_winner_tips,
    winner_hits = excluded.winner_hits,
    winner_strike_rate = excluded.winner_strike_rate,
    published_place_tips = excluded.published_place_tips,
    settled_place_tips = excluded.settled_place_tips,
    place_hits = excluded.place_hits,
    place_strike_rate = excluded.place_strike_rate,
    roi_percent = excluded.roi_percent,
    updated_at = excluded.updated_at;
end;
$$;

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
              )
              or (
                selections.place_entry_id is not null
                and selected_place.result_position is null
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
        )
        and (
          selections.place_entry_id is null
          or selected_place.result_position is not null
        )
      )
    )
  on conflict (tip_card_id, fixture_id) do nothing;

  perform app_private.refresh_tipster_performance_stats();
  return settled_count;
end;
$$;

drop trigger if exists protect_tip_card_race_outcomes
on public.tip_card_race_outcomes;

do $$
declare
  repair_count integer := 0;
  repair_records jsonb := '[]'::jsonb;
begin
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'outcomeId', outcomes.id,
          'fixtureId', outcomes.fixture_id,
          'previousEvidenceHash', outcomes.evidence_hash
        )
        order by outcomes.id
      ),
      '[]'::jsonb
    )
  into repair_count, repair_records
  from public.tip_card_race_outcomes outcomes
  join public.fixtures fixtures
    on fixtures.id = outcomes.fixture_id
  left join public.race_entries selected_winner
    on selected_winner.id = outcomes.selected_winner_entry_id
  left join public.race_entries selected_place
    on selected_place.id = outcomes.selected_place_entry_id
  left join lateral (
    select entries.id
    from public.race_entries entries
    where entries.fixture_id = fixtures.id
      and entries.result_position = 1
    order by entries.id
    limit 1
  ) official_winner on true
  where (
      outcomes.selected_winner_position is null
      and selected_winner.result_position is not null
    )
    or (
      outcomes.selected_place_position is null
      and selected_place.result_position is not null
    )
    or (
      outcomes.official_winner_entry_id is null
      and official_winner.id is not null
    )
    or (
      outcomes.result_summary is null
      and fixtures.result_summary is not null
    );

  if repair_count > 0 then
    with repair_values as (
      select
        outcomes.id,
        coalesce(
          outcomes.selected_winner_position,
          selected_winner.result_position
        ) as selected_winner_position,
        coalesce(
          outcomes.winner_hit,
          case
            when outcomes.selected_winner_entry_id is null
              or selected_winner.result_position is null then null
            else selected_winner.result_position = 1
          end
        ) as winner_hit,
        coalesce(
          outcomes.selected_place_position,
          selected_place.result_position
        ) as selected_place_position,
        coalesce(
          outcomes.official_winner_entry_id,
          official_winner.id
        ) as official_winner_entry_id,
        coalesce(
          outcomes.result_summary,
          fixtures.result_summary
        ) as result_summary,
        encode(
          extensions.digest(
            convert_to(
              jsonb_build_object(
                'fixtureId', fixtures.id,
                'resultSummary', coalesce(
                  outcomes.result_summary,
                  fixtures.result_summary
                ),
                'winnerEntryId', coalesce(
                  outcomes.official_winner_entry_id,
                  official_winner.id
                ),
                'winnerPosition', coalesce(
                  outcomes.selected_winner_position,
                  selected_winner.result_position
                ),
                'placePosition', coalesce(
                  outcomes.selected_place_position,
                  selected_place.result_position
                ),
                'sourceUpdatedAt', fixtures.source_updated_at
              )::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) as evidence_hash
      from public.tip_card_race_outcomes outcomes
      join public.fixtures fixtures
        on fixtures.id = outcomes.fixture_id
      left join public.race_entries selected_winner
        on selected_winner.id = outcomes.selected_winner_entry_id
      left join public.race_entries selected_place
        on selected_place.id = outcomes.selected_place_entry_id
      left join lateral (
        select entries.id
        from public.race_entries entries
        where entries.fixture_id = fixtures.id
          and entries.result_position = 1
        order by entries.id
        limit 1
      ) official_winner on true
      where (
          outcomes.selected_winner_position is null
          and selected_winner.result_position is not null
        )
        or (
          outcomes.selected_place_position is null
          and selected_place.result_position is not null
        )
        or (
          outcomes.official_winner_entry_id is null
          and official_winner.id is not null
        )
        or (
          outcomes.result_summary is null
          and fixtures.result_summary is not null
        )
    )
    update public.tip_card_race_outcomes outcomes
    set
      selected_winner_position = repair_values.selected_winner_position,
      winner_hit = repair_values.winner_hit,
      selected_place_position = repair_values.selected_place_position,
      official_winner_entry_id = repair_values.official_winner_entry_id,
      result_summary = repair_values.result_summary,
      evidence_hash = repair_values.evidence_hash
    from repair_values
    where outcomes.id = repair_values.id;

    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      metadata
    )
    values (
      null,
      'late_tip_card_outcomes_repaired',
      'tip_card_race_outcome',
      jsonb_build_object(
        'repairCount', repair_count,
        'reason', 'Official race results arrived after outcome settlement.',
        'records', repair_records,
        'repairedAt', now()
      )
    );
  end if;
end;
$$;

create trigger protect_tip_card_race_outcomes
before update or delete on public.tip_card_race_outcomes
for each row execute function app_private.reject_immutable_record_change();

select app_private.settle_completed_tip_cards();

revoke all on function app_private.refresh_tipster_performance_stats()
from public, anon, authenticated;

revoke all on function app_private.settle_completed_tip_cards()
from public, anon, authenticated;

comment on function app_private.settle_completed_tip_cards() is
  'Settles published tip cards only after terminal fixtures have complete official results and all selected runners have finishing positions.';
