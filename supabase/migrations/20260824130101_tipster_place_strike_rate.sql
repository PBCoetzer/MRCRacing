alter table public.tipster_performance_stats
  add column if not exists published_place_tips integer not null default 0,
  add column if not exists settled_place_tips integer not null default 0,
  add column if not exists place_hits integer not null default 0,
  add column if not exists place_strike_rate numeric(6, 2);

alter table public.tipster_performance_stats
  add constraint tipster_performance_stats_published_place_nonnegative_check
    check (published_place_tips >= 0),
  add constraint tipster_performance_stats_settled_place_nonnegative_check
    check (settled_place_tips >= 0),
  add constraint tipster_performance_stats_place_hits_nonnegative_check
    check (place_hits >= 0),
  add constraint tipster_performance_stats_place_rate_check
    check (place_strike_rate is null or place_strike_rate between 0 and 100),
  add constraint tipster_performance_stats_place_hits_lte_settled_check
    check (place_hits <= settled_place_tips);

comment on column public.tipster_performance_stats.place_hits is
  'Best Place Bet selections that finished in the official top three. This is an MRC performance metric and does not represent bookmaker paid-place terms or winnings.';

comment on column public.tipster_performance_stats.place_strike_rate is
  'Percentage of settled Best Place Bet selections that finished in the official top three.';

create or replace function app_private.refresh_tipster_performance_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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
    count(outcomes.id) filter (where outcomes.winner_hit = true)::integer,
    case
      when count(outcomes.id) filter (
        where outcomes.selected_winner_entry_id is not null
          and outcomes.selected_winner_position is not null
      ) = 0 then null
      else round(
        count(outcomes.id) filter (where outcomes.winner_hit = true)::numeric
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
  left join public.tip_card_race_outcomes outcomes
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
    'placeStrikeRate', stats.place_strike_rate,
    'settledPlaceTips', coalesce(stats.settled_place_tips, 0),
    'placeHits', coalesce(stats.place_hits, 0),
    'statsUpdatedAt', stats.updated_at,
    'updatedAt', tipsters.updated_at
  )
  from public.tipsters tipsters
  left join public.tipster_performance_stats stats
    on stats.tipster_id = tipsters.id
  where tipsters.is_verified
    and tipsters.slug = btrim(p_slug)
  limit 1;
$$;

select app_private.refresh_tipster_performance_stats();

grant select on table public.tipster_performance_stats to anon, authenticated;

revoke all on function app_private.refresh_tipster_performance_stats()
from public, anon, authenticated;

revoke all on function public.get_public_tipster_profile(text) from public;
grant execute on function public.get_public_tipster_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';
