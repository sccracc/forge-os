import type Stripe from "stripe";
import { PRICE_TO_PLAN } from "@/lib/stripe/price-map";
import type { PlanId } from "@/lib/plans/limits";

const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

export function hasPaidEntitlementStatus(status: string | null | undefined): boolean {
  return Boolean(status && ENTITLED_SUBSCRIPTION_STATUSES.has(status));
}

export function planForSubscription(sub: Stripe.Subscription): PlanId | null {
  if (!hasPaidEntitlementStatus(sub.status)) return null;
  const priceId = sub.items.data[0]?.price.id;
  return priceId ? PRICE_TO_PLAN[priceId] ?? null : null;
}
