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

do $freeze_new_payout_functions$
begin
  if to_regprocedure('public.request_my_tipster_payout()') is not null then
    execute 'revoke all on function public.request_my_tipster_payout() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.confirm_my_tipster_payout_received(uuid)') is not null then
    execute 'revoke all on function public.confirm_my_tipster_payout_received(uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.admin_mark_tipster_payout_paid(uuid,text,text)') is not null then
    execute 'revoke all on function public.admin_mark_tipster_payout_paid(uuid,text,text) from public, anon, authenticated';
  end if;
end;
$freeze_new_payout_functions$;

comment on function public.create_credit_checkout_record(uuid, text, jsonb, text) is
  'Temporarily frozen for the payout-ledger production release. Existing provider callbacks are blocked only during the final T-0 window.';

commit;

select jsonb_build_object(
  'checkoutCreationFrozen', not has_function_privilege('service_role', 'public.create_credit_checkout_record(uuid,text,jsonb,text)', 'EXECUTE'),
  'paymentCompletionFrozen', not has_function_privilege('service_role', 'public.complete_credit_payment(uuid,text,text,jsonb)', 'EXECUTE'),
  'meetingSpendFrozen', not has_function_privilege('authenticated', 'public.purchase_meeting_card(uuid,text,boolean)', 'EXECUTE'),
  'subscriptionSpendFrozen', not has_function_privilege('authenticated', 'public.purchase_tipster_subscription(uuid,text,boolean,boolean)', 'EXECUTE'),
  'refundsFrozen', not has_function_privilege('authenticated', 'public.admin_refund_purchase(uuid,text)', 'EXECUTE'),
  'scheduledRefundsFrozen', not has_function_privilege('service_role', 'public.process_due_meeting_refunds()', 'EXECUTE'),
  'walletAdjustmentsFrozen', not has_function_privilege('authenticated', 'public.admin_adjust_wallet_v2(uuid,integer,text,text)', 'EXECUTE'),
  'tipsterPayoutRequestsFrozen', case
    when to_regprocedure('public.request_my_tipster_payout()') is null then true
    else not has_function_privilege('authenticated', 'public.request_my_tipster_payout()', 'EXECUTE')
  end,
  'tipsterReceiptConfirmationFrozen', case
    when to_regprocedure('public.confirm_my_tipster_payout_received(uuid)') is null then true
    else not has_function_privilege('authenticated', 'public.confirm_my_tipster_payout_received(uuid)', 'EXECUTE')
  end,
  'administratorPayoutSettlementFrozen', case
    when to_regprocedure('public.admin_mark_tipster_payout_paid(uuid,text,text)') is null then true
    else not has_function_privilege('authenticated', 'public.admin_mark_tipster_payout_paid(uuid,text,text)', 'EXECUTE')
  end
) as payout_ledger_release_freeze;
