begin;
select plan(16);

select has_column(
  'public',
  'race_tip_selections',
  'winner_selection_snapshot',
  'Winner selections retain a display fallback'
);

select has_column(
  'public',
  'race_tip_selections',
  'place_selection_snapshot',
  'Place selections retain a display fallback'
);

select has_function(
  'app_private',
  'capture_race_tip_selection_snapshots',
  array[]::text[],
  'Selection snapshot trigger function exists'
);

select has_trigger(
  'public',
  'race_tip_selections',
  'capture_race_tip_selection_snapshots',
  'Selection snapshot trigger is installed'
);

select is(
  (
    select count(*)::bigint
    from public.race_tip_selections selections
    where (selections.winner_entry_id is not null and selections.winner_selection_snapshot is null)
       or (selections.place_entry_id is not null and selections.place_selection_snapshot is null)
  ),
  0::bigint,
  'Existing saved selections are backfilled'
);

select has_function(
  'app_private',
  'enforce_tipster_subscription_duration',
  array[]::text[],
  'Subscription duration trigger function exists'
);

select has_trigger(
  'public',
  'tipster_subscriptions',
  'enforce_tipster_subscription_duration',
  'Subscription duration trigger is installed'
);

select ok(
  position(
    'interval ''30 days'''
    in pg_get_functiondef('public.purchase_tipster_subscription(uuid,text)'::regprocedure)
  ) > 0,
  'One-month purchases use exactly 30 days'
);

select ok(
  position(
    'subscriptions.status = ''active'''
    in pg_get_functiondef('app_private.user_can_access_tip_card(uuid,uuid)'::regprocedure)
  ) > 0,
  'Card authorization requires an active linked subscription'
);

select ok(
  position(
    'now() < subscriptions.ends_at'
    in pg_get_functiondef('app_private.user_can_access_tip_card(uuid,uuid)'::regprocedure)
  ) > 0,
  'Card authorization enforces the subscription end timestamp'
);

select ok(
  position(
    'entitlements.source_type = ''meeting'''
    in pg_get_functiondef('app_private.user_can_access_tip_card(uuid,uuid)'::regprocedure)
  ) > 0,
  'One-off meeting purchases remain valid independently'
);

select has_function(
  'app_private',
  'process_tipster_subscription_lifecycle',
  array[]::text[],
  'Subscription lifecycle worker exists'
);

select ok(
  position(
    'tipster_subscription_expiring'
    in pg_get_functiondef('app_private.process_tipster_subscription_lifecycle()'::regprocedure)
  ) > 0,
  'Lifecycle queues the deduplicated expiry warning'
);

select ok(
  position(
    'entitlements.source_type = ''subscription'''
    in pg_get_functiondef('app_private.process_tipster_subscription_lifecycle()'::regprocedure)
  ) > 0,
  'Lifecycle revokes only subscription-sourced entitlements'
);

select is(
  (
    select count(*)::bigint
    from public.tipster_subscriptions subscriptions
    where subscriptions.status = 'active'
      and subscriptions.ends_at <= now()
  ),
  0::bigint,
  'No ended subscription remains active after lifecycle processing'
);

select is(
  (
    select count(*)::bigint
    from cron.job jobs
    where jobs.jobname = 'mrc-tipster-subscription-lifecycle'
      and jobs.schedule = '17 * * * *'
  ),
  1::bigint,
  'The hourly subscription lifecycle schedule is installed once'
);

select * from finish();
rollback;
