do $$
begin
  perform cron.unschedule('mrc-process-tip-notifications')
  where exists (
    select 1 from cron.job where jobname = 'mrc-process-tip-notifications'
  );

  perform cron.schedule(
    'mrc-process-tip-notifications',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := 'https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/process-tip-notifications',
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
    $job$
  );
end;
$$;
