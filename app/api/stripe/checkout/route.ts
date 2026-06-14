import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { stripe, stripeConfigured } from "@/lib/stripe/server";
import { planForPrice } from "@/lib/stripe/price-map";

export const runtime = "nodejs";

function stripeCheckoutError(err: unknown): Response {
  const e = err as { code?: string; message?: string; statusCode?: number; type?: string };
  const code = e?.code ?? "";
  const message = e?.message ?? "";
  const statusCode = e?.statusCode ?? 500;

  if (/No such customer/i.test(message)) {
    return jsonError(
      "Your saved billing account was from a different Stripe mode and has been reset. Please click upgrade again.",
      409
    );
  }

  if (code === "resource_missing" || /No such price/i.test(message)) {
    return jsonError(
      "Stripe doesn't recognize that price for your secret key. This is almost always a test/live mode mismatch — your STRIPE_SECRET_KEY and the NEXT_PUBLIC_STRIPE_*_PRICE_ID values must all be from the SAME Stripe mode (all test, or all live) and the same account. Fix them in Vercel and redeploy.",
      400
    );
  }

  if (statusCode === 401 || code === "api_key_expired" || /api key/i.test(message)) {
    return jsonError("Stripe rejected the billing key. Check STRIPE_SECRET_KEY in Vercel.", 503);
  }

  if (e?.type?.startsWith("Stripe")) {
    return jsonError("Stripe could not start checkout. Check your billing setup and try again.", 502);
  }

  return jsonError("Couldn't start checkout. Please try again.", 500);
}

/**
 * POST /api/stripe/checkout — start a subscription Checkout Session.
 * Body: { priceId, billingPeriod }. Reuses or creates the Stripe customer for
 * the verified user, persisting the customer id back to Supabase.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    user = null;
  }
  if (!user) return jsonError("unauthorized", 401);
  if (!stripeConfigured) return jsonError("Billing is not configured.", 503);

  let body: { priceId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid request", 400);
  }
  const priceId = (body.priceId ?? "").trim();
  if (!priceId) return jsonError("Missing price.", 400);
  const planName = planForPrice(priceId);
  if (!planName) {
    return jsonError("This plan price is not configured. Check the Stripe Price IDs in Vercel, then redeploy.", 400);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  try {
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.recurring?.interval !== "month") {
      return jsonError(
        "This plan price must be an active monthly recurring Stripe price. Check the Stripe Price IDs in Vercel, then redeploy.",
        400
      );
    }

    // Get / create the Stripe customer.
    const { data: row, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, email, stripe_customer_id")
      .eq("id", user.uid)
      .maybeSingle();
    if (userError) {
      console.error("[stripe/checkout] user lookup failed", userError);
      return jsonError("Couldn't load your billing profile.", 500);
    }

    let customerId = (row?.stripe_customer_id as string | undefined) || undefined;

    // A customer saved from a DIFFERENT Stripe mode/account (e.g. you tested in
    // live, then switched to test) does NOT exist under the current key — Stripe
    // returns "No such customer" (resource_missing), which looks like a price
    // error. Validate the saved customer and recreate it if it's stale.
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if ((existing as { deleted?: boolean }).deleted) customerId = undefined;
      } catch {
        customerId = undefined;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: (row?.email as string | undefined) || user.email || undefined,
        metadata: { userId: user.uid },
      });
      customerId = customer.id;
      const { error: updateError } = await supabaseAdmin
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.uid);
      if (updateError) {
        console.error("[stripe/checkout] customer save failed", updateError);
        return jsonError("Couldn't save your billing profile.", 500);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/settings?upgraded=true&plan=${planName}`,
      cancel_url: `${appUrl}/settings`,
      metadata: { userId: user.uid },
      allow_promotion_codes: true,
      subscription_data: { metadata: { userId: user.uid } },
    });
    if (!session.url) {
      console.error("[stripe/checkout] session created without url", session.id);
      return jsonError("Stripe did not return a checkout URL.", 502);
    }

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    return stripeCheckoutError(err);
  }
}
