begin;
select plan(11);

select is(
  (
    select count(*)::bigint
    from pg_class relations
    join pg_namespace schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'public'
      and relations.relkind in ('r', 'p')
      and not relations.relrowsecurity
  ),
  0::bigint,
  'Every public table has row-level security enabled'
);

select is(
  (
    select count(*)::bigint
    from pg_class relations
    join pg_namespace schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'app_private'
      and relations.relkind in ('r', 'p')
      and (
        has_table_privilege('anon', relations.oid, 'SELECT')
        or has_table_privilege('anon', relations.oid, 'INSERT')
        or has_table_privilege('anon', relations.oid, 'UPDATE')
        or has_table_privilege('anon', relations.oid, 'DELETE')
      )
  ),
  0::bigint,
  'Anonymous users have no app_private table privileges'
);

select is(
  (
    select count(*)::bigint
    from pg_class relations
    join pg_namespace schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'app_private'
      and relations.relkind in ('r', 'p')
      and (
        has_table_privilege('authenticated', relations.oid, 'SELECT')
        or has_table_privilege('authenticated', relations.oid, 'INSERT')
        or has_table_privilege('authenticated', relations.oid, 'UPDATE')
        or has_table_privilege('authenticated', relations.oid, 'DELETE')
      )
  ),
  0::bigint,
  'Authenticated users have no app_private table privileges'
);

select ok(
  not has_table_privilege('anon', 'public.site_build_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.site_build_jobs', 'SELECT'),
  'The public site-build queue remains server-only'
);

select is(
  (
    select count(*)::bigint
    from pg_proc functions
    join pg_namespace schemas on schemas.oid = functions.pronamespace
    where schemas.nspname = 'public'
      and functions.prosecdef
      and has_function_privilege('anon', functions.oid, 'EXECUTE')
      and functions.proname <> all(array[
        'get_charity_transparency',
        'get_pinned_blog_post',
        'get_public_blog_article',
        'get_public_blog_post',
        'get_public_build_manifest',
        'get_public_race_meeting',
        'get_public_tipster_profile',
        'list_public_blog_posts'
      ]::text[])
  ),
  0::bigint,
  'Anonymous execution is limited to the public read-RPC allowlist'
);

select is(
  (
    select count(distinct functions.proname)::bigint
    from pg_proc functions
    join pg_namespace schemas on schemas.oid = functions.pronamespace
    where schemas.nspname = 'public'
      and functions.prosecdef
      and has_function_privilege('anon', functions.oid, 'EXECUTE')
      and functions.proname = any(array[
        'get_charity_transparency',
        'get_pinned_blog_post',
        'get_public_blog_article',
        'get_public_blog_post',
        'get_public_build_manifest',
        'get_public_race_meeting',
        'get_public_tipster_profile',
        'list_public_blog_posts'
      ]::text[])
  ),
  8::bigint,
  'Every approved anonymous read RPC remains available'
);

select is(
  (
    select count(*)::bigint
    from pg_proc functions
    join pg_namespace schemas on schemas.oid = functions.pronamespace
    where functions.prosecdef
      and schemas.nspname in ('public', 'app_private')
      and not exists (
        select 1
        from unnest(coalesce(functions.proconfig, array[]::text[])) as settings(value)
        where settings.value like 'search_path=%'
      )
  ),
  0::bigint,
  'Every application security-definer function pins an explicit search path'
);

select ok(
  not has_function_privilege('anon', 'public.admin_get_user_detail(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_adjust_wallet_v2(uuid,integer,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.resolve_purchase_dispute(uuid,boolean,text)', 'EXECUTE'),
  'Anonymous users cannot execute sampled privileged RPCs'
);

select ok(
  has_function_privilege('authenticated', 'public.set_email_marketing_consent(boolean)', 'EXECUTE'),
  'Authenticated users can manage their own email marketing consent'
);

select ok(
  not has_function_privilege('anon', 'public.set_email_marketing_consent(boolean)', 'EXECUTE'),
  'Anonymous users cannot manage email marketing consent'
);

select ok(
  not has_function_privilege('anon', 'app_private.queue_tip_card_all_client_emails(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.queue_tip_card_all_client_emails(uuid,integer)', 'EXECUTE'),
  'The all-client email queue helper cannot be called directly from the Data API'
);

select * from finish();
rollback;
