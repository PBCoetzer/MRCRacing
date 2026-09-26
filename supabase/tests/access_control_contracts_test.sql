begin;
select plan(40);

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

select is(
  (
    select count(*)::bigint
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'email_marketing_consent_confirmed_at',
        'email_marketing_consent_version',
        'email_marketing_consent_source'
      )
  ),
  3::bigint,
  'Profiles retain a versioned source and timestamp for explicit email choices'
);

select ok(
  has_function_privilege('authenticated', 'public.get_email_marketing_consent_status()', 'EXECUTE'),
  'Authenticated users can read their own email-consent prompt status'
);

select ok(
  not has_function_privilege('anon', 'public.get_email_marketing_consent_status()', 'EXECUTE'),
  'Anonymous users cannot read email-consent prompt status'
);

select ok(
  has_function_privilege('authenticated', 'public.respond_to_email_marketing_consent_prompt(boolean,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.respond_to_email_marketing_consent_prompt(boolean,text)', 'EXECUTE'),
  'Only authenticated users can answer the versioned email-consent prompt'
);

select ok(
  position(
    'email_marketing_consent_confirmed_at'
    in pg_get_functiondef('public.set_email_marketing_consent(boolean)'::regprocedure)
  ) > 0
    and position(
      'consentVersion'
      in pg_get_functiondef('public.set_email_marketing_consent(boolean)'::regprocedure)
    ) > 0,
  'Client dashboard email choices are explicit and versioned'
);

select ok(
  position(
    'email_choice_supplied'
    in pg_get_functiondef('app_private.handle_new_user()'::regprocedure)
  ) > 0
    and position(
      'email_marketing_consent_withdrawn'
      in pg_get_functiondef('app_private.handle_new_user()'::regprocedure)
    ) > 0,
  'Registration records both affirmative and declined email choices'
);

select ok(
  not has_function_privilege('anon', 'app_private.queue_tip_card_all_client_emails(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.queue_tip_card_all_client_emails(uuid,integer)', 'EXECUTE'),
  'The all-client email queue helper cannot be called directly from the Data API'
);

select ok(
  not has_function_privilege('anon', 'app_private.queue_blog_post_registered_user_emails(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.queue_blog_post_registered_user_emails(uuid)', 'EXECUTE'),
  'The registered-user blog email queue helper cannot be called directly from the Data API'
);

select ok(
  position(
    'queue_blog_post_registered_user_emails'
    in pg_get_functiondef('public.publish_blog_post(uuid)'::regprocedure)
  ) > 0
    and position(
      'not was_already_published'
      in pg_get_functiondef('public.publish_blog_post(uuid)'::regprocedure)
    ) > 0,
  'Blog email announcements are queued only for the first publication'
);

select ok(
  has_function_privilege('authenticated', 'public.create_blog_comment(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_blog_comment(uuid,text)', 'EXECUTE'),
  'Authenticated clients can comment while anonymous visitors cannot'
);

select ok(
  position(
    'current_user_account_active()'
    in pg_get_functiondef('public.create_blog_comment(uuid,text)'::regprocedure)
  ) > 0
    and position(
      'current_user_has_role(''client'')'
      in pg_get_functiondef('public.create_blog_comment(uuid,text)'::regprocedure)
    ) > 0,
  'Blog comments require an active client account'
);

select ok(
  has_function_privilege('authenticated', 'public.request_blog_author_access(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_blog_author_access(text)', 'EXECUTE'),
  'Any registered account can request blog author review'
);

select ok(
  position(
    'current_tipster_can_publish_blog()'
    in pg_get_functiondef('public.save_blog_post(uuid,text,text,text,text,text)'::regprocedure)
  ) > 0
    and position(
      'current_tipster_can_publish_blog()'
      in pg_get_functiondef('public.publish_blog_post(uuid)'::regprocedure)
    ) > 0
    and position(
      'current_tipster_can_publish_blog()'
      in pg_get_functiondef('public.archive_blog_post(uuid)'::regprocedure)
    ) > 0,
  'Creating, publishing, and archiving articles require approved author access'
);

select ok(
  position(
    'permissions.can_publish = true'
    in pg_get_functiondef('app_private.current_tipster_can_publish_blog()'::regprocedure)
  ) > 0
    and position(
      'current_user_account_active()'
      in pg_get_functiondef('app_private.current_tipster_can_publish_blog()'::regprocedure)
    ) > 0,
  'Blog author access requires an active account and an approved permission record'
);

select ok(
  not has_function_privilege('anon', 'app_private.current_tipster_can_publish_blog()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.current_tipster_can_publish_blog()', 'EXECUTE'),
  'The private blog permission helper is not directly exposed through the Data API'
);

select ok(
  position(
    'auth.mfa_factors'
    in pg_get_functiondef('app_private.current_user_mfa_satisfied(boolean)'::regprocedure)
  ) > 0
    and position(
      '''aal2'''
      in pg_get_functiondef('app_private.current_user_mfa_satisfied(boolean)'::regprocedure)
    ) > 0,
  'MFA satisfaction checks verified factors and the AAL2 JWT claim'
);

select ok(
  not has_function_privilege('anon', 'app_private.current_user_mfa_satisfied(boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.current_user_mfa_satisfied(boolean)', 'EXECUTE'),
  'The private MFA helper cannot be called directly by browser roles'
);

