begin;
select plan(13);

select is(
  (
    select jsonb_build_object(
      'status', status,
      'reliability', reliability_score,
      'directFetch', direct_fetch_allowed,
      'autoApprove', can_auto_approve
    )
    from public.race_source_domains
    where domain = 'formgrids.info'
  ),
  jsonb_build_object(
    'status', 'approved',
    'reliability', 100,
    'directFetch', true,
    'autoApprove', true
  ),
  'Formgrids is the authoritative publishing source'
);

select is(
  (
    select count(*)::bigint
    from public.race_source_domains
    where domain in ('raceform.co.za', 'tote.co.za')
      and status = 'evidence_only'
      and direct_fetch_allowed
      and not can_auto_approve
  ),
  2::bigint,
  'Raceform and Tote are enabled only as comparison evidence'
);

select is(
  (
    select count(*)::bigint
    from pg_class relations
    join pg_namespace schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'app_private'
      and relations.relname in (
        'secondary_race_change_checks',
        'secondary_race_change_observations',
        'secondary_race_change_incidents'
      )
      and relations.relrowsecurity
      and relations.relforcerowsecurity
  ),
  3::bigint,
  'Secondary comparison evidence is stored in forced-RLS private tables'
);

select ok(
  to_regprocedure('public.record_secondary_race_change_list(uuid,text,text,timestamptz,text,jsonb)') is not null,
  'The deterministic comparison-list RPC exists'
);

select ok(
  to_regprocedure('public.record_secondary_race_change_snapshot(uuid,text,text,timestamptz,text,jsonb)') is not null,
  'The isolated comparison-snapshot RPC exists'
);

select ok(
  to_regprocedure('public.get_secondary_tote_change_targets(date)') is not null,
  'The Tote comparison worker can load same-day targets'
);

select ok(
  to_regprocedure('public.apply_official_tote_card_changes(uuid,text,timestamptz,text,jsonb)') is null,
  'No secondary-source RPC can directly apply Tote changes'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_secondary_race_change_list(uuid,text,text,timestamptz,text,jsonb)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.record_secondary_race_change_list(uuid,text,text,timestamptz,text,jsonb)',
    'EXECUTE'
  ),
  'Public users cannot submit secondary comparison evidence'
);

select ok(
  position(
    'count(distinct observations.source_domain) >= 2'
    in lower(pg_get_functiondef(
      'app_private.refresh_secondary_race_change_consensus(uuid)'::regprocedure
    ))
  ) > 0,
  'Consensus requires at least two independent secondary domains'
);

select ok(
  position(
    'jsonb_build_array(''formgrids.info'')'
    in lower(pg_get_functiondef(
      'app_private.prefer_formgrids_for_hermes_task()'::regprocedure
    ))
  ) > 0,
  'Ordinary Hermes tasks are restricted to Formgrids'
);

select ok(
  position(
    '''secondarysourcescanautoapply'', false'
    in lower(pg_get_functiondef(
      'app_private.process_race_feed_proposal_gate()'::regprocedure
    ))
  ) > 0,
  'The proposal gate records that secondary sources cannot auto-apply'
);

select is(
  (
    select count(*)::bigint
    from cron.job
    where jobname = 'mrc-sync-secondary-tote-changes'
      and active
      and schedule = '*/3 3-18 * * *'
  ),
  1::bigint,
  'Tote comparisons run every three minutes during race-day hours'
);

select is(
  (
    select count(*)::bigint
    from cron.job
    where jobname = 'mrc-queue-secondary-race-comparisons'
      and active
      and schedule = '*/10 * * * *'
  ),
  1::bigint,
  'Raceform comparisons are queued every ten minutes'
);

select * from finish();
rollback;
