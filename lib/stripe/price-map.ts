import { resolvePlanId, type PlanId } from "@/lib/plans/limits";

// Maps configured Stripe Price IDs to Forge plan names. Empty env vars are
// ignored so an unset price can never become a valid checkout target.
const priceEntries = [
  [process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, "starter"],
  [process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, "pro"],
  [process.env.NEXT_PUBLIC_STRIPE_MAX_PRICE_ID, "max"],
  [process.env.NEXT_PUBLIC_STRIPE_ULTRA_PRICE_ID, "ultra"],
] as const;

export const PRICE_TO_PLAN: Record<string, PlanId> = Object.fromEntries(
  priceEntries
    .map(([priceId, plan]) => [priceId?.trim(), resolvePlanId(plan)] as const)
    .filter((entry): entry is [string, PlanId] => Boolean(entry[0]))
);

export function planForPrice(priceId: string): PlanId | null {
  return PRICE_TO_PLAN[priceId.trim()] ?? null;
}
