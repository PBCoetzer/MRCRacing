do $unschedule$
declare
  refund_job_id bigint;
begin
  for refund_job_id in
    select jobid
    from cron.job
    where jobname = 'mrc-refund-unpublished-meeting-cards'
  loop
    perform cron.unschedule(refund_job_id);
  end loop;
end;
$unschedule$;

create or replace function app_private.refund_due_meeting_purchases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return 0;
end;
$$;

revoke all on function app_private.refund_due_meeting_purchases()
from public, anon, authenticated, service_role;

comment on function app_private.refund_due_meeting_purchases() is
  'Legacy compatibility no-op. Meeting and subscription purchases are refunded only after an administrator approves a client refund request.';

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

  return 0;
end;
$$;

revoke all on function public.process_due_meeting_refunds()
from public, anon;
grant execute on function public.process_due_meeting_refunds()
to authenticated, service_role;

comment on function public.process_due_meeting_refunds() is
  'Legacy compatibility no-op. Automatic purchase refunds are disabled.';

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

  raise exception 'Direct refunds are disabled. Approve an open client refund request instead.';
end;
$$;

revoke all on function public.admin_refund_purchase(uuid, text)
from public, anon, authenticated, service_role;

comment on function public.admin_refund_purchase(uuid, text) is
  'Disabled direct-refund compatibility endpoint. Refunds require a client request and administrator resolution.';

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
  normalized_reason text := btrim(coalesce(p_reason, ''));
  purchase_row record;
  dispute_row public.purchase_disputes%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is currently restricted.';
  end if;

  if char_length(normalized_reason) < 10 or char_length(normalized_reason) > 2000 then
    raise exception 'Explain the refund request in 10 to 2,000 characters.';
  end if;

  select purchases.id
  into purchase_row
  from public.content_purchases purchases
  where purchases.id = p_purchase_id
    and purchases.user_id = current_user_id
    and purchases.status = 'active'
  for update;

  if purchase_row.id is null then
    raise exception 'Purchase is not eligible for a refund request.';
  end if;

  insert into public.purchase_disputes (
    purchase_id,
    user_id,
    reason
  )
  values (
    p_purchase_id,
    current_user_id,
    normalized_reason
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
    'purchase_refund_requested',
    'purchase_dispute',
    dispute_row.id,
    jsonb_build_object('purchaseId', p_purchase_id)
  );

  return to_jsonb(dispute_row);
end;
$$;

revoke all on function public.request_purchase_dispute(uuid, text)
from public, anon;
grant execute on function public.request_purchase_dispute(uuid, text)
to authenticated;

comment on function public.request_purchase_dispute(uuid, text) is
  'Lets the purchasing client request a refund review without issuing any refund.';

