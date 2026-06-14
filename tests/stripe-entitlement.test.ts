import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function subscription(status: Stripe.Subscription.Status, priceId: string): Stripe.Subscription {
  return {
    id: "sub_test",
    status,
    cancel_at_period_end: status === "active",
    items: { data: [{ price: { id: priceId } }] },
  } as unknown as Stripe.Subscription;
}

describe("Stripe subscription entitlement", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID", "price_starter");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PRO_PRICE_ID", "price_pro");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps access during active cancel-at-period-end subscriptions", async () => {
    const { planForSubscription } = await import("@/lib/stripe/subscription-entitlement");

    expect(planForSubscription(subscription("active", "price_pro"))).toBe("pro");
  });

  it("removes access for terminal or non-entitled subscription statuses", async () => {
    const { planForSubscription } = await import("@/lib/stripe/subscription-entitlement");

    expect(planForSubscription(subscription("canceled", "price_pro"))).toBeNull();
    expect(planForSubscription(subscription("unpaid", "price_pro"))).toBeNull();
    expect(planForSubscription(subscription("incomplete_expired", "price_pro"))).toBeNull();
    expect(planForSubscription(subscription("paused", "price_pro"))).toBeNull();
  });
});
