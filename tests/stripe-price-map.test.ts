import { afterEach, describe, expect, it, vi } from "vitest";

describe("Stripe price map", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ignores blank price env vars and resolves configured prices", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID", "price_starter");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PRO_PRICE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_MAX_PRICE_ID", "price_max");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_ULTRA_PRICE_ID", "");
    vi.resetModules();

    const { PRICE_TO_PLAN, planForPrice } = await import("@/lib/stripe/price-map");

    expect(PRICE_TO_PLAN[""]).toBeUndefined();
    expect(planForPrice("price_starter")).toBe("starter");
    expect(planForPrice("price_max")).toBe("max");
    expect(planForPrice("price_missing")).toBeNull();
  });
});
