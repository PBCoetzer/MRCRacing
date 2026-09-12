do $$
begin
  if not exists (
    select 1
    from app_private.tip_notification_worker_tokens
    where is_active
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Cannot enable tip notification delivery without an active worker token.';
  end if;

  if not exists (
    select 1
    from vault.secrets
    where name = 'mrc_tip_notification_worker_token'
  ) then
    raise exception 'Cannot enable tip notification delivery without its Vault secret.';
  end if;

  perform cron.unschedule('mrc-process-tip-notifications')
  where exists (
    select 1
    from cron.job
    where jobname = 'mrc-process-tip-notifications'
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
