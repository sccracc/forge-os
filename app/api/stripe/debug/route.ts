import { NextRequest } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/server";
import { stripe, stripeConfigured } from "@/lib/stripe/server";

export const runtime = "nodejs";

// ⚠️ TEMPORARY billing diagnostic — DELETE THIS FILE after you've fixed billing.
// No auth so you can just open /api/stripe/debug in a browser. It exposes ONLY
// non-sensitive info (test/live mode, the public NEXT_PUBLIC_ price IDs, public
// price amounts) and NEVER the secret key. It answers the #1 cause of
// "No such price": do the deployed price IDs actually exist under the deployed
// secret key (same mode + same account)?

const CONFIGURED: Record<string, string | undefined> = {
  starter: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID,
  pro: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  max: process.env.NEXT_PUBLIC_STRIPE_MAX_PRICE_ID,
  ultra: process.env.NEXT_PUBLIC_STRIPE_ULTRA_PRICE_ID,
};

export async function GET(_req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const keyMode = key.startsWith("sk_live_")
    ? "live"
    : key.startsWith("sk_test_")
      ? "test"
      : key.startsWith("rk_live_")
        ? "restricted-live"
        : key.startsWith("rk_test_")
          ? "restricted-test"
          : key
            ? "unrecognized-prefix"
            : "unset";

  const result: Record<string, unknown> = {
    howToRead:
      "If priceChecks.*.found is false, the deployed price IDs do NOT exist under the deployed secret key — fix the mode/account or redeploy. Compare configuredPriceIds against accountPricesUnderThisKey; the keyMode must match the prices' livemode (live=true / test=false).",
    stripeConfigured,
    supabaseConfigured,
    keyMode,
    keyLivemode: keyMode === "live" || keyMode === "restricted-live",
    webhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
    configuredPriceIds: CONFIGURED,
  };

  if (!stripeConfigured) {
    result.note = "STRIPE_SECRET_KEY is not set on this deployment.";
    return Response.json(result);
  }

  // Can the deployed key actually retrieve each configured price?
  const priceChecks: Record<string, unknown> = {};
  for (const [plan, id] of Object.entries(CONFIGURED)) {
    if (!id) {
      priceChecks[plan] = { configured: false };
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id);
      priceChecks[plan] = {
        id,
        found: true,
        livemode: price.livemode,
        active: price.active,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval ?? null,
      };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      priceChecks[plan] = { id, found: false, error: e?.code || e?.message || "retrieve failed" };
    }
  }
  result.priceChecks = priceChecks;

  // The prices that actually exist under this key — compare these IDs to yours.
  try {
    const list = await stripe.prices.list({ limit: 20, active: true });
    result.accountPricesUnderThisKey = list.data.map((p) => ({
      id: p.id,
      livemode: p.livemode,
      amount: p.unit_amount,
      currency: p.currency,
      interval: p.recurring?.interval ?? null,
      nickname: p.nickname ?? null,
    }));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    result.accountPricesUnderThisKey = { error: e?.code || e?.message || "list failed" };
  }

  return Response.json(result);
}
