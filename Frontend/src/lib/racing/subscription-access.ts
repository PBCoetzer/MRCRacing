export type SubscriptionAccessRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "expired" | "refunded";
};

export type EntitlementAccessRow = {
  source_type: "meeting" | "subscription";
  source_subscription_id: string | null;
};

export function subscriptionIsActive(
  subscription: SubscriptionAccessRow,
  atMilliseconds: number,
) {
  return subscription.status === "active" &&
    new Date(subscription.starts_at).getTime() <= atMilliseconds &&
    new Date(subscription.ends_at).getTime() > atMilliseconds;
}

export function entitlementIsActive(
  entitlement: EntitlementAccessRow,
  subscriptionsById: ReadonlyMap<string, SubscriptionAccessRow>,
  atMilliseconds: number,
) {
  if (entitlement.source_type === "meeting") {
    return true;
  }

  if (!entitlement.source_subscription_id) {
    return false;
  }

  const subscription = subscriptionsById.get(entitlement.source_subscription_id);
  return subscription ? subscriptionIsActive(subscription, atMilliseconds) : false;
}

export function subscriptionDaysRemaining(
  endsAt: string,
  atMilliseconds: number,
) {
  const remainingMilliseconds = new Date(endsAt).getTime() - atMilliseconds;
  return Math.max(0, Math.ceil(remainingMilliseconds / 86_400_000));
}
