\set ON_ERROR_STOP on

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'auth.mfa_challenges',
    'auth.mfa_amr_claims',
    'auth.mfa_recovery_codes',
    'auth.mfa_recovery_code_sets',
    'auth.mfa_factors',
    'auth.webauthn_challenges',
    'auth.webauthn_credentials',
    'auth.one_time_tokens',
    'auth.refresh_tokens',
    'auth.sessions',
    'auth.flow_state',
    'auth.audit_log_entries',
    'auth.oauth_authorizations',
    'auth.oauth_client_states',
    'auth.oauth_consents',
    'auth.oauth_clients',
    'auth.custom_oauth_providers',
    'auth.saml_relay_states',
    'auth.scim_tokens',
    'auth.scim_users',
    'auth.sso_domains',
    'auth.sso_providers',
    'auth.saml_providers',
    'public.admin_email_confirmation_actions',
    'public.admin_user_notes',
    'public.audit_logs',
    'public.auth_email_delivery_events',
    'public.auth_email_messages',
    'public.auth_user_diagnostic_events',
    'public.blog_comment_reports',
    'public.notification_outbox',
    'public.notifications',
    'public.site_build_jobs',
    'public.tipster_application_documents',
    'app_private.hermes_race_job_events',
    'app_private.hermes_race_jobs',
    'app_private.hermes_race_rate_limits',
    'app_private.race_worker_tokens',
    'app_private.restricted_publishing_content_archive',
    'app_private.secondary_race_change_checks',
    'app_private.secondary_race_change_incidents',
    'app_private.secondary_race_change_observations',
    'app_private.telegram_race_feedback',
    'app_private.tip_notification_worker_tokens'
  ]
  loop
    if to_regclass(target_table) is not null then
      execute format('delete from %s', target_table);
    end if;
  end loop;
end
$$;

do $$
begin
  if to_regclass('cron.job') is not null then
    update cron.job set active = false where active;
  end if;
end
$$;

update auth.users
set email = 'user-' || replace(id::text, '-', '') || '@dev.mrcracing.test',
    phone = null,
    encrypted_password = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change_token_current = '',
    email_change = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    raw_app_meta_data = jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    raw_user_meta_data = jsonb_build_object('development_clone', true),
    is_sso_user = false,
    is_anonymous = false,
    updated_at = now();

delete from auth.identities
where provider <> 'email';

update auth.identities as identity
set email = cloned_user.email,
    provider_id = case when identity.provider = 'email' then cloned_user.email else identity.provider_id end,
    identity_data = jsonb_build_object(
      'sub', cloned_user.id::text,
      'email', cloned_user.email,
      'email_verified', true,
      'phone_verified', false,
      'development_clone', true
    ),
    updated_at = now()
from auth.users as cloned_user
where cloned_user.id = identity.user_id;

update public.profiles
set display_name = 'Development User ' || left(replace(id::text, '-', ''), 8),
    first_name = 'Development',
    last_name = 'User ' || left(replace(id::text, '-', ''), 8),
    phone = null,
    sms_notifications_enabled = false,
    sms_notifications_consented_at = null,
    sms_marketing_consented_at = null,
    email_notifications_enabled = false,
    email_marketing_consented_at = null,
    email_marketing_withdrawn_at = now(),
    email_marketing_consent_confirmed_at = null,
    email_marketing_consent_source = null,
    updated_at = now();

update public.tipster_applications
set legal_name = 'Development Applicant ' || left(replace(user_id::text, '-', ''), 8),
    display_name = 'Development Applicant ' || left(replace(user_id::text, '-', ''), 8),
    phone = null,
    experience_summary = 'Sanitized development application',
    signature_name = 'Development Clone',
    acceptance_confirmations = '{}'::jsonb,
    review_reason = null,
    updated_at = now();

update public.payments
set provider_reference = null,
    idempotency_key = 'dev-' || id::text,
    cart_fingerprint = 'dev-' || id::text,
    raw_event = jsonb_build_object('development_clone', true),
    updated_at = now();

update public.content_purchases
set idempotency_key = 'dev-' || id::text;

update public.tipster_earnings
set idempotency_key = 'dev-' || id::text;

update public.credit_transactions
set idempotency_key = 'dev-' || id::text,
    reason = case
      when reason is null then null
      else 'Sanitized development transaction'
    end;

update public.purchase_disputes
set reason = 'Sanitized development dispute',
    admin_notes = null;

update public.blog_comments
set moderation_note = null;

update public.blog_posts
set moderation_note = null;

update public.tipster_blog_permissions
set reason = 'Sanitized development permission';

update public.tip_card_change_alerts
set acknowledgement_note = null;

update public.charity_remittances
set reference = 'dev-' || id::text,
    notes = null,
    proof_path = null;

update public.user_account_controls
set internal_reason = case when internal_reason is null then null else 'Sanitized development control' end,
    public_message = case when public_message is null then null else 'Development account control' end,
    last_auth_sync_error = null,
    last_request_id = null,
    updated_at = now();

update public.blog_author_requests
set request_reason = case when request_reason is null then null else 'Sanitized development request' end,
    review_note = null,
    updated_at = now();
