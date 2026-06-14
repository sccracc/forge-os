import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { stripe, stripeConfigured } from "@/lib/stripe/server";
import { planForSubscription } from "@/lib/stripe/subscription-entitlement";

export const runtime = "nodejs";

/**
 * POST /api/stripe/sync — reconcile the user's plan with Stripe.
 *
 * Webhooks are the canonical sync, but they're easy to misconfigure (wrong mode,
 * missing endpoint, bad signing secret) and then a successful payment never
 * flips the plan. This endpoint is called by the client right after Checkout
 * returns (`/settings?upgraded=true`) and reads the user's live subscription
 * straight from Stripe, so the plan activates regardless of webhook setup.
 *
 * It looks up the user's Stripe customer, finds their most relevant subscription
 * (active / trialing / past_due), maps its price → plan, and writes it to
 * Supabase. If there is no live subscription it downgrades to free.
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

  try {
    const { data: row, error } = await supabaseAdmin
      .from("users")
      .select("id, plan, stripe_customer_id")
      .eq("id", user.uid)
      .maybeSingle();
    if (error) {
      console.error("[stripe/sync] user lookup failed", error);
      return jsonError("Couldn't load your billing profile.", 500);
    }

    const customerId = (row?.stripe_customer_id as string | undefined) || undefined;
    const currentPlan = (row?.plan as string | undefined) ?? "free";
    if (!customerId) {
      // Never purchased — nothing to reconcile.
      return Response.json({ plan: currentPlan, changed: false });
    }

    // Pull this customer's subscriptions and pick the best "live" one.
    let subs: Stripe.Subscription[] = [];
    try {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });
      subs = list.data;
    } catch (err) {
      // A stale/cross-mode customer id won't exist under the current key.
      console.error("[stripe/sync] subscriptions.list failed", err);
      return Response.json({ plan: currentPlan, changed: false });
    }

    const live = subs
      .map((sub) => ({ sub, plan: planForSubscription(sub) }))
      .filter((entry): entry is { sub: Stripe.Subscription; plan: NonNullable<ReturnType<typeof planForSubscription>> } =>
        Boolean(entry.plan)
      )
      .sort((a, b) => (b.sub.created ?? 0) - (a.sub.created ?? 0))[0];

    let nextPlan = "free";
    let subscriptionId: string | null = null;
    if (live) {
      const mapped = live.plan;
      if (mapped) {
        nextPlan = mapped;
        subscriptionId = live.sub.id;
      } else {
        // Subscription exists but its price isn't in our map — keep whatever the
        // user already had rather than wrongly downgrading.
        return Response.json({ plan: currentPlan, changed: false });
      }
    }

    if (nextPlan !== currentPlan) {
      const { error: upErr } = await supabaseAdmin
        .from("users")
        .update({ plan: nextPlan, stripe_subscription_id: subscriptionId })
        .eq("id", user.uid);
      if (upErr) {
        console.error("[stripe/sync] plan update failed", upErr);
        return jsonError("Couldn't update your plan.", 500);
      }
    }

    return Response.json({ plan: nextPlan, changed: nextPlan !== currentPlan });
  } catch (err) {
    console.error("[stripe/sync]", err);
    return jsonError("Couldn't sync your plan. Please try again.", 500);
  }
}
