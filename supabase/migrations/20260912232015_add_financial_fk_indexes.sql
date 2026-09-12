create index if not exists idx_tipster_earnings_purchase_id
  on public.tipster_earnings (purchase_id);

create index if not exists idx_tip_card_entitlements_source_purchase_id
  on public.tip_card_entitlements (source_purchase_id);

create index if not exists idx_tip_card_entitlements_source_subscription_id
  on public.tip_card_entitlements (source_subscription_id);

create index if not exists idx_tip_card_entitlements_tip_card_id
  on public.tip_card_entitlements (tip_card_id);

create index if not exists idx_content_purchases_tip_card_id
  on public.content_purchases (tip_card_id);

create index if not exists idx_content_purchases_tipster_package_id
  on public.content_purchases (tipster_package_id);

create index if not exists idx_purchase_disputes_resolved_by
  on public.purchase_disputes (resolved_by);

create index if not exists idx_purchase_disputes_user_id
  on public.purchase_disputes (user_id);
