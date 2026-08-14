do $$
declare
  paid_dependency_count integer;
begin
  select
    (select count(*)
     from public.content_purchases purchase
     join public.tip_cards card on card.id = purchase.tip_card_id
     join public.race_meetings meeting on meeting.id = card.meeting_id
     where meeting.is_test)
    +
    (select count(*)
     from public.tip_card_entitlements entitlement
     join public.tip_cards card on card.id = entitlement.tip_card_id
     join public.race_meetings meeting on meeting.id = card.meeting_id
     where meeting.is_test)
    +
    (select count(*)
     from public.purchase_disputes dispute
     join public.content_purchases purchase on purchase.id = dispute.purchase_id
     join public.tip_cards card on card.id = purchase.tip_card_id
     join public.race_meetings meeting on meeting.id = card.meeting_id
     where meeting.is_test)
    +
    (select count(*)
     from public.tipster_earnings earning
     join public.content_purchases purchase on purchase.id = earning.purchase_id
     join public.tip_cards card on card.id = purchase.tip_card_id
     join public.race_meetings meeting on meeting.id = card.meeting_id
     where meeting.is_test)
  into paid_dependency_count;

  if paid_dependency_count <> 0 then
    raise exception 'Synthetic race cleanup aborted because paid dependencies exist.';
  end if;

  delete from public.race_meetings
  where is_test;
end;
$$;;
