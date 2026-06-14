import "server-only";
import Stripe from "stripe";

// Whether real Stripe server credentials are present. Routes check this and
// return a clean error instead of throwing when billing isn't configured yet.
export const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());

// A placeholder key keeps `next build` working before env vars are set (the
// Stripe constructor throws on an empty key). The real key is required at
// runtime. apiVersion is pinned so webhook event shapes stay stable; the cast
// is version-agnostic (the SDK's typed apiVersion union changes between SDK
// releases, but pinning the runtime value is intentional).
const stripeConfig = { apiVersion: "2026-02-25.clover" } as unknown as ConstructorParameters<
  typeof Stripe
>[1];

export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_unset",
  stripeConfig
);
