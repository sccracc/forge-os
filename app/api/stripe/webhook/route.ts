import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeConfigured } from "@/lib/stripe/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { planForSubscription } from "@/lib/stripe/subscription-entitlement";

export const runtime = "nodejs";

/** Resolve our user id from a subscription's metadata, else by customer id. */
async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.userId;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * POST /api/stripe/webhook — Stripe → Supabase plan sync. Uses the RAW body for
 * signature verification (request.text() before any parsing).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeConfigured || !secret) {
    return new Response("Billing is not configured.", { status: 500 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature.", { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) return new Response("ignored", { status: 200 });
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) return new Response("ignored", { status: 200 });

      const sub = await stripe.subscriptions.retrieve(subId);
      const plan = planForSubscription(sub);
      if (plan) {
        await supabaseAdmin
          .from("users")
          .update({ plan, stripe_subscription_id: sub.id })
          .eq("id", userId);
      }
      return new Response("ok", { status: 200 });
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub);
      if (!userId) return new Response("ignored", { status: 200 });
      const plan = planForSubscription(sub);
      if (plan) {
        await supabaseAdmin
          .from("users")
          .update({ plan, stripe_subscription_id: sub.id })
          .eq("id", userId);
      } else {
        await supabaseAdmin
          .from("users")
          .update({ plan: "free", stripe_subscription_id: null })
          .eq("id", userId);
      }
      return new Response("ok", { status: 200 });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub);
      if (!userId) return new Response("ignored", { status: 200 });
      await supabaseAdmin
        .from("users")
        .update({ plan: "free", stripe_subscription_id: null })
        .eq("id", userId);
      return new Response("ok", { status: 200 });
    }

    // Unhandled event type.
    return new Response("unhandled event", { status: 400 });
  } catch (err) {
    console.error("[stripe/webhook] handler error", err);
    return new Response("handler error", { status: 500 });
  }
}
