begin;
select plan(7);

select ok(
  position(
    'when ''result_refresh'' then 1'
    in lower(pg_get_functiondef(
      'app_private.claim_hermes_race_job(text)'::regprocedure
    ))
  ) > 0,
  'Hermes result refreshes have first claim priority'
);

select ok(
  position(
    'normalized_status <> ''failed'' and not delegated_pending'
    in lower(pg_get_functiondef(
      'public.complete_race_feed_task_plan(uuid,uuid,text,text,text,integer,integer,jsonb,timestamptz)'::regprocedure
    ))
  ) > 0,
  'Delegated jobs do not report completion before Hermes returns'
);

select ok(
  position(
    'selections.winner_entry_id = official_winner.id'
    in lower(pg_get_functiondef(
      'app_private.settle_completed_tip_cards()'::regprocedure
    ))
  ) > 0,
  'Winner accuracy compares the selection to the verified official winner'
);

select ok(
  position(
    'and selected_winner.result_position is null'
    in lower(pg_get_functiondef(
      'app_private.settle_completed_tip_cards()'::regprocedure
    ))
  ) = 0,
  'A missing losing-runner position no longer blocks card settlement'
);

select ok(
  position(
    'and outcomes.winner_hit is not null'
    in lower(pg_get_functiondef(
      'app_private.refresh_tipster_performance_stats()'::regprocedure
    ))
  ) > 0,
  'Winner strike-rate samples use resolved winner outcomes'
);

select ok(
  position(
    'old.selected_winner_entry_id = canonical_official_winner_id'
    in lower(pg_get_functiondef(
      'app_private.enforce_tip_card_race_outcome_refresh()'::regprocedure
    ))
  ) > 0,
  'The immutable outcome guard accepts canonical winner comparison results'
);

select ok(
  position(
    'and outcomes.selected_place_position is not null'
    in lower(pg_get_functiondef(
      'app_private.refresh_tipster_performance_stats()'::regprocedure
    ))
  ) > 0,
  'Place strike-rate samples still require an exact finishing position'
);

select * from finish();
rollback;
