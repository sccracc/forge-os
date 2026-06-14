import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { stripe, stripeConfigured } from "@/lib/stripe/server";

export const runtime = "nodejs";

/** POST /api/stripe/portal — open the Stripe customer billing portal. */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    user = null;
  }
  if (!user) return jsonError("unauthorized", 401);
  if (!stripeConfigured) return jsonError("Billing is not configured.", 503);

  const { data: row } = await supabaseAdmin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", user.uid)
    .maybeSingle();
  const customerId = row?.stripe_customer_id as string | undefined;
  if (!customerId) return jsonError("No billing account found.", 400);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings?billing_sync=true`,
    });
    return Response.json({ url: portal.url });
  } catch (err) {
    console.error("[stripe/portal]", err);
    return jsonError("Couldn't open the billing portal.", 500);
  }
}
