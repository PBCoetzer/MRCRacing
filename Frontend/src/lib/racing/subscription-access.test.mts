import assert from "node:assert/strict";
import test from "node:test";
import {
  entitlementIsActive,
  subscriptionDaysRemaining,
  subscriptionIsActive,
  type SubscriptionAccessRow,
} from "./subscription-access.ts";

const now = Date.parse("2026-10-17T12:00:00Z");

function subscription(
  overrides: Partial<SubscriptionAccessRow> = {},
): SubscriptionAccessRow {
  return {
    id: "subscription-1",
    starts_at: "2026-09-17T12:00:00Z",
    ends_at: "2026-10-17T12:00:01Z",
    status: "active",
    ...overrides,
  };
}

test("requires active status and a current half-open access window", () => {
  assert.equal(subscriptionIsActive(subscription(), now), true);
  assert.equal(
    subscriptionIsActive(subscription({ ends_at: "2026-10-17T12:00:00Z" }), now),
    false,
  );
  assert.equal(
    subscriptionIsActive(subscription({ status: "expired" }), now),
    false,
  );
});

test("keeps meeting purchases but rejects expired subscription entitlements", () => {
  const active = subscription();
  const expired = subscription({
    id: "subscription-expired",
    ends_at: "2026-10-16T12:00:00Z",
  });
  const subscriptions = new Map([
    [active.id, active],
    [expired.id, expired],
  ]);

  assert.equal(
    entitlementIsActive(
      { source_type: "meeting", source_subscription_id: null },
      subscriptions,
      now,
    ),
    true,
  );
  assert.equal(
    entitlementIsActive(
      { source_type: "subscription", source_subscription_id: active.id },
      subscriptions,
      now,
    ),
    true,
  );
  assert.equal(
    entitlementIsActive(
      { source_type: "subscription", source_subscription_id: expired.id },
      subscriptions,
      now,
    ),
    false,
  );
});

test("rounds expiry warnings up to whole remaining days", () => {
  assert.equal(subscriptionDaysRemaining("2026-10-24T11:59:59Z", now), 7);
  assert.equal(subscriptionDaysRemaining("2026-10-17T12:00:00Z", now), 0);
});
