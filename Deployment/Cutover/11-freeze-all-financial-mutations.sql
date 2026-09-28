begin;

revoke execute on function public.create_credit_checkout_record(uuid, text, jsonb, text)
from service_role;
revoke execute on function public.complete_credit_payment(uuid, text, text, jsonb)
from service_role;
revoke execute on function public.purchase_meeting_card(uuid, text, boolean)
from authenticated;
revoke execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
from authenticated;
revoke execute on function public.admin_refund_purchase(uuid, text)
from authenticated;
revoke execute on function public.process_due_meeting_refunds()
from authenticated, service_role;
revoke execute on function public.admin_adjust_wallet_v2(uuid, integer, text, text)
from authenticated;

revoke all on function public.purchase_meeting_card(uuid, text)
from public, anon, authenticated;
revoke all on function public.purchase_tipster_subscription(uuid, text)
from public, anon, authenticated;

commit;

select jsonb_build_object(
  'checkoutCreationFrozen', not has_function_privilege('service_role', 'public.create_credit_checkout_record(uuid,text,jsonb,text)', 'EXECUTE'),
  'paymentCompletionFrozen', not has_function_privilege('service_role', 'public.complete_credit_payment(uuid,text,text,jsonb)', 'EXECUTE'),
  'meetingSpendFrozen', not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text,boolean)', 'EXECUTE'),
  'subscriptionSpendFrozen', not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text,boolean,boolean)', 'EXECUTE'),
  'refundsFrozen', not has_function_privilege('authenticated', 'public.admin_refund_purchase(uuid,text)', 'EXECUTE'),
  'scheduledRefundsFrozen', not has_function_privilege('service_role', 'public.process_due_meeting_refunds()', 'EXECUTE'),
  'walletAdjustmentsFrozen', not has_function_privilege('authenticated', 'public.admin_adjust_wallet_v2(uuid,integer,text,text)', 'EXECUTE')
) as financial_freeze;