create or replace function app_private.refund_content_purchase(
  target_purchase_id uuid,
  refund_reason text,
  refund_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  purchase_row record;
  wallet_row record;
  refund_transaction_id uuid := gen_random_uuid();
begin
  if current_user_id is null
    or refund_actor_id is distinct from current_user_id
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator approval is required.';
  end if;

  if not exists (
    select 1
    from public.purchase_disputes disputes
    where disputes.purchase_id = target_purchase_id
      and disputes.status = 'approved'
      and disputes.resolved_by = current_user_id
  ) then
    raise exception 'An approved client refund request is required.';
  end if;

  select * into purchase_row
  from public.content_purchases
  where id = target_purchase_id
  for update;

  if purchase_row.id is null then
    raise exception 'Purchase not found.';
  end if;
  if purchase_row.status = 'refunded' then
    return false;
  end if;
  if purchase_row.status <> 'disputed' then
    raise exception 'Only a disputed purchase can be refunded.';
  end if;

  insert into public.wallets (user_id)
  values (purchase_row.user_id)
  on conflict (user_id) do nothing;

  update public.wallets set
    purchased_balance = purchased_balance + purchase_row.purchased_coins,
    reward_balance = reward_balance + purchase_row.reward_coins,
    balance = balance + purchase_row.gross_coins,
    updated_at = now()
  where user_id = purchase_row.user_id
  returning * into wallet_row;

  insert into public.credit_transactions (
    id, user_id, transaction_type, amount, balance_after,
    purchased_amount, reward_amount, purchased_balance_after,
    reward_balance_after, reason, idempotency_key, created_by
  ) values (
    refund_transaction_id, purchase_row.user_id, 'refund',
    purchase_row.gross_coins, wallet_row.balance,
    purchase_row.purchased_coins, purchase_row.reward_coins,
    wallet_row.purchased_balance, wallet_row.reward_balance,
    refund_reason, 'content-refund:' || purchase_row.id::text, refund_actor_id
  ) on conflict (idempotency_key) do nothing;

  update public.content_purchases
  set status = 'refunded', refunded_at = now()
  where id = purchase_row.id;

  update public.tip_card_entitlements
  set revoked_at = now()
  where source_purchase_id = purchase_row.id
    and revoked_at is null;

  update public.tipster_subscriptions
  set status = 'refunded'
  where purchase_id = purchase_row.id;

  if purchase_row.purchased_coins > 0 then
    insert into public.tipster_earnings (
      tipster_id, purchase_id, entry_type, gross_coins,
      platform_fee_coins, net_coins, idempotency_key
    ) values (
      purchase_row.tipster_id, purchase_row.id, 'refund',
      -purchase_row.purchased_coins, -purchase_row.platform_fee_coins,
      -purchase_row.tipster_net_coins, 'refund:' || purchase_row.id::text
    ) on conflict (idempotency_key) do nothing;
  end if;

  insert into public.notifications (user_id, title, body)
  values (
    purchase_row.user_id,
    'Refund approved',
    purchase_row.gross_coins::text || ' Credits were returned to your wallet after administrator approval.'
  );

  perform app_private.enqueue_notification(
    purchase_row.user_id,
    'purchase_refunded',
    'purchase:' || purchase_row.id::text || ':refund:email',
    jsonb_build_object(
      'template', 'purchase_refunded',
      'purchaseId', purchase_row.id,
      'coins', purchase_row.gross_coins,
      'purchasedCoins', purchase_row.purchased_coins,
      'rewardCoins', purchase_row.reward_coins,
      'reason', 'Your refund request was approved by an administrator.',
      'clientUrl', 'https://www.mrcracing.co.za/client/'
    )
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    refund_actor_id,
    'content_purchase_refunded',
    'content_purchase',
    purchase_row.id,
    jsonb_build_object(
      'reason', refund_reason,
      'coins', purchase_row.gross_coins,
      'purchasedCoins', purchase_row.purchased_coins,
      'rewardCoins', purchase_row.reward_coins,
      'approvalRequired', true
    )
  );

  return true;
end;
$$;

revoke all on function app_private.refund_content_purchase(uuid, text, uuid)
from public, anon, authenticated, service_role;

comment on function app_private.refund_content_purchase(uuid, text, uuid) is
  'Applies an exact Credit and earnings reversal only for an administrator-approved client refund request.';

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
  normalized_notes text := btrim(coalesce(p_admin_notes, ''));
  dispute_row public.purchase_disputes%rowtype;
  refund_applied boolean;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  if char_length(normalized_notes) < 10 or char_length(normalized_notes) > 2000 then
    raise exception 'Administrator review notes must contain 10 to 2,000 characters.';
  end if;

  select *
  into dispute_row
  from public.purchase_disputes
  where id = p_dispute_id
    and status = 'open'
  for update;

  if dispute_row.id is null then
    raise exception 'Open refund request not found.';
  end if;

  update public.purchase_disputes
  set
    status = case
      when p_approve_refund then 'approved'::public.purchase_dispute_status
      else 'rejected'::public.purchase_dispute_status
    end,
    admin_notes = normalized_notes,
    resolved_by = current_user_id,
    resolved_at = now()
  where id = dispute_row.id
  returning * into dispute_row;

  if p_approve_refund then
    refund_applied := app_private.refund_content_purchase(
      dispute_row.purchase_id,
      'Administrator approved client refund request.',
      current_user_id
    );

    if not refund_applied then
      raise exception 'The purchase was already refunded.';
    end if;
  else
    update public.content_purchases
    set status = 'active'
    where id = dispute_row.purchase_id
      and status = 'disputed';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'purchase_refund_request_resolved',
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

revoke all on function public.resolve_purchase_dispute(uuid, boolean, text)
from public, anon;
grant execute on function public.resolve_purchase_dispute(uuid, boolean, text)
to authenticated;

comment on function public.resolve_purchase_dispute(uuid, boolean, text) is
  'Allows an active administrator to approve or reject an open client refund request with required audit notes.';

create index if not exists purchase_disputes_purchase_resolved_idx
on public.purchase_disputes (purchase_id, resolved_at desc);

create or replace function public.admin_list_tipster_packages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', packages.id,
        'tipsterId', packages.tipster_id,
        'tipsterName', tipsters.display_name,
        'tipsterEmail', tipster_users.email,
        'packageName', packages.name,
        'durationMonths', packages.duration_months,
        'priceCredits', packages.coin_price,
        'active', packages.is_active,
        'updatedAt', packages.updated_at
      )
      order by tipsters.display_name, packages.duration_months
    ),
    '[]'::jsonb
  )
  into result
  from public.tipster_packages packages
  join public.tipsters tipsters on tipsters.id = packages.tipster_id
  left join auth.users tipster_users on tipster_users.id = tipsters.user_id;

  return result;
end;
$$;

