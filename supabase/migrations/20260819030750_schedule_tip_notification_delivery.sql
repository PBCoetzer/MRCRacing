create table if not exists app_private.tip_notification_worker_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table app_private.tip_notification_worker_tokens enable row level security;
revoke all on app_private.tip_notification_worker_tokens from public, anon, authenticated;

create or replace function app_private.verify_tip_notification_worker_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.tip_notification_worker_tokens
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and is_active
      and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.verify_tip_notification_worker_request(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    return false;
  end if;

  return app_private.verify_tip_notification_worker_token(p_token);
end;
$$;

revoke all on function app_private.verify_tip_notification_worker_token(text)
from public, anon, authenticated;
grant execute on function app_private.verify_tip_notification_worker_token(text)
to service_role;

revoke all on function public.verify_tip_notification_worker_request(text)
from public, anon, authenticated;
grant execute on function public.verify_tip_notification_worker_request(text)
to service_role;

do $$
declare
  worker_token text := encode(extensions.gen_random_bytes(32), 'hex');
  existing_secret_id uuid;
begin
  update app_private.tip_notification_worker_tokens
  set is_active = false
  where is_active;

  insert into app_private.tip_notification_worker_tokens (token_hash)
  values (encode(extensions.digest(worker_token, 'sha256'), 'hex'));

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'mrc_tip_notification_worker_token'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      worker_token,
      'mrc_tip_notification_worker_token',
      'Rotating token for scheduled MRC subscription notification delivery.'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      worker_token,
      'mrc_tip_notification_worker_token',
      'Rotating token for scheduled MRC subscription notification delivery.'
    );
  end if;

  perform cron.unschedule('mrc-process-tip-notifications')
  where exists (
    select 1 from cron.job where jobname = 'mrc-process-tip-notifications'
  );

  perform cron.schedule(
    'mrc-process-tip-notifications',
    '*/2 * * * *',
    $command$
      select net.http_post(
        url := 'https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/deliver-tip-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-mrc-notification-token', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'mrc_tip_notification_worker_token'
            limit 1
          )
        ),
        body := jsonb_build_object('trigger', 'cron'),
        timeout_milliseconds := 30000
      );
    $command$
  );
end;
$$;
