# Stripe Billing Setup

Forge OS uses **Stripe Checkout** for subscriptions, a **webhook** to sync the
user's plan into Supabase, and the **customer portal** for managing/cancelling.
Plans are monthly only. The secret keys live only on the server.

> Until these env vars are set, billing degrades gracefully — upgrade buttons
> report "not configured" and every other feature keeps working.

---

## 1. Create a Stripe account

Sign up at **[stripe.com](https://stripe.com)**. Stay in **Test mode** (toggle
top-right) while developing.

## 2. Create 4 products (monthly prices)

Stripe Dashboard → **Products → Add product**. For each:

| Product        | Price (USD) | Billing            |
| -------------- | ----------- | ------------------ |
| Forge Starter  | $10.00      | Recurring, monthly |
| Forge Pro      | $20.00      | Recurring, monthly |
| Forge Max      | $50.00      | Recurring, monthly |
| Forge Ultra    | $100.00     | Recurring, monthly |

Steps per product: **Add product** → Name (e.g. "Forge Starter") → set the price
to the amount above, **Recurring**, **Monthly** → Save. Then copy that price's
**Price ID** (starts with `price_…`) — you'll need all four.

## 3. Get your API keys

Dashboard → **Developers → API keys**. Copy the **Publishable key**
(`pk_test_…`) and the **Secret key** (`sk_test_…`). Use **Test mode** keys for
development; switch to **Live mode** keys for production (see step 12).

## 4. Add env vars to Vercel

Project → **Settings → Environment Variables**:

| Name                                  | Value                          | Scope        |
| ------------------------------------- | ------------------------------ | ------------ |
| `STRIPE_SECRET_KEY`                   | `sk_test_…`                    | Server only  |
| `STRIPE_WEBHOOK_SECRET`               | `whsec_…` (from step 7)        | Server only  |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`  | `pk_test_…`                    | Public       |
| `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` | `price_…` (Starter)            | Public       |
| `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID`     | `price_…` (Pro)                | Public       |
| `NEXT_PUBLIC_STRIPE_MAX_PRICE_ID`     | `price_…` (Max)                | Public       |
| `NEXT_PUBLIC_STRIPE_ULTRA_PRICE_ID`   | `price_…` (Ultra)              | Public       |
| `NEXT_PUBLIC_APP_URL`                 | `https://your-domain.vercel.app` | Public     |

> `NEXT_PUBLIC_*` values are inlined at build time, so set them **before** you
> deploy (and redeploy after changing them).

## 5. Add the same vars to `.env.local`

Copy the same names/values into your local `.env.local` (see
`.env.local.example`). For local webhook testing, use the Stripe CLI
(`stripe listen --forward-to localhost:3000/api/stripe/webhook`) — it prints a
`whsec_…` to use as `STRIPE_WEBHOOK_SECRET` locally.

## 6. Deploy to Vercel

Deploy so the routes (`/api/stripe/checkout`, `/api/stripe/webhook`,
`/api/stripe/portal`) are live at your domain.

## 7. Set up the webhook

Dashboard → **Developers → Webhooks → Add endpoint**:

- **Endpoint URL:** `https://your-domain.vercel.app/api/stripe/webhook`
- **Events to send:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- **Add endpoint**, then copy the **Signing secret** (`whsec_…`).
- Add it as `STRIPE_WEBHOOK_SECRET` in Vercel and **redeploy**.

## 8. Test the full flow

1. Open **/settings → Plan & Billing**.
2. Click **Upgrade to Starter**.
3. On Stripe Checkout use the test card:
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date · CVC: any 3 digits · ZIP: any
4. You're redirected to **`/settings?upgraded=true&plan=starter`** with a
   "🎉 Welcome to Starter!" toast.
5. In Supabase → **users** table, the `plan` column should now read `starter`
   (and `stripe_customer_id` / `stripe_subscription_id` are set).
6. Stripe Dashboard → **Customers** shows the new customer + subscription.
7. Back in settings, **Manage Billing** opens the Stripe customer portal.

## 9. Test the webhook directly

Dashboard → **Developers → Webhooks** → click your endpoint → **Send test
event** → `checkout.session.completed` → confirm it shows **200**. (A real test
event has no `metadata.userId`, so the handler returns 200 and ignores it —
that's expected; the real flow in step 8 carries the userId.)

## 10. Checking webhook logs if something fails

- Stripe Dashboard → **Developers → Webhooks** → your endpoint → see every
  event and its response code/body.
- Vercel → your project → **Logs** (or the function's logs) for
  `[stripe/webhook]` errors.
- Common causes: wrong/blank `STRIPE_WEBHOOK_SECRET` (→ 400 invalid signature),
  not redeployed after adding the secret, or the price ID not matching the
  `NEXT_PUBLIC_STRIPE_*_PRICE_ID` env (→ plan not updated).

## 11. Files created or modified

**Created**

- `lib/stripe/server.ts` — server-only Stripe client (`stripe`, `stripeConfigured`).
- `lib/stripe/price-map.ts` — maps Price IDs → plan names (from public env).
- `app/api/stripe/checkout/route.ts` — creates/reuses the customer + a Checkout Session.
- `app/api/stripe/webhook/route.ts` — verifies the signature and syncs `plan` into Supabase.
- `app/api/stripe/portal/route.ts` — opens the Stripe customer billing portal.
- `SETUP_INSTRUCTIONS_STRIPE.md` — this file.

**Modified**

- `components/settings/billing-section.tsx` — real Checkout/portal calls (monthly
  only; removed the annual toggle), button loading states.
- `app/(app)/settings/page.tsx` — wider Plan & Billing column; `?upgraded=true`
  success toast + URL cleanup + plan refresh.
- `app/globals.css` — responsive plan-card grid.
- `.env.local.example` — added the Stripe env var names.
- `package.json` — added `stripe` + `@stripe/stripe-js`.

## 12. Switching from test to production

1. Recreate the 4 products/prices in **Live mode** (or activate them) and copy
   the **live** Price IDs.
2. Replace the test keys/price IDs in Vercel with the **live** values
   (`sk_live_…`, `pk_live_…`, live `price_…`).
3. Create a **new webhook endpoint in Live mode** pointing at your production
   URL with the same 3 events; copy its new signing secret.
4. Update `STRIPE_WEBHOOK_SECRET` (and `NEXT_PUBLIC_APP_URL` if it changed).
5. **Redeploy.** Do a real card test, then refund it in the dashboard.
