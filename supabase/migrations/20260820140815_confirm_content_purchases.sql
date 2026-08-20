-- Require an explicit client confirmation before content Credits are spent.
-- Active subscriptions also require a separate extension acknowledgement.

create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text,
  p_purchase_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_meeting_card_confirmed$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select purchases.id into existing_purchase_id
  from public.content_purchases purchases
  where purchases.user_id = current_user_id
    and purchases.idempotency_key = p_idempotency_key;

  if existing_purchase_id is not null then
    return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
  end if;

  if not coalesce(p_purchase_confirmed, false) then
    raise exception 'Confirm this meeting-card purchase before Credits are deducted.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meeting-purchase:' || current_user_id::text || ':' || p_tip_card_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.content_purchases purchases
    where purchases.user_id = current_user_id
      and purchases.tip_card_id = p_tip_card_id
      and purchases.status in ('active', 'disputed')
  ) then
    raise exception 'You already own this meeting card and cannot purchase it twice.';
  end if;

  return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
end;
$purchase_meeting_card_confirmed$;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text,
  p_purchase_confirmed boolean,
  p_confirm_extension boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription_confirmed$
declare
  current_user_id uuid := (select auth.uid());
  package_tipster_id uuid;
  existing_purchase_id uuid;
  active_until timestamptz;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select purchases.id into existing_purchase_id
  from public.content_purchases purchases
  where purchases.user_id = current_user_id
    and purchases.idempotency_key = p_idempotency_key;

  if existing_purchase_id is not null then
    return public.purchase_tipster_subscription(p_package_id, p_idempotency_key);
  end if;

  if not coalesce(p_purchase_confirmed, false) then
    raise exception 'Confirm this subscription purchase before Credits are deducted.';
  end if;

  select packages.tipster_id into package_tipster_id
  from public.tipster_packages packages
  where packages.id = p_package_id
    and packages.is_active = true;

  if package_tipster_id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'subscription-purchase:' || current_user_id::text || ':' || package_tipster_id::text,
      0
    )
  );

  select max(subscriptions.ends_at) into active_until
  from public.tipster_subscriptions subscriptions
  where subscriptions.user_id = current_user_id
    and subscriptions.tipster_id = package_tipster_id
    and subscriptions.status = 'active'
    and subscriptions.ends_at > now();

  if active_until is not null and not coalesce(p_confirm_extension, false) then
    raise exception 'You already have an active subscription. Confirm that you want to extend it.';
  end if;

  result := public.purchase_tipster_subscription(p_package_id, p_idempotency_key);

  return result || jsonb_build_object(
    'extendedExistingSubscription', active_until is not null,
    'previousEndsAt', active_until
  );
end;
$purchase_tipster_subscription_confirmed$;

revoke all on function public.purchase_meeting_card(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.purchase_meeting_card(uuid, text, boolean)
to authenticated;

revoke all on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
from public, anon, authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
to authenticated;

-- Retire direct access to the legacy implementations. The confirmed wrappers above
-- retain owner-only access so idempotent processing and the existing accounting path
-- remain centralized.
revoke execute on function public.purchase_meeting_card(uuid, text)
from authenticated;
revoke execute on function public.purchase_tipster_subscription(uuid, text)
from authenticated;

comment on function public.purchase_meeting_card(uuid, text, boolean) is
  'Purchases a meeting card only after explicit confirmation and serializes duplicate checks.';
comment on function public.purchase_tipster_subscription(uuid, text, boolean, boolean) is
  'Purchases or extends a tipster subscription after explicit purchase and extension confirmation.';
