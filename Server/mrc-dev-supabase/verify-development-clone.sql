\set ON_ERROR_STOP on

do $$
declare
  unsafe_email_count bigint;
  active_session_count bigint;
  unsafe_identity_count bigint;
  unsafe_payment_count bigint;
  queued_notification_count bigint;
  invalid_wallet_count bigint;
  negative_wallet_count bigint;
  active_cron_count bigint := 0;
begin
  select count(*) into unsafe_email_count
  from auth.users
  where email is null or email not like '%@dev.mrcracing.test';
  if unsafe_email_count <> 0 then
    raise exception 'Development clone contains % unsafe auth email(s).', unsafe_email_count;
  end if;

  select
    (select count(*) from auth.sessions)
    + (select count(*) from auth.refresh_tokens)
    + (select count(*) from auth.mfa_factors)
    + (select count(*) from auth.one_time_tokens)
  into active_session_count;
  if active_session_count <> 0 then
    raise exception 'Development clone contains % session, MFA, or one-time-token row(s).', active_session_count;
  end if;

  select count(*) into unsafe_identity_count
  from auth.identities
  where provider <> 'email'
     or email is null
     or email not like '%@dev.mrcracing.test';
  if unsafe_identity_count <> 0 then
    raise exception 'Development clone contains % unsafe identity row(s).', unsafe_identity_count;
  end if;

  select count(*) into unsafe_payment_count
  from public.payments
  where provider_reference is not null
     or idempotency_key not like 'dev-%'
     or cart_fingerprint not like 'dev-%'
     or coalesce(raw_event, '{}'::jsonb) <> jsonb_build_object('development_clone', true);
  if unsafe_payment_count <> 0 then
    raise exception 'Development clone contains % unsanitized payment row(s).', unsafe_payment_count;
  end if;

  select
    (select count(*) from public.notification_outbox)
    + (select count(*) from public.site_build_jobs)
  into queued_notification_count;
  if queued_notification_count <> 0 then
    raise exception 'Development clone contains % queued outbound job(s).', queued_notification_count;
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job where active' into active_cron_count;
  end if;
  if active_cron_count <> 0 then
    raise exception 'Development clone contains % active cron job(s).', active_cron_count;
  end if;

  select count(*) into invalid_wallet_count
  from public.wallets
  where balance <> purchased_balance + reward_balance;
  if invalid_wallet_count <> 0 then
    raise exception 'Development clone contains % wallet total mismatch(es).', invalid_wallet_count;
  end if;

  select count(*) into negative_wallet_count
  from public.wallets
  where balance < 0 or purchased_balance < 0 or reward_balance < 0;
  if negative_wallet_count <> 0 then
    raise exception 'Development clone contains % negative wallet balance(s).', negative_wallet_count;
  end if;
end
$$;

select 'auth_users' as metric, count(*)::bigint as value from auth.users
union all select 'wallets', count(*) from public.wallets
union all select 'payments', count(*) from public.payments
union all select 'content_purchases', count(*) from public.content_purchases
union all select 'tipster_earnings', count(*) from public.tipster_earnings
union all select 'tip_cards', count(*) from public.tip_cards
order by metric;
