create or replace function public.admin_get_user_tipster_workspace(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_tipster_id uuid;
  result jsonb;
begin
  if current_user_id is null
    or not app_private.account_is_active(current_user_id)
    or not app_private.current_user_has_role('administrator')
  then
    raise exception 'Active administrator access required.';
  end if;

  if not exists (select 1 from auth.users users where users.id = p_user_id) then
    raise exception 'User not found.';
  end if;

  select tipsters.id
  into target_tipster_id
  from public.tipsters tipsters
  where tipsters.user_id = p_user_id;

  select jsonb_build_object(
    'loadedAt', now(),
    'tipsterId', target_tipster_id,
    'packages',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', packages.id,
            'name', packages.name,
            'durationMonths', packages.duration_months,
            'priceCredits', packages.coin_price,
            'active', packages.is_active,
            'createdAt', packages.created_at,
            'updatedAt', packages.updated_at
          )
          order by packages.duration_months
        )
        from public.tipster_packages packages
        where packages.tipster_id = target_tipster_id
      ),
      '[]'::jsonb
    ),
    'sales',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sales.id,
            'type', sales.purchase_type,
            'status', sales.status,
            'totalCredits', sales.gross_coins,
            'purchasedCredits', sales.purchased_coins,
            'rewardCredits', sales.reward_coins,
            'buyerEmail', buyer_users.email,
            'buyerName', coalesce(
              nullif(btrim(buyer_profiles.display_name), ''),
              nullif(btrim(concat_ws(' ', buyer_profiles.first_name, buyer_profiles.last_name)), '')
            ),
            'sourceLabel', case
              when sales.purchase_type = 'meeting'
                then coalesce(cards.title, 'Meeting card')
              else coalesce(packages.name, 'Tipster subscription')
            end,
            'refundedAt', sales.refunded_at,
            'createdAt', sales.created_at
          )
          order by sales.created_at desc
        )
        from (
          select purchases.*
          from public.content_purchases purchases
          where purchases.tipster_id = target_tipster_id
          order by purchases.created_at desc
          limit 50
        ) sales
        join auth.users buyer_users on buyer_users.id = sales.user_id
        left join public.profiles buyer_profiles on buyer_profiles.id = sales.user_id
        left join public.tip_cards cards on cards.id = sales.tip_card_id
        left join public.tipster_packages packages on packages.id = sales.tipster_package_id
      ),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_get_user_tipster_workspace(uuid)
from public, anon;
grant execute on function public.admin_get_user_tipster_workspace(uuid)
to authenticated;

comment on function public.admin_get_user_tipster_workspace(uuid) is
  'Returns a live, user-scoped administrator view of tipster packages and sales.';

do $$
declare
  target_purchase_ids uuid[];
  target_count integer;
  target_gross integer;
  target_purchased integer;
  target_reward integer;
  target_platform_fee numeric(12, 2);
  target_tipster_net numeric(12, 2);
  purchase_row record;
  wallet_guard record;
  allocation jsonb;
  purchased_deducted integer;
  reward_deducted integer;
  correction_transaction_id uuid;
  restored_entitlement_count integer;
  charity_reversal record;
