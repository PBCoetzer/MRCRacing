begin;
select plan(19);

select has_table(
  'public',
  'tipster_payout_requests',
  'Tipster payout requests are stored separately from earnings history'
);

select has_table(
  'public',
  'tipster_payout_request_items',
  'Payout requests have immutable earning-row assignments'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.tipster_payout_requests'::regclass
  ),
  'Payout requests have row-level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.tipster_payout_request_items'::regclass
  ),
  'Payout request items have row-level security enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.tipster_payout_requests', 'SELECT')
    and not has_table_privilege('authenticated', 'public.tipster_payout_request_items', 'SELECT'),
  'Authenticated users cannot read payout tables directly'
);

select ok(
  has_function_privilege('authenticated', 'public.get_my_tipster_finance_dashboard(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_my_tipster_finance_dashboard(integer)', 'EXECUTE'),
  'Only authenticated callers can reach the Tipster finance dashboard'
);

select ok(
  not has_function_privilege('authenticated', 'public.request_my_tipster_payout()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_my_tipster_payout()', 'EXECUTE'),
  'Tipster payout requests remain frozen until cutover verification completes'
);

select ok(
  not has_function_privilege('authenticated', 'public.confirm_my_tipster_payout_received(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.confirm_my_tipster_payout_received(uuid)', 'EXECUTE'),
  'Tipster payout receipt confirmation remains frozen until cutover verification completes'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_mark_tipster_payout_paid(uuid,text,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.admin_mark_tipster_payout_paid(uuid,text,text)',
      'EXECUTE'
    ),
  'Administrator payout settlement remains frozen until cutover verification completes'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_get_tipster_payout_dashboard(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_get_tipster_payout_dashboard(integer)', 'EXECUTE'),
  'Only authenticated callers can reach the administrator payout dashboard'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)',
      'EXECUTE'
    ),
  'Only authenticated callers can reach the current-period ledger export'
);

select ok(
  pg_get_functiondef('public.admin_get_tipster_payout_dashboard(integer)'::regprocedure)
    like '%current_user_has_role(''administrator'')%'
    and pg_get_functiondef(
      'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)'::regprocedure
    ) like '%current_user_has_role(''administrator'')%',
  'Administrator payout and report functions enforce administrator authorization'
);

select ok(
  pg_get_functiondef('public.get_my_tipster_finance_dashboard(integer)'::regprocedure)
    like '%content-spend-10-20-70-v2-forward-only%'
    and pg_get_functiondef('public.request_my_tipster_payout()'::regprocedure)
      like '%content-spend-10-20-70-v2-forward-only%'
    and pg_get_functiondef(
      'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)'::regprocedure
    ) like '%content-spend-10-20-70-v2-forward-only%',
  'Tipster finance, payout creation, and exports are bound to the forward allocation version'
);

select ok(
  pg_get_functiondef(
    'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)'::regprocedure
  ) like '%greatest(coalesce(p_from, period_row.starts_at), period_row.starts_at)%',
  'Administrator exports cannot request rows before the forward period started'
);

select ok(
  pg_get_functiondef('public.get_my_tipster_finance_dashboard(integer)'::regprocedure)
    like '%purchases.purchased_coins = 0%'
    and pg_get_functiondef('public.get_my_tipster_finance_dashboard(integer)'::regprocedure)
      like '%not_applicable%',
  'The Tipster ledger shows reward-only purchases without making them payout eligible'
);

select ok(
  pg_get_functiondef(
    'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)'::regprocedure
  ) like '%purchases.purchased_coins = 0%'
    and pg_get_functiondef(
      'public.admin_get_current_revenue_ledger(timestamptz,timestamptz,uuid,integer)'::regprocedure
    ) like '%not_applicable%',
  'The administrator ledger includes reward-only purchases with zero beneficiary allocations'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'tipster_payout_requests_open_tipster_key'
      and indexdef like '%WHERE (status = ANY%'
  ),
  'Only one open payout request can exist for each Tipster'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tipster_payout_request_items'::regclass
      and conname = 'tipster_payout_request_items_earning_key'
  ),
  'An earning row can be assigned to only one payout request'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.tipster_payout_request_items'::regclass
      and tgname = 'tipster_payout_request_items_immutable'
      and not tgisinternal
  ),
  'Payout earning assignments are protected from update or deletion'
);

select * from finish();
rollback;