select ok(
  position(
    'current_user_mfa_satisfied(false)'
    in pg_get_functiondef('app_private.current_user_account_active()'::regprocedure)
  ) > 0,
  'Enrolled users must complete MFA before active-account operations'
);

select ok(
  has_function_privilege('authenticated', 'app_private.current_user_account_visible()', 'EXECUTE')
    and not has_function_privilege('anon', 'app_private.current_user_account_visible()', 'EXECUTE'),
  'Only authenticated users can evaluate the MFA identity bootstrap helper'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_roles'
      and policyname = 'user_roles_active_account'
      and permissive = 'RESTRICTIVE'
      and position('current_user_account_visible()' in coalesce(qual, '')) > 0
  ),
  'Active users can discover their own role before completing an MFA challenge'
);

select ok(
  position(
    'current_user_mfa_satisfied(true)'
    in pg_get_functiondef('app_private.current_user_has_role(public.app_role)'::regprocedure)
  ) > 0
    and position(
      '''administrator'''
      in pg_get_functiondef('app_private.current_user_has_role(public.app_role)'::regprocedure)
    ) > 0,
  'Administrator role checks always require MFA enrollment and AAL2'
);

select ok(
  position(
    'email_marketing_consent'
    in pg_get_functiondef('app_private.handle_new_user()'::regprocedure)
  ) > 0
    and position(
      'email_marketing_consented_at'
      in pg_get_functiondef('app_private.handle_new_user()'::regprocedure)
    ) > 0,
  'Registration persists explicit email-announcement consent on the new profile'
);

select ok(
  position(
    'email_marketing_consent_granted'
    in pg_get_functiondef('app_private.handle_new_user()'::regprocedure)
  ) > 0
    and position(
      'email_marketing_consent_version'
      in pg_get_functiondef('app_private.handle_new_user()'::regprocedure)
    ) > 0,
  'Registration records an auditable versioned email-announcement acceptance'
);

select ok(
  position(
    'join auth.users users'
    in pg_get_functiondef('app_private.queue_tip_card_all_client_emails(uuid,integer)'::regprocedure)
  ) > 0
    and position(
      'users.email_confirmed_at is not null'
      in pg_get_functiondef('app_private.queue_tip_card_all_client_emails(uuid,integer)'::regprocedure)
    ) > 0
    and position(
      'users.deleted_at is null'
      in pg_get_functiondef('app_private.queue_tip_card_all_client_emails(uuid,integer)'::regprocedure)
    ) > 0,
  'All-client meeting-card announcements require a confirmed, non-deleted Auth recipient'
);

select ok(
  position(
    'email_delivery_eligible'
    in pg_get_functiondef('app_private.queue_tip_card_notifications(uuid,integer,text)'::regprocedure)
  ) > 0
    and position(
      'users.email_confirmed_at is not null'
      in pg_get_functiondef('app_private.queue_tip_card_notifications(uuid,integer,text)'::regprocedure)
    ) > 0,
  'Entitlement and favourite-tipster meeting-card emails require a confirmed Auth recipient'
);

select ok(
  position(
    'users.created_at < now() - interval ''30 days'''
    in pg_get_functiondef('app_private.unconfirmed_account_cleanup_candidates(integer)'::regprocedure)
  ) > 0
    and position(
      'users.last_sign_in_at is null'
      in pg_get_functiondef('app_private.unconfirmed_account_cleanup_candidates(integer)'::regprocedure)
    ) > 0,
  'Stale-account cleanup candidates must be unconfirmed, unused registrations older than 30 days'
);

select ok(
  position(
    'roles.role in (''tipster'', ''administrator'')'
    in pg_get_functiondef('app_private.unconfirmed_account_cleanup_candidates(integer)'::regprocedure)
  ) > 0
    and position(
      'public.credit_transactions'
      in pg_get_functiondef('app_private.unconfirmed_account_cleanup_candidates(integer)'::regprocedure)
    ) > 0
    and position(
      'storage.objects'
      in pg_get_functiondef('app_private.unconfirmed_account_cleanup_candidates(integer)'::regprocedure)
    ) > 0,
  'Cleanup protects privileged, financial, and Storage-backed accounts'
);

select ok(
  position(
    'delete from auth.users'
    in lower(pg_get_functiondef('app_private.cleanup_stale_unconfirmed_accounts(integer)'::regprocedure))
  ) > 0
    and position(
      'stale_unconfirmed_accounts_cleanup'
      in pg_get_functiondef('app_private.cleanup_stale_unconfirmed_accounts(integer)'::regprocedure)
    ) > 0,
  'Cleanup permanently deletes eligible Auth users and records an aggregate audit event'
);

select ok(
  not has_function_privilege('anon', 'app_private.unconfirmed_account_cleanup_candidates(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.unconfirmed_account_cleanup_candidates(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'app_private.cleanup_stale_unconfirmed_accounts(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app_private.cleanup_stale_unconfirmed_accounts(integer)', 'EXECUTE'),
  'Browser roles cannot inspect or run stale-account cleanup functions'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'mrc-cleanup-stale-unconfirmed-accounts'
      and schedule = '30 0 * * *'
      and command = 'select app_private.cleanup_stale_unconfirmed_accounts(500);'
  ),
  'Stale unconfirmed account cleanup runs once daily'
);

select * from finish();
rollback;