begin
  select
    array_agg(purchases.id order by purchases.created_at, purchases.id),
    count(*),
    coalesce(sum(purchases.gross_coins), 0),
    coalesce(sum(purchases.purchased_coins), 0),
    coalesce(sum(purchases.reward_coins), 0),
    coalesce(sum(purchases.platform_fee_coins), 0),
    coalesce(sum(purchases.tipster_net_coins), 0)
  into
    target_purchase_ids,
    target_count,
    target_gross,
    target_purchased,
    target_reward,
    target_platform_fee,
    target_tipster_net
  from public.content_purchases purchases
  where purchases.purchase_type = 'meeting'
    and purchases.status = 'refunded'
    and exists (
      select 1
      from public.audit_logs logs
      where logs.entity_type = 'content_purchase'
        and logs.entity_id = purchases.id
        and logs.action = 'content_purchase_refunded'
        and logs.actor_id is null
        and logs.metadata ->> 'reason' = 'The meeting card was not published before Race 1.'
    )
    and not exists (
      select 1
      from public.audit_logs corrections
      where corrections.entity_type = 'content_purchase'
        and corrections.entity_id = purchases.id
        and corrections.action = 'legacy_automatic_refund_corrected'
    );

  if target_count > 0 then
    if target_count <> 8
      or target_gross <> 275
      or target_purchased <> 230
      or target_reward <> 45
      or target_platform_fee <> 23.00
      or target_tipster_net <> 207.00
    then
      raise exception 'Legacy refund correction aborted: the target set does not match the audited eight purchases.';
    end if;

    if exists (
      select 1
      from public.charity_contribution_entries contributions
      where contributions.purchase_id = any(target_purchase_ids)
        and contributions.entry_type = 'adjustment'
    ) then
      raise exception 'Legacy refund correction aborted: a charity adjustment already exists.';
    end if;

    for wallet_guard in
      select purchases.user_id, sum(purchases.gross_coins)::integer as required_credits
      from public.content_purchases purchases
      where purchases.id = any(target_purchase_ids)
      group by purchases.user_id
      order by purchases.user_id
    loop
      perform 1
      from public.wallets wallets
      where wallets.user_id = wallet_guard.user_id
      for update;

      if not exists (
        select 1
        from public.wallets wallets
        where wallets.user_id = wallet_guard.user_id
          and wallets.balance >= wallet_guard.required_credits
      ) then
        raise exception 'Legacy refund correction aborted: client % has insufficient Credits.', wallet_guard.user_id;
      end if;
    end loop;

    for purchase_row in
      select purchases.*
      from public.content_purchases purchases
      where purchases.id = any(target_purchase_ids)
      order by purchases.created_at, purchases.id
    loop
      allocation := app_private.allocate_wallet_spend(
        purchase_row.user_id,
        purchase_row.gross_coins
      );
      purchased_deducted := (allocation ->> 'purchasedUsed')::integer;
      reward_deducted := (allocation ->> 'rewardUsed')::integer;
      correction_transaction_id := gen_random_uuid();

      insert into public.credit_transactions (
        id,
        user_id,
        transaction_type,
        amount,
        balance_after,
        purchased_amount,
        reward_amount,
        purchased_balance_after,
        reward_balance_after,
        reason,
        idempotency_key,
        created_by
      ) values (
        correction_transaction_id,
        purchase_row.user_id,
        'reversal',
        -purchase_row.gross_coins,
        (allocation ->> 'balance')::integer,
        -purchased_deducted,
        -reward_deducted,
        (allocation ->> 'purchasedBalance')::integer,
        (allocation ->> 'rewardBalance')::integer,
        'Correction of a legacy automatic meeting-card refund that was not client requested',
        'legacy-auto-refund-correction:' || purchase_row.id::text,
        null
      );

      update public.content_purchases
      set status = 'active', refunded_at = null
      where id = purchase_row.id;

      update public.tip_card_entitlements
      set revoked_at = null
      where source_purchase_id = purchase_row.id
        and revoked_at is not null;
      get diagnostics restored_entitlement_count = row_count;

      if restored_entitlement_count = 0 then
        insert into public.tip_card_entitlements (
          user_id,
          tip_card_id,
          source_type,
          source_purchase_id
        ) values (
          purchase_row.user_id,
          purchase_row.tip_card_id,
          'meeting',
          purchase_row.id
        );
        restored_entitlement_count := 1;
      end if;

      if purchase_row.purchased_coins > 0 then
        insert into public.tipster_earnings (
          tipster_id,
          purchase_id,
          entry_type,
          gross_coins,
          platform_fee_coins,
          net_coins,
          idempotency_key
        ) values (
          purchase_row.tipster_id,
          purchase_row.id,
          'sale',
          purchase_row.purchased_coins,
          purchase_row.platform_fee_coins,
          purchase_row.tipster_net_coins,
          'legacy-auto-refund-correction-sale:' || purchase_row.id::text
        );
      end if;

      select
        contributions.basis_platform_fee_coins,
        contributions.zar_per_coin,
        contributions.contribution_rate_bps,
        contributions.amount_cents
      into charity_reversal
      from public.charity_contribution_entries contributions
      where contributions.purchase_id = purchase_row.id
        and contributions.entry_type = 'reversal';

      if charity_reversal.amount_cents is not null then
        insert into public.charity_contribution_entries (
          purchase_id,
          entry_type,
          basis_platform_fee_coins,
          zar_per_coin,
          contribution_rate_bps,
          amount_cents,
          reason,
          created_by
        ) values (
          purchase_row.id,
          'adjustment',
          -charity_reversal.basis_platform_fee_coins,
          charity_reversal.zar_per_coin,
          charity_reversal.contribution_rate_bps,
          -charity_reversal.amount_cents,
          'Restore contribution after correcting a legacy automatic refund',
          null
        );
      end if;

      insert into public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      ) values (
        null,
        'legacy_automatic_refund_corrected',
        'content_purchase',
        purchase_row.id,
        jsonb_build_object(
          'legacyRefundReason', 'The meeting card was not published before Race 1.',
          'deductedCredits', purchase_row.gross_coins,
          'currentPurchasedCreditsDeducted', purchased_deducted,
          'currentRewardCreditsDeducted', reward_deducted,
          'originalPurchasedCreditsRestoredToEarnings', purchase_row.purchased_coins,
          'originalRewardCredits', purchase_row.reward_coins,
          'platformFeeCreditsRestored', purchase_row.platform_fee_coins,
          'tipsterNetCreditsRestored', purchase_row.tipster_net_coins,
          'entitlementsRestored', restored_entitlement_count,
          'notificationsSent', false
        )
      );
    end loop;
  end if;
end;
$$;

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
        when earnings.idempotency_key like 'legacy-auto-refund-correction-sale:%'
          then 'legacy_refund_correction'
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
  'Returns full purchase totals, wallet funding splits, earnings allocations, legacy refund origins, and explicit correction entries to active administrators.';