revoke all on function public.admin_list_tipster_packages()
from public, anon;
grant execute on function public.admin_list_tipster_packages()
to authenticated;

comment on function public.admin_list_tipster_packages() is
  'Returns all active and inactive tipster subscription packages to active administrators.';

create or replace function public.admin_list_internal_tipster_ledger(
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_page integer := greatest(coalesce(p_page, 1), 1);
  requested_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  with page_rows as (
    select
      earnings.id,
      earnings.purchase_id,
      earnings.created_at,
      purchases.created_at as purchase_created_at,
      purchases.purchase_type::text as purchase_type,
      purchases.status::text as purchase_status,
      purchases.commission_rate,
      earnings.entry_type,
      case
        when earnings.entry_type = 'refund' then -purchases.gross_coins
        else purchases.gross_coins
      end as total_credits,
      case
        when earnings.entry_type = 'refund' then -purchases.purchased_coins
        else purchases.purchased_coins
      end as purchased_credits,
      case
        when earnings.entry_type = 'refund' then -purchases.reward_coins
        else purchases.reward_coins
      end as reward_credits,
      earnings.gross_coins as earning_gross_credits,
      earnings.platform_fee_coins,
      earnings.net_coins,
      client_users.email::text as client_email,
      coalesce(
        nullif(btrim(client_profiles.display_name), ''),
        nullif(btrim(concat_ws(' ', client_profiles.first_name, client_profiles.last_name)), '')
      ) as client_name,
      tipsters.display_name as tipster_name,
      tipster_users.email::text as tipster_email,
      case
        when purchases.purchase_type = 'meeting'
          then coalesce(cards.title, 'Meeting card')
        else coalesce(packages.name, 'Tipster subscription')
      end as source_label,
      case
        when earnings.entry_type <> 'refund' then null
        when approved_disputes.id is not null then 'admin_approved'
        when refund_audits.actor_id is null then 'legacy_automatic'
        else 'legacy_manual'
      end as refund_origin
    from public.tipster_earnings earnings
    join public.content_purchases purchases on purchases.id = earnings.purchase_id
    join auth.users client_users on client_users.id = purchases.user_id
    left join public.profiles client_profiles on client_profiles.id = purchases.user_id
    join public.tipsters tipsters on tipsters.id = earnings.tipster_id
    left join auth.users tipster_users on tipster_users.id = tipsters.user_id
    left join public.tip_cards cards on cards.id = purchases.tip_card_id
    left join public.tipster_packages packages on packages.id = purchases.tipster_package_id
    left join lateral (
      select disputes.id
      from public.purchase_disputes disputes
      where disputes.purchase_id = purchases.id
        and disputes.status = 'approved'
      order by disputes.resolved_at desc nulls last
      limit 1
    ) approved_disputes on true
    left join lateral (
      select logs.actor_id
      from public.audit_logs logs
      where logs.entity_type = 'content_purchase'
        and logs.entity_id = purchases.id
        and logs.action = 'content_purchase_refunded'
      order by logs.created_at desc
      limit 1
    ) refund_audits on true
    order by earnings.created_at desc, earnings.id desc
    offset (requested_page - 1) * requested_page_size
    limit requested_page_size
  )
  select jsonb_build_object(
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', page_rows.id,
            'purchaseId', page_rows.purchase_id,
            'createdAt', page_rows.created_at,
            'purchaseCreatedAt', page_rows.purchase_created_at,
            'purchaseType', page_rows.purchase_type,
            'purchaseStatus', page_rows.purchase_status,
            'sourceLabel', page_rows.source_label,
            'entryType', page_rows.entry_type,
            'refundOrigin', page_rows.refund_origin,
            'clientEmail', page_rows.client_email,
            'clientName', page_rows.client_name,
            'tipsterEmail', page_rows.tipster_email,
            'tipsterName', page_rows.tipster_name,
            'grossCredits', page_rows.total_credits,
            'purchasedCredits', page_rows.purchased_credits,
            'rewardCredits', page_rows.reward_credits,
            'earningGrossCredits', page_rows.earning_gross_credits,
            'commissionRate', page_rows.commission_rate,
            'platformFeeCredits', page_rows.platform_fee_coins,
            'tipsterNetCredits', page_rows.net_coins
          )
          order by page_rows.created_at desc, page_rows.id desc
        )
        from page_rows
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from public.tipster_earnings),
    'page', requested_page,
    'pageSize', requested_page_size
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_list_internal_tipster_ledger(integer, integer)
from public, anon;
grant execute on function public.admin_list_internal_tipster_ledger(integer, integer)
to authenticated;

comment on function public.admin_list_internal_tipster_ledger(integer, integer) is
  'Returns full purchase totals, wallet funding splits, earnings allocations, and immutable refund origins to active administrators.';
