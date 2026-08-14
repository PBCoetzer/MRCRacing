create or replace function public.request_purchase_dispute(
  p_purchase_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  dispute_row public.purchase_disputes%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.content_purchases
    where id = p_purchase_id
      and user_id = current_user_id
      and status = 'active'
  ) then
    raise exception 'Purchase is not eligible for a dispute.';
  end if;

  insert into public.purchase_disputes (
    purchase_id,
    user_id,
    reason
  )
  values (
    p_purchase_id,
    current_user_id,
    btrim(p_reason)
  )
  returning * into dispute_row;

  update public.content_purchases
  set status = 'disputed'
  where id = p_purchase_id;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'purchase_dispute_opened',
    'purchase_dispute',
    dispute_row.id,
    jsonb_build_object('purchaseId', p_purchase_id)
  );

  return to_jsonb(dispute_row);
end;
$$;

create or replace function public.resolve_purchase_dispute(
  p_dispute_id uuid,
  p_approve_refund boolean,
  p_admin_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  dispute_row public.purchase_disputes%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  select *
  into dispute_row
  from public.purchase_disputes
  where id = p_dispute_id
    and status = 'open'
  for update;

  if dispute_row.id is null then
    raise exception 'Open dispute not found.';
  end if;

  if p_approve_refund then
    perform app_private.refund_content_purchase(
      dispute_row.purchase_id,
      'Administrator approved purchase dispute.',
      current_user_id
    );
  else
    update public.content_purchases
    set status = 'active'
    where id = dispute_row.purchase_id
      and status = 'disputed';
  end if;

  update public.purchase_disputes
  set
    status = case when p_approve_refund then 'approved' else 'rejected' end,
    admin_notes = nullif(btrim(coalesce(p_admin_notes, '')), ''),
    resolved_by = current_user_id,
    resolved_at = now()
  where id = dispute_row.id
  returning * into dispute_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'purchase_dispute_resolved',
    'purchase_dispute',
    dispute_row.id,
    jsonb_build_object(
      'approvedRefund', p_approve_refund,
      'purchaseId', dispute_row.purchase_id
    )
  );

  return to_jsonb(dispute_row);
end;
$$;

create or replace function public.admin_refund_purchase(
  p_purchase_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  return app_private.refund_content_purchase(
    p_purchase_id,
    btrim(p_reason),
    (select auth.uid())
  );
end;
$$;

create or replace function public.claim_tip_notification_jobs(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jobs jsonb;
begin
  with queue_messages as (
    select *
    from pgmq.read(
      'tip_notifications',
      120,
      greatest(1, least(coalesce(p_limit, 20), 100))
    )
  ),
  claimed as (
    update public.notification_outbox o
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now()
    from queue_messages q
    where o.id = (q.message ->> 'outboxId')::uuid
      and (
        o.status in ('pending', 'failed')
        or (
          o.status = 'processing'
          and o.locked_at < now() - interval '2 minutes'
        )
      )
      and o.available_at <= now()
      and o.attempt_count < 8
    returning
      o.id,
      o.user_id,
      o.event_type,
      o.dedupe_key,
      o.payload,
      o.attempt_count,
      q.msg_id as queue_message_id
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  into jobs
  from claimed;

  return jobs;
end;
$$;

create or replace function public.complete_tip_notification_job(
  p_outbox_id uuid,
  p_queue_message_id bigint,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox
  set
    status = 'delivered',
    provider_message_id = nullif(p_provider_message_id, ''),
    delivered_at = now(),
    locked_at = null,
    last_error = null
  where id = p_outbox_id;

  perform pgmq.delete('tip_notifications', p_queue_message_id);
end;
$$;

create or replace function public.fail_tip_notification_job(
  p_outbox_id uuid,
  p_queue_message_id bigint,
  p_error text,
  p_retry_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_delay integer := greatest(30, least(coalesce(p_retry_seconds, 300), 86400));
  current_attempt_count integer;
begin
  update public.notification_outbox
  set
    status = 'failed',
    available_at = now() + make_interval(secs => new_delay),
    locked_at = null,
    last_error = left(coalesce(p_error, 'Unknown delivery error'), 1000)
  where id = p_outbox_id;

  select attempt_count
  into current_attempt_count
  from public.notification_outbox
  where id = p_outbox_id;

  perform pgmq.delete('tip_notifications', p_queue_message_id);

  if coalesce(current_attempt_count, 0) < 8 then
    perform pgmq.send(
      'tip_notifications',
      jsonb_build_object('outboxId', p_outbox_id),
      new_delay
    );
  end if;
end;
$$;

create or replace function public.process_due_meeting_refunds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.current_user_has_role('administrator')
    and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
  then
    raise exception 'Administrator access required.';
  end if;

  return app_private.refund_due_meeting_purchases();
end;
$$;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'mrc-refund-unpublished-meeting-cards'
  ) then
    perform cron.schedule(
      'mrc-refund-unpublished-meeting-cards',
      '*/5 * * * *',
      'select app_private.refund_due_meeting_purchases();'
    );
  end if;
end $$;

;
