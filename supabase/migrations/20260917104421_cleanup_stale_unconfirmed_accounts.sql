create or replace function app_private.unconfirmed_account_cleanup_candidates(
  p_limit integer default 500
)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    users.id,
    users.email,
    users.created_at,
    users.created_at + interval '30 days'
  from auth.users users
  where users.email_confirmed_at is null
    and users.phone_confirmed_at is null
    and users.confirmed_at is null
    and users.last_sign_in_at is null
    and users.deleted_at is null
    and coalesce(users.is_anonymous, false) = false
    and coalesce(users.is_sso_user, false) = false
    and nullif(btrim(coalesce(users.email, '')), '') is not null
    and users.created_at < now() - interval '30 days'
    and not exists (
      select 1
      from public.user_roles roles
      where roles.user_id = users.id
        and roles.role in ('tipster', 'administrator')
    )
    and coalesce((
      select wallets.balance
      from public.wallets wallets
      where wallets.user_id = users.id
    ), 0) = 0
    and not exists (
      select 1 from public.payments payments
      where payments.user_id = users.id
    )
    and not exists (
      select 1 from public.credit_transactions transactions
      where transactions.user_id = users.id
    )
    and not exists (
      select 1 from public.content_purchases purchases
      where purchases.user_id = users.id
    )
    and not exists (
      select 1 from public.tipster_subscriptions subscriptions
      where subscriptions.user_id = users.id
    )
    and not exists (
      select 1 from public.tip_card_entitlements entitlements
      where entitlements.user_id = users.id
    )
    and not exists (
      select 1 from public.tip_unlocks unlocks
      where unlocks.user_id = users.id
    )
    and not exists (
      select 1
      from storage.objects objects
      where objects.owner = users.id
        or objects.owner_id = users.id::text
    )
  order by users.created_at, users.id
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function app_private.unconfirmed_account_cleanup_candidates(integer)
from public, anon, authenticated, service_role;

comment on function app_private.unconfirmed_account_cleanup_candidates(integer) is
  'Returns never-used email registrations older than 30 days that have no privileged role, Credits, financial history, entitlements, or Storage objects.';

create or replace function app_private.cleanup_stale_unconfirmed_accounts(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_run_id uuid := gen_random_uuid();
  candidate record;
  deleted_user_id uuid;
  expired_count integer := 0;
  candidate_count integer := 0;
  deleted_count integer := 0;
  skipped_count integer := 0;
  failed_count integer := 0;
  failures jsonb := '[]'::jsonb;
begin
  select count(*)::integer
  into expired_count
  from auth.users users
  where users.email_confirmed_at is null
    and users.phone_confirmed_at is null
    and users.confirmed_at is null
    and users.last_sign_in_at is null
    and users.deleted_at is null
    and coalesce(users.is_anonymous, false) = false
    and coalesce(users.is_sso_user, false) = false
    and nullif(btrim(coalesce(users.email, '')), '') is not null
    and users.created_at < now() - interval '30 days';

  for candidate in
    select *
    from app_private.unconfirmed_account_cleanup_candidates(p_limit)
  loop
    candidate_count := candidate_count + 1;
    deleted_user_id := null;

    begin
      update public.auth_email_messages messages
      set
        recipient_email = 'deleted+' ||
          left(encode(extensions.digest(lower(candidate.email), 'sha256'), 'hex'), 32) ||
          '@redacted.invalid',
        updated_at = now()
      where messages.user_id = candidate.user_id;

      delete from auth.users users
      where users.id = candidate.user_id
        and users.email_confirmed_at is null
        and users.phone_confirmed_at is null
        and users.confirmed_at is null
        and users.last_sign_in_at is null
        and users.deleted_at is null
        and coalesce(users.is_anonymous, false) = false
        and coalesce(users.is_sso_user, false) = false
        and users.created_at < now() - interval '30 days'
        and not exists (
          select 1
          from public.user_roles roles
          where roles.user_id = users.id
            and roles.role in ('tipster', 'administrator')
        )
        and coalesce((
          select wallets.balance
          from public.wallets wallets
          where wallets.user_id = users.id
        ), 0) = 0
        and not exists (
          select 1 from public.payments payments
          where payments.user_id = users.id
        )
        and not exists (
          select 1 from public.credit_transactions transactions
          where transactions.user_id = users.id
        )
        and not exists (
          select 1 from public.content_purchases purchases
          where purchases.user_id = users.id
        )
        and not exists (
          select 1 from public.tipster_subscriptions subscriptions
          where subscriptions.user_id = users.id
        )
        and not exists (
          select 1 from public.tip_card_entitlements entitlements
          where entitlements.user_id = users.id
        )
        and not exists (
          select 1 from public.tip_unlocks unlocks
          where unlocks.user_id = users.id
        )
        and not exists (
          select 1
          from storage.objects objects
          where objects.owner = users.id
            or objects.owner_id = users.id::text
        )
      returning users.id into deleted_user_id;

      if deleted_user_id is null then
        skipped_count := skipped_count + 1;
      else
        deleted_count := deleted_count + 1;
      end if;
    exception
      when others then
        failed_count := failed_count + 1;
        failures := failures || jsonb_build_array(jsonb_build_object(
          'userId', candidate.user_id,
          'sqlState', sqlstate
        ));
    end;
  end loop;

  insert into public.audit_logs (
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'stale_unconfirmed_accounts_cleanup',
    'system_maintenance',
    cleanup_run_id,
    jsonb_build_object(
      'retentionDays', 30,
      'expiredUnconfirmedCount', expired_count,
      'eligibleCandidateCount', candidate_count,
      'protectedCount', greatest(expired_count - candidate_count, 0),
      'deletedCount', deleted_count,
      'skippedCount', skipped_count,
      'failedCount', failed_count,
      'failures', failures
    )
  );

  return jsonb_build_object(
    'runId', cleanup_run_id,
    'retentionDays', 30,
    'expiredUnconfirmedCount', expired_count,
    'eligibleCandidateCount', candidate_count,
    'protectedCount', greatest(expired_count - candidate_count, 0),
    'deletedCount', deleted_count,
    'skippedCount', skipped_count,
    'failedCount', failed_count
  );
end;
$$;

revoke all on function app_private.cleanup_stale_unconfirmed_accounts(integer)
from public, anon, authenticated, service_role;

comment on function app_private.cleanup_stale_unconfirmed_accounts(integer) is
  'Permanently deletes unused, unconfirmed email registrations after 30 days while retaining accounts with privileged roles, Credits, financial history, entitlements, or Storage objects.';

do $$
begin
  perform cron.unschedule('mrc-cleanup-stale-unconfirmed-accounts')
  where exists (
    select 1
    from cron.job
    where jobname = 'mrc-cleanup-stale-unconfirmed-accounts'
  );

  perform cron.schedule(
    'mrc-cleanup-stale-unconfirmed-accounts',
    '30 0 * * *',
    'select app_private.cleanup_stale_unconfirmed_accounts(500);'
  );
end;
$$;
