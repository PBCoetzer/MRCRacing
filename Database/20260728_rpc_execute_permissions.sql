begin;

revoke all on function app_private.current_user_has_role(public.app_role)
from public, anon, authenticated, service_role;
revoke all on function app_private.current_tipster_id()
from public, anon, authenticated, service_role;
revoke all on function app_private.user_has_test_access(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.can_view_meeting(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.user_can_access_tip_card(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.tip_card_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.multiple_is_complete(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.enqueue_notification(uuid, text, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function app_private.queue_tip_card_notifications(uuid, integer, text)
from public, anon, authenticated, service_role;
revoke all on function app_private.validate_entry_for_fixture(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.refund_content_purchase(uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.refund_due_meeting_purchases()
from public, anon, authenticated, service_role;

grant execute on function app_private.current_user_has_role(public.app_role) to authenticated;
grant execute on function app_private.current_tipster_id() to authenticated;
grant execute on function app_private.user_has_test_access(uuid) to anon, authenticated;
grant execute on function app_private.can_view_meeting(uuid) to anon, authenticated;
grant execute on function app_private.user_can_access_tip_card(uuid, uuid) to authenticated;

revoke all on function public.save_tip_card_draft(
  uuid, uuid, text, text, integer, integer, public.tip_card_status, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.publish_tip_card(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.revise_tip_card(uuid, integer, text, jsonb, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.request_purchase_dispute(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.resolve_purchase_dispute(uuid, boolean, text)
from public, anon, authenticated, service_role;
revoke all on function public.admin_refund_purchase(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.process_due_meeting_refunds()
from public, anon, authenticated, service_role;
revoke all on function public.claim_tip_notification_jobs(integer)
from public, anon, authenticated, service_role;
revoke all on function public.complete_tip_notification_job(uuid, bigint, text)
from public, anon, authenticated, service_role;
revoke all on function public.fail_tip_notification_job(uuid, bigint, text, integer)
from public, anon, authenticated, service_role;
revoke all on function public.admin_list_users()
from public, anon, authenticated, service_role;
revoke all on function public.admin_configure_user(
  uuid, boolean, boolean, boolean, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.admin_adjust_wallet(uuid, integer, text)
from public, anon, authenticated, service_role;

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
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_configure_user(
  uuid, boolean, boolean, boolean, text, text, boolean, boolean
) to authenticated;
grant execute on function public.admin_adjust_wallet(uuid, integer, text) to authenticated;

commit;
