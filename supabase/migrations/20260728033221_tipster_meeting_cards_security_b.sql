drop policy if exists "tip_card_revisions_entitled_read" on public.tip_card_revisions;
create policy "tip_card_revisions_entitled_read"
on public.tip_card_revisions for select
to authenticated
using (
  app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    where c.id = tip_card_revisions.tip_card_id
      and t.user_id = (select auth.uid())
  )
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "tipster_packages_public_read" on public.tipster_packages;
create policy "tipster_packages_public_read"
on public.tipster_packages for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.tipsters t
    where t.id = tipster_packages.tipster_id
      and t.is_verified = true
  )
);

drop policy if exists "tipster_packages_owner_all" on public.tipster_packages;
create policy "tipster_packages_owner_all"
on public.tipster_packages for all
to authenticated
using (
  exists (
    select 1
    from public.tipsters t
    where t.id = tipster_packages.tipster_id
      and t.user_id = (select auth.uid())
      and t.is_verified = true
  )
)
with check (
  exists (
    select 1
    from public.tipsters t
    where t.id = tipster_packages.tipster_id
      and t.user_id = (select auth.uid())
      and t.is_verified = true
  )
);

drop policy if exists "tipster_packages_admin_all" on public.tipster_packages;
create policy "tipster_packages_admin_all"
on public.tipster_packages for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "content_purchases_select_own" on public.content_purchases;
create policy "content_purchases_select_own"
on public.content_purchases for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "content_purchases_admin_all" on public.content_purchases;
create policy "content_purchases_admin_all"
on public.content_purchases for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tipster_subscriptions_select_own" on public.tipster_subscriptions;
create policy "tipster_subscriptions_select_own"
on public.tipster_subscriptions for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "tipster_subscriptions_admin_all" on public.tipster_subscriptions;
create policy "tipster_subscriptions_admin_all"
on public.tipster_subscriptions for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tip_card_entitlements_select_own" on public.tip_card_entitlements;
create policy "tip_card_entitlements_select_own"
on public.tip_card_entitlements for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "tip_card_entitlements_admin_all" on public.tip_card_entitlements;
create policy "tip_card_entitlements_admin_all"
on public.tip_card_entitlements for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tipster_earnings_owner_read" on public.tipster_earnings;
create policy "tipster_earnings_owner_read"
on public.tipster_earnings for select
to authenticated
using (
  exists (
    select 1
    from public.tipsters t
    where t.id = tipster_earnings.tipster_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "tipster_earnings_admin_all" on public.tipster_earnings;
create policy "tipster_earnings_admin_all"
on public.tipster_earnings for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "purchase_disputes_select_own" on public.purchase_disputes;
create policy "purchase_disputes_select_own"
on public.purchase_disputes for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "purchase_disputes_admin_all" on public.purchase_disputes;
create policy "purchase_disputes_admin_all"
on public.purchase_disputes for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "notification_outbox_admin_read" on public.notification_outbox;
create policy "notification_outbox_admin_read"
on public.notification_outbox for select
to authenticated
using (app_private.current_user_has_role('administrator'));

grant usage on type public.race_meeting_status to anon, authenticated;
grant usage on type public.tip_card_status to anon, authenticated;
grant usage on type public.content_purchase_type to authenticated;
grant usage on type public.content_purchase_status to authenticated;
grant usage on type public.purchase_dispute_status to authenticated;
grant usage on type public.notification_delivery_status to authenticated;

grant select on
  public.race_meetings,
  public.race_entries,
  public.meeting_bet_options,
  public.meeting_bet_legs,
  public.tip_cards,
  public.tipster_packages
to anon, authenticated;

grant select on
  public.platform_settings,
  public.test_access_users,
  public.race_tip_selections,
  public.tip_card_multiples,
  public.tip_card_multiple_selections,
  public.tip_card_revisions,
  public.content_purchases,
  public.tipster_subscriptions,
  public.tip_card_entitlements,
  public.tipster_earnings,
  public.purchase_disputes,
  public.notification_outbox
to authenticated;

grant insert, update, delete on public.tipster_packages to authenticated;
grant insert, update, delete on public.test_access_users to authenticated;
grant update on public.platform_settings to authenticated;

revoke all on function app_private.current_tipster_id() from public;
revoke all on function app_private.user_has_test_access(uuid) from public;
revoke all on function app_private.can_view_meeting(uuid) from public;
revoke all on function app_private.user_can_access_tip_card(uuid, uuid) from public;
revoke all on function app_private.tip_card_snapshot(uuid) from public;
revoke all on function app_private.multiple_is_complete(uuid) from public;
revoke all on function app_private.enqueue_notification(uuid, text, text, jsonb) from public;
revoke all on function app_private.queue_tip_card_notifications(uuid, integer, text) from public;
revoke all on function app_private.validate_entry_for_fixture(uuid, uuid) from public;
revoke all on function app_private.refund_content_purchase(uuid, text, uuid) from public;
revoke all on function app_private.refund_due_meeting_purchases() from public;

grant execute on function app_private.current_tipster_id() to authenticated;
grant execute on function app_private.user_has_test_access(uuid) to anon, authenticated;
grant execute on function app_private.can_view_meeting(uuid) to anon, authenticated;
grant execute on function app_private.user_can_access_tip_card(uuid, uuid) to authenticated;

revoke all on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) from public;
revoke all on function public.publish_tip_card(uuid, integer) from public;
revoke all on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb) from public;
revoke all on function public.purchase_meeting_card(uuid, text) from public;
revoke all on function public.purchase_tipster_subscription(uuid, text) from public;
revoke all on function public.request_purchase_dispute(uuid, text) from public;
revoke all on function public.resolve_purchase_dispute(uuid, boolean, text) from public;
revoke all on function public.admin_refund_purchase(uuid, text) from public;
revoke all on function public.process_due_meeting_refunds() from public;
revoke all on function public.claim_tip_notification_jobs(integer) from public;
revoke all on function public.complete_tip_notification_job(uuid, bigint, text) from public;
revoke all on function public.fail_tip_notification_job(uuid, bigint, text, integer) from public;

grant execute on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) to authenticated;
grant execute on function public.publish_tip_card(uuid, integer) to authenticated;
grant execute on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb) to authenticated;
grant execute on function public.purchase_meeting_card(uuid, text) to authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text) to authenticated;
grant execute on function public.request_purchase_dispute(uuid, text) to authenticated;
grant execute on function public.resolve_purchase_dispute(uuid, boolean, text) to authenticated;
grant execute on function public.admin_refund_purchase(uuid, text) to authenticated;
grant execute on function public.process_due_meeting_refunds() to authenticated, service_role;
grant execute on function public.claim_tip_notification_jobs(integer) to service_role;
grant execute on function public.complete_tip_notification_job(uuid, bigint, text) to service_role;
grant execute on function public.fail_tip_notification_job(uuid, bigint, text, integer) to service_role;
;
