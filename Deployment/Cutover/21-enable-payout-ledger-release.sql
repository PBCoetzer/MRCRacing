begin;

grant execute on function public.create_credit_checkout_record(uuid, text, jsonb, text)
to service_role;
grant execute on function public.complete_credit_payment(uuid, text, text, jsonb)
to service_role;
grant execute on function public.purchase_meeting_card(uuid, text, boolean)
to authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
to authenticated;
grant execute on function public.admin_refund_purchase(uuid, text)
to authenticated;
grant execute on function public.process_due_meeting_refunds()
to authenticated, service_role;
grant execute on function public.admin_adjust_wallet_v2(uuid, integer, text, text)
to authenticated;

grant execute on function public.request_my_tipster_payout()
to authenticated;
grant execute on function public.confirm_my_tipster_payout_received(uuid)
to authenticated;
grant execute on function public.admin_mark_tipster_payout_paid(uuid, text, text)
to authenticated;

revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon, authenticated;
revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated;

comment on function public.create_credit_checkout_record(uuid, text, jsonb, text) is
  'Creates an idempotent Credit checkout record. Restored after the verified payout-ledger production release.';
comment on function public.request_my_tipster_payout() is
  'Atomically assigns every currently available new-period earning row to one Tipster payout request.';
comment on function public.confirm_my_tipster_payout_received(uuid) is
  'Lets the owning Tipster confirm receipt after an administrator records payment.';
comment on function public.admin_mark_tipster_payout_paid(uuid, text, text) is
  'Records administrator payment evidence for a requested Tipster payout.';

commit;

select jsonb_build_object(
  'checkoutCreationEnabled', has_function_privilege('service_role', 'public.create_credit_checkout_record(uuid,text,jsonb,text)', 'EXECUTE'),
  'paymentCompletionEnabled', has_function_privilege('service_role', 'public.complete_credit_payment(uuid,text,text,jsonb)', 'EXECUTE'),
  'meetingSpendEnabled', has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text,boolean)', 'EXECUTE'),
  'subscriptionSpendEnabled', has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text,boolean,boolean)', 'EXECUTE'),
  'refundsEnabled', has_function_privilege('authenticated', 'public.admin_refund_purchase(uuid,text)', 'EXECUTE'),
  'scheduledRefundsEnabled', has_function_privilege('service_role', 'public.process_due_meeting_refunds()', 'EXECUTE'),
  'walletAdjustmentsEnabled', has_function_privilege('authenticated', 'public.admin_adjust_wallet_v2(uuid,integer,text,text)', 'EXECUTE'),
  'tipsterPayoutRequestsEnabled', has_function_privilege('authenticated', 'public.request_my_tipster_payout()', 'EXECUTE'),
  'tipsterReceiptConfirmationEnabled', has_function_privilege('authenticated', 'public.confirm_my_tipster_payout_received(uuid)', 'EXECUTE'),
  'administratorPayoutSettlementEnabled', has_function_privilege('authenticated', 'public.admin_mark_tipster_payout_paid(uuid,text,text)', 'EXECUTE'),
  'rawMeetingSpendBlocked', not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text)', 'EXECUTE'),
  'rawSubscriptionSpendBlocked', not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text)', 'EXECUTE')
) as payout_ledger_release_enable;
