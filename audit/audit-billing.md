# Forge OS — Billing, Plans & Usage Metering Audit

Scope: `lib/stripe/**`, `app/api/stripe/**` (checkout, portal, sync, webhook, debug),
`lib/plans/**`, `lib/usage/**`, `app/api/data/usage/**`, `SETUP_INSTRUCTIONS_STRIPE.md`,
`update users set plan = 'ultra' whe.txt`, and all tests covering the above.

**Audit-only.** Billing/pricing/limit logic is frozen. Every item in each Fixes
section is tagged `[SAFE-NOW]` (no change to billing/pricing/limit behavior —
auth, cleanup, tests, docs, observability) or `[DEFERRED]` (would change
billing/quota/pricing/entitlement behavior).

**Architecture note surfaced during the audit:** `CLAUDE.md` describes the data
layer as "Firebase (Auth + Firestore + Storage) + Admin SDK," but every file in
this scope (`lib/supabase/server.ts`, `lib/supabase/usage.ts`,
`supabase/schema.sql`, all `/api/stripe/*` and `/api/data/usage` routes) reads
and writes a Supabase Postgres database via `supabaseAdmin`. Firebase is used
only for **auth** (`lib/auth/server-auth.ts` verifies Firebase ID tokens); all
billing/plan/usage state lives in Supabase Postgres, not Firestore. This is a
pre-existing documentation/reality mismatch, noted here for context — it does
not itself constitute a billing bug.

---

## Stripe Checkout & Customer Portal

**What's included:**
- `lib/stripe/server.ts:6` — `stripeConfigured` flag (`Boolean(process.env.STRIPE_SECRET_KEY?.trim())`).
- `lib/stripe/server.ts:13-20` — Stripe client construction with a pinned `apiVersion` (`"2026-02-25.clover"`) and a placeholder key (`sk_test_placeholder_unset`) so `next build` doesn't throw pre-env-setup.
- `lib/stripe/price-map.ts:5-16` — `PRICE_TO_PLAN` allowlist built only from configured `NEXT_PUBLIC_STRIPE_*_PRICE_ID` env vars; blank env vars are filtered out.
- `lib/stripe/price-map.ts:18-20` — `planForPrice(priceId)` lookup.
- `app/api/stripe/checkout/route.ts:45-141` — `POST` handler:
  - `verifyRequest` auth (line 48), `stripeConfigured` gate (line 53).
  - Body parse + `priceId` trim/require (lines 55-62).
  - `planForPrice` validation, rejecting unconfigured prices (lines 63-66).
  - `stripe.prices.retrieve` + active/monthly validation (lines 71-77).
  - Customer lookup from `users.stripe_customer_id` (lines 80-88).
  - Stale/cross-mode customer detection via `stripe.customers.retrieve` + recreation (lines 96-103).
  - Customer creation + persistence back to Supabase (lines 105-119).
  - `checkout.sessions.create` with `mode: "subscription"`, `metadata.userId`, `subscription_data.metadata.userId`, `allow_promotion_codes: true` (lines 121-130).
  - `stripeCheckoutError()` friendly-error mapping for customer/price/key/generic Stripe failures (lines 9-38).
- `app/api/stripe/portal/route.ts:9-38` — `POST` handler: auth, `stripeConfigured` gate, `stripe_customer_id` lookup, `billingPortal.sessions.create`, generic error fallback.
- `components/settings/billing-section.tsx`:
  - `PRICE_ENV` (lines 12-17), `RANK` (line 19), plan card data + full feature-comparison table (lines 21-192).
  - `openPortal()` (lines 238-253), `handleUpgrade()` (lines 257-288) — routes existing subscribers (`plan !== "free"`) to the portal for **both** upgrades and downgrades; only free users hit `/api/stripe/checkout` (lines 255-270).
- `SETUP_INSTRUCTIONS_STRIPE.md` — full walkthrough (Stripe account → 4 products → API keys → env vars → deploy → webhook → test flow → mode switch).

**Strengths:**
1. Never trusts a client-sent uid — both routes derive `uid` from `verifyRequest()`'s Firebase token (`checkout/route.ts:48`, `portal/route.ts:12`).
2. `priceId` is validated against a server-side allowlist (`planForPrice`) built only from configured env vars — an arbitrary/foreign Stripe price id is rejected (`checkout/route.ts:63-66`; `price-map.ts:12-20`).
3. The price is re-validated live against Stripe (`prices.retrieve`) and rejected if inactive or not a monthly recurring price, so a stale/misconfigured env price can't silently be used (`checkout/route.ts:71-77`).
4. Detects a customer id left over from a different Stripe mode/account and recreates the customer rather than failing (`checkout/route.ts:96-103`).
5. Persists the new Stripe customer id back to Supabase immediately so re-entrant checkouts reuse it (`checkout/route.ts:105-119`).
6. Ties the Checkout Session **and** the resulting Subscription to the app's user id via metadata in two places, so the webhook doesn't depend solely on customer-id lookup (`checkout/route.ts:127,129`).
7. Clean 503 (not a throw) when `STRIPE_SECRET_KEY` is unset, matching a repo-wide "no env = clean error" pattern (`checkout/route.ts:53`; `portal/route.ts:17`; `server.ts:6`).
8. Actionable, specific error copy distinguishes "wrong mode/account," "bad key," and "Stripe outage" for whoever is configuring billing (`checkout/route.ts:9-38`).
9. The client only ever sends `{priceId}`; customer id, plan mapping, and all trust decisions are resolved server-side.
10. The client actively avoids duplicate subscriptions in the UI layer: any existing subscriber is routed to the Billing Portal for both upgrade and downgrade, never back through Checkout (`billing-section.tsx:255-270`).
11. `allow_promotion_codes: true` gets Stripe-side coupon support for free (`checkout/route.ts:128`).
12. The pinned `apiVersion` (`server.ts:13`) protects webhook/event-shape stability across SDK upgrades.
13. Every numeric marketing claim I checked (tokens/window, images, vision, searches, documents, voice minutes/chars, code executions, project counts) in `billing-section.tsx`'s `PLANS`/`COMPARISON` data matches `PLAN_LIMITS`/`getProjectLimit` exactly — the price page isn't overselling the entitlements that are actually implemented.
14. The placeholder Stripe key keeps `next build`/CI from requiring real secrets (`server.ts:17-19`).

**Weaknesses:**
1. **No server-side guard against duplicate subscriptions.** `POST /api/stripe/checkout` never checks whether the caller already has an active/trialing/past_due subscription before creating a new Checkout Session (`checkout/route.ts:45-141`) — the "existing subscribers use the portal" rule lives only in the client component (`billing-section.tsx:255-270`). Any authenticated user calling the API directly (devtools/curl/replay) while already subscribed can create a second, independent Stripe subscription and be billed twice.
2. This directly feeds a downstream ambiguity in `/api/stripe/sync`'s "most-recently-created" tie-break when two entitled subscriptions coexist (see Webhook/Sync feature, weakness 7).
3. Dead field: the client sends `{ priceId, billingPeriod: "monthly" }` (`billing-section.tsx:279`) but `checkout/route.ts:55` only destructures `{ priceId }` — `billingPeriod` is vestigial from a removed annual-billing toggle (doc even says so, `SETUP_INSTRUCTIONS_STRIPE.md:124-125`).
4. No rate limiting on `/api/stripe/checkout`, `/api/stripe/portal`, or `/api/stripe/sync` — contrast with `/api/chat`'s `checkRateLimit` (`lib/ai/rate-limit.ts`). An authenticated user (or a looping client) can generate unbounded server-side Stripe API calls.
5. Three sequential Stripe API calls on the checkout hot path for a returning customer — `customers.retrieve` (line 98), `prices.retrieve` (line 71), `checkout.sessions.create` (line 121) — each a latency/failure point.
6. If the post-creation Supabase update fails (`updateError`, lines 111-118), the Stripe customer was already created but never saved — a retried checkout creates yet another Stripe customer for the same user (no idempotency key is passed to `stripe.customers.create`).
7. Neither `stripe.customers.create` nor `stripe.checkout.sessions.create` is called with a Stripe idempotency key — a client retry after a timed-out-but-actually-succeeded request can double-create a customer or session.
8. The `success_url`'s `plan` query param (`checkout/route.ts:125`) is echoed into a client welcome toast (`app/(app)/settings/page.tsx:108-111`) before `/api/stripe/sync` confirms anything — a hand-crafted `?upgraded=true&plan=ultra` URL shows a "Welcome to Ultra" toast with no purchase. Cosmetic only (entitlements are re-derived server-side by the immediate `/api/stripe/sync` call), but it's unvalidated user-facing messaging.
9. `SETUP_INSTRUCTIONS_STRIPE.md`'s "Files created" list (lines 111-120) omits `app/api/stripe/sync/route.ts` and `app/api/stripe/debug/route.ts` entirely, even though both exist and ship as part of the same feature — the doc is stale relative to the code.
10. Zero test coverage for `app/api/stripe/checkout/route.ts` or `app/api/stripe/portal/route.ts` — no "checkout"/"portal" matches anywhere under `tests/`. The customer-reuse, stale-customer-recreation, and price-validation logic are all unverified.
11. `stripeCheckoutError()` pattern-matches on `err.message` substrings ("No such customer", "No such price", "api key") to pick user-facing copy (`checkout/route.ts:9-38`) — brittle against Stripe changing error wording.
12. The portal route's failure path is a single generic 500 (`portal/route.ts:34-37`) with no differentiation for a portal-not-configured-for-this-Stripe-account error, unlike checkout's much more granular error mapping.

**Fixes:**
1. [DEFERRED] Add a server-side check in `checkout/route.ts` that blocks (or redirects to the portal) when the caller already has an entitled subscription, before creating a new Checkout Session — closes weakness 1; changes checkout business logic.
2. [DEFERRED] Add a Stripe idempotency key to `customers.create` and `checkout.sessions.create` — touches checkout-flow behavior on retries.
3. [SAFE-NOW] Remove the dead `billingPeriod` field from the client payload/type (weakness 3) — no behavior change.
4. [SAFE-NOW] Add rate limiting (reuse `checkRateLimit`) to `/api/stripe/checkout`, `/api/stripe/portal`, `/api/stripe/sync` — protective only.
5. [SAFE-NOW] Update `SETUP_INSTRUCTIONS_STRIPE.md`'s file list to include the `sync` and `debug` routes, and add a step to remove/gate `debug` before launch — docs only.
6. [SAFE-NOW] Add route tests for checkout/portal (auth required, price not configured, price inactive, customer reuse, stale-customer recreation) — tests only.
7. [DEFERRED] Stop trusting the `plan` URL param for the welcome toast; show a generic "activating your plan…" message until `/api/stripe/sync` confirms it — messaging tied to the billing flow, flagged deferred out of caution.

---

## Webhook Handling & Plan Sync

**What's included:**
- `app/api/stripe/webhook/route.ts`:
  - `resolveUserId()` — subscription metadata first, then `stripe_customer_id` lookup fallback (lines 10-20).
  - Raw-body signature verification via `req.text()` + `stripe.webhooks.constructEvent` (lines 26-41).
  - `checkout.session.completed` handler — resolves subscription, maps price → plan, writes `plan`+`stripe_subscription_id` (lines 44-63).
  - `customer.subscription.updated` handler — maps plan or downgrades to free (lines 65-82).
  - `customer.subscription.deleted` handler — resets to free (lines 84-93).
  - Unhandled event types → `400` (line 96).
- `lib/stripe/subscription-entitlement.ts` — `ENTITLED_SUBSCRIPTION_STATUSES` (`active`/`trialing`/`past_due`), `hasPaidEntitlementStatus`, `planForSubscription`.
- `app/api/stripe/sync/route.ts` — client-triggered reconciliation: auth, `stripe_customer_id` lookup, `subscriptions.list({status:"all"})`, filters to subscriptions with a mapped plan, sorts by `created` desc, picks the top one, writes `plan`+`stripe_subscription_id` if changed (lines 23-103).
- `app/(app)/settings/page.tsx:100-137` — post-redirect effect that calls `/api/stripe/sync` once immediately and again after a 3.5s `setTimeout`, then invalidates the cached profile and refreshes usage.
- `tests/stripe-entitlement.test.ts` — covers `planForSubscription` for active/trialing-equivalent and terminal statuses.

**Strengths:**
1. Signature verification uses the raw request text before any JSON parsing (`webhook/route.ts:34-41`) — avoids the classic Next.js body-parsing pitfall for Stripe webhooks.
2. Missing signature or missing/absent webhook secret both fail closed with distinct status codes (`400`/`500`) rather than skipping verification (lines 28-32).
3. `ENTITLED_SUBSCRIPTION_STATUSES` correctly includes `past_due` so a temporarily-failed charge doesn't instantly lock the user out (`subscription-entitlement.ts:5`), verified by `tests/stripe-entitlement.test.ts:24-28`.
4. Terminal/non-paying statuses (`canceled`, `unpaid`, `incomplete_expired`, `paused`) are all excluded and explicitly tested (`tests/stripe-entitlement.test.ts:30-37`).
5. `resolveUserId` has a two-tier fallback (metadata → customer-id lookup), covering events without `userId` metadata (`webhook/route.ts:10-20`).
6. Both the webhook and `/api/stripe/sync` persist `stripe_subscription_id` alongside `plan` (`webhook/route.ts:59,73`; `sync/route.ts:90`), not just a bare plan string.
7. `/api/stripe/sync`'s own comment correctly diagnoses that "webhooks are easy to misconfigure" and gives the client an independent activation path (`sync/route.ts:11-22`).
8. `/api/stripe/sync` deliberately avoids wrongly downgrading a user when a subscription's price isn't in the map, keeping the current plan instead (`sync/route.ts:80-84`).
9. `/api/stripe/sync` fails soft (returns current plan unchanged) on a `subscriptions.list` error instead of a 500 (lines 60-64).
10. The settings page double-syncs (immediate + 3.5s later) after checkout/portal return, covering both "sync wins the race" and "webhook lands a moment later" (`settings/page.tsx:117-134`).
11. Handler errors are caught and return `500` (`webhook/route.ts:97-100`), which correctly causes Stripe to retry only genuine failures.
12. `customer.subscription.deleted` unconditionally and unambiguously resets to free + null subscription id (lines 84-93).

**Weaknesses:**
1. **Any webhook event type other than the three handled returns HTTP `400`** (`webhook/route.ts:96`). Stripe treats non-2xx as delivery failure and retries with backoff; enough consecutive failures cause Stripe to auto-disable the endpoint — silently breaking plan sync going forward if the dashboard is ever configured for (or Stripe adds) additional event types.
2. **No idempotency / duplicate-delivery protection** — `event.id` is never read or persisted anywhere in the handler. Currently low-risk because every effect is a last-write-wins `update`, but there is no guard if a future handler adds anything additive.
3. **No test coverage for the webhook route itself** — `tests/stripe-entitlement.test.ts` only tests the pure `planForSubscription` function, not signature verification, event routing, `resolveUserId` fallback, or the 400 unhandled-event path.
4. **No test coverage for `/api/stripe/sync`** — the "most-recently-created entitled subscription" pick, the "don't downgrade on unmapped price" guard, and the "no customer id → no-op" short-circuit (`sync/route.ts:46-49`) are all unverified.
5. `checkout.session.completed` silently no-ops with `200` when `metadata.userId` or `subscription` is missing (lines 47, 52), with no logging — a misconfigured session fails invisibly with nothing in the server logs to catch it.
6. `customer.subscription.updated` downgrades to free for **any** non-entitled status (lines 75-80) based on a single event/subscription in isolation, unlike `/api/stripe/sync` which looks at all of a customer's subscriptions — combined with the double-subscription gap in the Checkout feature, a transient status (e.g., `incomplete`) on a second subscription could flip the user to free even while an older subscription is genuinely still active.
7. `/api/stripe/sync`'s "most recently created" tie-break (`sync/route.ts:66-71`) has no rule favoring the *higher* tier when a customer has two simultaneously-active entitled subscriptions — it could select a lower plan than what's actually being charged.
8. No request-size or content-type check before `req.text()` buffers the full body into memory — low risk since Stripe controls the caller, but there's no defense-in-depth if the endpoint URL is hit directly by a non-Stripe caller with an oversized body.
9. `SETUP_INSTRUCTIONS_STRIPE.md` step 9 (lines 94-99) only walks through testing `checkout.session.completed`, with no equivalent guidance for verifying `customer.subscription.updated`/`.deleted` delivery, despite the doc listing all three as required (step 7).
10. No diagnostic help for a mode-mismatched webhook secret (live secret + test endpoint or vice versa) — it fails every signature check with the same generic "Invalid signature" (line 40), unlike checkout's dedicated mode-mismatch detection.

**Fixes:**
1. [SAFE-NOW] Return `200` (not `400`) for unhandled event types (`webhook/route.ts:96`) — only changes the HTTP status Stripe sees for events Forge doesn't act on; no plan/price/limit change.
2. [SAFE-NOW] Log a warning when `checkout.session.completed` is missing `metadata.userId`/`subscription` (weakness 5) — observability only.
3. [SAFE-NOW] Persist processed `event.id`s to guard future handlers against duplicate delivery — additive safety net.
4. [SAFE-NOW] Add tests for webhook signature verification, event routing, `resolveUserId` fallback, and `/api/stripe/sync`'s reconciliation logic — tests only.
5. [SAFE-NOW] Update `SETUP_INSTRUCTIONS_STRIPE.md` step 9 to cover testing all three configured event types — docs only.
6. [DEFERRED] Have `/api/stripe/sync`/the webhook consider all of a customer's entitled subscriptions and pick the highest tier rather than the most recent — changes plan-resolution logic.
7. [DEFERRED] Fix the double-subscription root cause from the Checkout feature — same deferred item, listed there.

---

## Stripe Debug Endpoint

**What's included:**
- `app/api/stripe/debug/route.ts` — `GET`, no auth (entire file):
  - Key-mode classification from the secret key's prefix (lines 22-33).
  - `stripeConfigured`, `supabaseConfigured`, `keyMode`, `keyLivemode`, `webhookSecretSet`, `appUrl`, `configuredPriceIds` in every response (lines 35-45).
  - Per-plan `priceChecks` — retrieves each of the 4 configured prices and reports found/active/amount/currency/interval, or the error if not found (lines 52-74).
  - `accountPricesUnderThisKey` — lists up to 20 active prices for the whole Stripe account under the deployed key, including `nickname` (lines 77-91).
  - In-file comment: "TEMPORARY billing diagnostic — DELETE THIS FILE after you've fixed billing" (line 7).

**Strengths:**
1. Never exposes the secret key itself, only a prefix-derived mode classification (lines 22-33).
2. Directly targets the single most common Stripe setup failure ("No such price") by cross-checking configured price IDs against what the key can retrieve and list (lines 52-91).
3. Degrades cleanly (a `note` field, not a throw) when `STRIPE_SECRET_KEY` is unset (lines 47-50).
4. Per-price retrieval failures are caught individually so one bad ID doesn't break the whole response (lines 70-73).
5. Ships with an explicit in-file warning to delete it after setup (line 7).
6. The `howToRead` field (lines 36-37) is written for a human debugging a broken deploy, not just raw data dump — genuinely useful for its stated purpose.

**Weaknesses:**
1. **Zero authentication of any kind.** `GET /api/stripe/debug` has no `verifyRequest`/auth check — unlike every other route in this audit. Anyone who finds the deployment URL can hit it with no credentials (line 21 onward).
2. Discloses live/test mode and whether the webhook secret is set to an anonymous caller (lines 39-44) — reconnaissance information with no gate.
3. **Lists up to 20 active prices for the entire connected Stripe account**, not just the 4 Forge plan prices (line 79) — if the same Stripe account backs anything else, that pricing/currency/nickname data leaks to an unauthenticated caller.
4. The file's own comment claims it exposes "ONLY non-sensitive info" (line 9), but "all active account-wide prices with nicknames" is materially broader than the 4 `NEXT_PUBLIC_*` price IDs it's nominally there to check — the comment understates the real disclosure.
5. No rate limiting — each anonymous hit triggers up to 5 Stripe API calls server-side (4 `prices.retrieve` + 1 `prices.list`).
6. Despite the "delete this file" comment, there is no `NODE_ENV`/feature-flag gate in the code itself preventing it from staying live in production indefinitely — and it is, in fact, currently live in the tree with no such gate.
7. Not mentioned anywhere in `SETUP_INSTRUCTIONS_STRIPE.md` — a reader following the doc top-to-bottom never learns this route exists or that it needs removing.
8. `configuredPriceIds`/`priceChecks[plan] = {configured:false}` (lines 44, 56) lets an anonymous caller see exactly which plan tiers are wired up vs. still unconfigured — reveals launch-readiness/roadmap information to anyone.
9. Stripe error `.message`/`.code` strings are relayed verbatim to an unauthenticated caller for both per-price failures (line 72) and the account-wide list failure (lines 88-90) — third-party error text (which can include account-specific detail) is exposed with no filtering.
10. No test coverage at all.

**Fixes:**
1. [SAFE-NOW] Gate the route behind `verifyRequest` and/or a server-only shared secret header — closes the unauthenticated-disclosure hole without touching any billing/price/limit logic.
2. [SAFE-NOW] Delete the file now that initial setup is presumably done, or gate it behind `process.env.NODE_ENV !== "production"` — pure removal/gating.
3. [SAFE-NOW] If kept, drop `accountPricesUnderThisKey` (or filter it to the 4 known price IDs) so it can never surface unrelated account pricing — reduces diagnostic scope only, no billing impact.
4. [SAFE-NOW] Add a step to `SETUP_INSTRUCTIONS_STRIPE.md` documenting the endpoint and requiring its removal/gating before production — docs only.

---

## Plan Definitions & Entitlements

**What's included:**
- `lib/plans/limits.ts` — `PLAN_LIMITS` (free/starter/pro/max/ultra × 9 metered axes, lines 5-66), `PlanId` type, `resolvePlanId()` (lines 71-73, defaults unknown → free).
- `lib/plans/gates.ts`:
  - `canUseModel`, `canUseEffort` (with `EFFORT_ALLOWED`, lines 21-27), `canUseThinking` (lines 30-44).
  - `canUseForgeCode`, `canUseFileSystem`, `canUseProjects`, `getProjectLimit` (lines 47-65).
  - `getFeatureLimit` (lines 68-70), typed against `keyof typeof PLAN_LIMITS.free` (line 8).
  - `FEATURE_REQUIRED` map + `getRequiredPlan`/`getUpgradeMessage` (lines 75-113).
  - `PLAN_NAMES` (lines 10-16).
- `lib/plans/use-plan.ts` — client `usePlan()` hook, defaults to `"free"` before profile loads.
- `tests/gates.test.ts` — covers model/effort/thinking gates, workspace gates, project limits, `getFeatureLimit`, upgrade messaging.

**Strengths:**
1. `PLAN_LIMITS` is the single numeric source of truth imported by both server enforcement (`lib/usage/check.ts`, `lib/usage/server.ts`, the gated routes) and client code (`gates.ts`, `billing-section.tsx`) — no duplicated numbers to drift.
2. `resolvePlanId` defaults any unrecognized plan string to `"free"` (`limits.ts:71-73`) — a corrupted/unexpected DB value fails toward the least-privileged plan.
3. Gate functions are explicitly documented and built as pure/client-safe (`gates.ts:1-4`) so the UI's idea of a rule can never diverge from the server's — both call the same function.
4. Nuanced tiering (e.g., Starter gets Thinking on Spark only, not Magnum) is exercised by `tests/gates.test.ts:39-47`.
5. `getUpgradeMessage`/`getRequiredPlan` centralize "which plan unlocks X" copy (`gates.ts:104-113`) so every gated route's 403 payload is consistent rather than hand-rolled per route.
6. `getProjectLimit`'s `null` = unlimited convention for Ultra is exercised by a dedicated test (`tests/gates.test.ts:57-63`).
7. `getFeatureLimit`'s argument is typed as `keyof typeof PLAN_LIMITS.free` (`gates.ts:8,68-70`) — a compile-time guarantee against typo'd feature-limit keys silently resolving to 0.
8. `tests/gates.test.ts:73` explicitly covers "unknown plan → free" for `getFeatureLimit`.
9. `usePlan()` defaults to `"free"` before the profile loads (`use-plan.ts:10-13`), so UI locks fail closed rather than briefly showing paid features during load.
10. Every marketed number I cross-checked (token windows, images, vision, searches, documents, voice minutes/chars, code executions, project counts) between `billing-section.tsx` and `PLAN_LIMITS`/`getProjectLimit` matched exactly — no drift found for the entitlements that are actually implemented.

**Weaknesses:**
1. **Several marketed entitlements have no corresponding key or enforcement anywhere in the codebase.** `billing-section.tsx`'s plan cards/comparison table advertise per-plan **storage caps** (10GB/50GB/200GB), **MCP connector limits** (3 for Pro, "Unlimited" for Max/Ultra), an **"API access"** feature (beta 500K/mo Max, full 5M/mo Ultra), and **"Team seats ($60/seat/mo add-on)"** for Ultra (`billing-section.tsx:98-99,129-131,159-161,187-190`) — none exist as `PLAN_LIMITS` keys (`limits.ts:5-66`), none are checked by any route, and there is no seat-based Stripe price (only the 4 flat monthly prices in `price-map.ts`). A paying Ultra customer expecting metered API access or team seats gets nothing that provides or enforces either.
2. The only storage limit enforced anywhere is a flat ~1MB-per-file inline-content cap (`lib/data/files.ts:228`), unrelated to plan tier — completely disconnected from the advertised per-plan GB figures.
3. `getRequiredPlan` silently defaults to `"pro"` for any feature string not present in `FEATURE_REQUIRED` (`gates.ts:105-107`) — a typo'd feature name at a call site produces a plausible-looking but wrong upgrade message rather than a build/runtime error.
4. `FEATURE_REQUIRED` still contains an `"api access": "max"` entry (`gates.ts:101`) for a feature that (per weakness 1) isn't implemented anywhere — a latent trap if it's ever wired into a real "Feature Locked" modal.
5. `canUseModel`/`canUseEffort`/`canUseThinking`/`canUseForgeCode`/`canUseFileSystem` all take `plan: string` and re-resolve it internally on every call (`gates.ts:30-53`) rather than taking the branded `PlanId` — no type-level signal to callers that unknown strings are silently coerced to `"free"`.
6. No test coverage for `getRequiredPlan`'s unknown-feature fallback itself (only happy-path lookups are tested, `tests/gates.test.ts:78-84`).
7. No test coverage for `canUseProjects` (only its sibling `getProjectLimit` is tested), despite being exported.
8. `PLAN_NAMES` (`gates.ts:10-16`) and the marketing plan names in `billing-section.tsx:31-164` are two independently hand-maintained string tables with no shared source — unlike the numeric limits, which do share `PLAN_LIMITS`.
9. `usePlan()` reads cached client profile state with no revalidation trigger of its own (`use-plan.ts:10-13`) — UI-only gating can show stale paid/free status briefly after a plan change until something else (e.g. the settings-page sync effect) invalidates the profile cache. (Server routes always re-check the plan fresh from the DB, so this is UI-only.)
10. There is no automated check that `billing-section.tsx`'s marketed numbers match `PLAN_LIMITS`/`getProjectLimit` — the exact match found in this audit is not enforced going forward; a future edit to one without the other would silently drift with nothing to catch it.

**Fixes:**
1. [DEFERRED] Either implement storage/MCP-connector/API-access/team-seat metering to match what's marketed, or trim the marketing copy to what's enforced — either direction is a billing/entitlement-scope change.
2. [SAFE-NOW] Remove the dead `"api access"` `FEATURE_REQUIRED` entry (or comment it as aspirational/unwired) until the feature exists — cleanup only.
3. [SAFE-NOW] Add a test asserting `billing-section.tsx`'s numeric claims equal `PLAN_LIMITS`/`getProjectLimit` so future drift fails CI — test-only.
4. [SAFE-NOW] Add missing coverage for `getRequiredPlan`'s fallback and `canUseProjects` — test-only.
5. [SAFE-NOW] Make `getRequiredPlan`'s unknown-feature path throw/log in development instead of silently defaulting to `"pro"` — improves fail-fast diagnostics, doesn't change any plan's actual limits.
6. [DEFERRED] Unify `PLAN_NAMES` and the marketing plan-name strings behind one source — touches plan-facing presentation code, flagged deferred out of caution.

---

## Usage Metering & Quotas

**What's included:**
- `lib/usage/types.ts` — `UsageSnapshot`, `UsagePayload`.
- `lib/usage/compute.ts` — pure math: `tokenStatus`, `indicatorLevel`, `progressColor`, `formatHrMin`/`formatDaysHr`, `formatUsagePercent`, `estimateTokens`.
- `lib/usage/check.ts` — `checkTokenLimit()`: pre-request Forge-token gate (daily for free, 5h+weekly for paid), fails open on error.
- `lib/usage/deduct.ts` — `deductTokens()`: applies the model/thinking multiplier (Spark 1×/2×, Magnum 5×/10×) and calls `deductForgeTokens`.
- `lib/usage/server.ts` — `getUsageContext()` (plan + per-feature monthly counts, fails open to free/zero), `planGateResponse()` (403 payload shape).
- `lib/supabase/usage.ts` — `deductForgeTokens` (RPC wrapper), `recordChatUsage` (wraps `deductForgeTokens`, plan lookup), `incrementUsage` (RPC + read-modify-write fallback).
- `supabase/schema.sql` — `usage` table (lines 44-63), `deduct_forge_tokens()` RPC (lines 177-261), `increment_usage()` RPC (lines 405-451).
- `app/api/data/usage/route.ts` — authenticated `GET` snapshot of the caller's own plan + usage.
- Enforcement call sites: `app/api/chat/route.ts` (tokens, searches, images, vision, documents), `app/api/voice/transcribe/route.ts` (voice input minutes), `app/api/voice/speak/route.ts` (voice output chars), `app/api/code/run/route.ts` (code executions).
- `lib/store/usage-store.ts` — client display-only state (no client-side blocking beyond reflecting server 429/403).
- `tests/usage.test.ts` (pure `compute.ts` math), `tests/reset-sql.test.ts` (pins the UTC reset SQL fragments).

**Strengths:**
1. Forge-token window rollovers happen inside Postgres row locking (`select ... for update`) in `deduct_forge_tokens` (`schema.sql:186-187,419`) — real DB-level atomicity for the read-modify-write, not application-level.
2. Both RPCs auto-provision the `usage` row on first use (`schema.sql:189-193,421-424`) — no separate provisioning step, no risk of a missing row silently failing.
3. Every usage-tracking call fails **open** on infra error (`usage/check.ts:93-95`; `supabase/usage.ts:14-21,28-30`; `usage/server.ts:57-59`) — a Supabase outage degrades to "unmetered," not "product down," and this is documented consistently in comments.
4. Window semantics are lazily rolled over only at the next deduction, and `checkTokenLimit` independently re-derives whether a stale counter should count — verified with dedicated tests for exactly this ("treats a stale counter as 0," `tests/usage.test.ts:64-68,88-96`).
5. Monthly-reset SQL (`date_trunc('month', ... at time zone 'UTC') + interval '1 month'`) is identical in both RPCs and pinned by a dedicated regression test (`tests/reset-sql.test.ts:12-15`), so a future edit can't silently change reset semantics without a test failing.
6. `incrementUsage` has an automatic fallback if the `increment_usage` RPC is missing (unmigrated schema) — a manual read-modify-write that still respects the monthly-reset boundary (`supabase/usage.ts:114-165`), so the feature degrades rather than losing counters on an unmigrated DB.
7. Image usage is stored as `numeric`, not `integer`, specifically to support 0.5 fractional counting for a fallback-model image generation (`schema.sql:52-53,67`; `usage.ts:78`) — a deliberate, documented accommodation of real product behavior.
8. Token billing is documented and implemented to charge only the user's own controllable input plus real completion/reasoning tokens, explicitly excluding system prompt/memory/skills/history (`usage/compute.ts:132-136`; `chat/route.ts:486-497`) — a clear, consistently-applied policy.
9. Both free-tier and paid-tier resets use explicit UTC boundaries rather than server-local time (`schema.sql:200-201,255-256`), avoiding timezone-dependent reset bugs.
10. `tokenStatus` is pure, shared verbatim between the composer indicator and the settings page, and thoroughly tested for both free and paid cases including which window is binding (`tests/usage.test.ts:49-107`).
11. Every feature-gated route checks plan + current usage server-side **before** doing the costly work (vision analysis, transcription, TTS, code execution) — none of the gates are client-only.
12. `getUsageContext` fetches `plan` and `usage` in parallel (`Promise.all`) rather than serially (`usage/server.ts:43-46`; `data/usage/route.ts:33-36`), keeping added gating latency low.
13. `/api/data/usage` requires auth and only ever returns the caller's own row (`eq("user_id", user.uid)`) — no arbitrary-user usage lookup surface.

**Weaknesses:**
1. **Check-then-act race condition across every feature-gated route.** `getUsageContext(uid)` is read once at request start (`chat/route.ts:127`; `voice/transcribe/route.ts:39`; `voice/speak/route.ts:48`; `code/run/route.ts:35`) and compared to the limit; the increment only happens after the work finishes (`chat/route.ts:513`; `voice/transcribe/route.ts:92`; `voice/speak/route.ts:83`; `code/run/route.ts:53`). Two concurrent requests from the same user both read the same pre-request count, both pass, and both proceed — monthly quotas can be exceeded by however many requests run concurrently. `increment_usage`'s row locking (`schema.sql:419`) protects concurrent *increments* from clobbering each other, not the check-then-act gap itself.
2. **The same race applies to Forge-token quota enforcement** — `checkTokenLimit` reads a snapshot before generation starts; `deductTokens` only writes real spend back after the full stream finishes (`chat/route.ts:154,498`). Several concurrent chat requests can blow past the 5h/weekly/daily window before any single deduction lands.
3. Within-request tool-call gating (`executeTool`'s web_search/generate_image checks, `chat/route.ts:373,377,385,390`) checks `usageCtx.searches + searchCount` — a snapshot plus an in-memory counter — which correctly bounds a single request/turn but does nothing for weakness 1 across concurrent requests, since `usageCtx` itself predates all of them.
4. `incrementUsage`'s fallback path claims a single user's own usage "doesn't race meaningfully" (`supabase/usage.ts:70-73`), but weakness 1 shows a single user absolutely can trigger concurrent increments (multiple tabs, a retried request, a scripted client) — and the fallback path is a plain read-then-upsert with **zero** locking (lines 114-161), strictly worse than the RPC it falls back from.
5. **No test coverage for any of the server enforcement code.** `lib/usage/check.ts`, `lib/usage/deduct.ts`, `lib/usage/server.ts`, and `lib/supabase/usage.ts` (`deductForgeTokens`, `incrementUsage`, `recordChatUsage`) have zero direct unit tests — only the pure math in `compute.ts` is tested.
6. No test coverage for the `deduct_forge_tokens`/`increment_usage` PL/pgSQL functions themselves — only two string literals from the schema file are pinned (`tests/reset-sql.test.ts`); the row-locking and branching logic have no executable test at any level.
7. No test coverage for any of the four enforcement routes' gating sections (`chat`, `voice/transcribe`, `voice/speak`, `code/run`).
8. `incrementUsage` is described as best-effort/fire-and-forget in spirit (`supabase/usage.ts:8-9,27-30`) but is `await`ed inline on the request's critical path in `chat/route.ts:513` and `code/run/route.ts:53` — a slow RPC call adds directly to response latency. Separately, `recordChatUsage`'s own comment (`usage.ts:34-37`) says it's "designed to be fire-and-forget (not awaited)," but `recordChatUsage` itself is **never called anywhere in the codebase** (confirmed by repo-wide search — only its own definition and a mention in `SETUP_INSTRUCTIONS_SUPABASE.md:124` reference it); `chat/route.ts` calls `deductTokens`/`incrementUsage` directly instead. It is dead code.
9. `getUsageContext`'s fail-open fallback (`usage/server.ts:41,57-59`) returns a full-zero, **free-plan** `FALLBACK` on any error — a transient Supabase blip during a paid user's request incorrectly gates them as free tier for that request (e.g., blocking image generation for an in-limits Pro user). This is the opposite failure direction from `checkTokenLimit`, which fails open toward "allowed" — the two usage subsystems are inconsistent in which way they fail.
10. The free-plan and paid-plan branches of `checkTokenLimit` are two separate code paths with no shared helper (`usage/check.ts:46-60` vs `62-90`) — a fix to one (e.g., how "active window" is computed) must be manually mirrored in the other.
11. Voice-input minute accounting trusts the provider's reported clip duration with no upper-bound sanity check (`voice/transcribe/route.ts:90-92`) — only a `> 0` floor is applied; a provider bug or unexpected response shape could record an arbitrarily large value into the monthly counter.
12. `code/run/route.ts:53` increments the monthly `code_executions` counter by a flat `1` regardless of execution time/resource use — bounded by a fixed runner timeout, but the counted "cost" isn't proportional to actual backend compute consumed.

**Fixes:**
1. [DEFERRED] Make the feature-counter check-and-increment atomic (e.g., have `increment_usage` return the post-increment value and have the caller reject/compensate if it's over budget, instead of checking a pre-fetched snapshot) — changes quota enforcement under concurrency.
2. [DEFERRED] Apply an equivalent reserve-then-true-up pattern to Forge-token windows — changes token-quota enforcement semantics.
3. [SAFE-NOW] Add unit tests for `checkTokenLimit`, `deductTokens`, `getUsageContext`, `deductForgeTokens`, `incrementUsage` (mock Supabase) covering fail-open paths, window boundaries, and RPC-vs-fallback branching — tests only.
4. [SAFE-NOW] Add integration tests for the four enforcement routes' gating logic — tests only.
5. [SAFE-NOW] Add a test exercising the two RPCs against a real/local Postgres, not just string-matching the SQL source — tests only.
6. [SAFE-NOW] Remove the dead `recordChatUsage` function (or wire it in and delete the redundant path in `chat/route.ts`) and fix the stale "not awaited" comment — cleanup/comment accuracy, no behavior change either way since it's unused.
7. [DEFERRED] Make `getUsageContext`'s fail-open behavior consistent with `checkTokenLimit`'s (pick one direction — permissive or restrictive — for infra errors, and apply it uniformly) — changes gating behavior during an infra blip.
8. [SAFE-NOW] Add an upper-bound sanity clamp on provider-reported voice-clip duration before adding it to the monthly counter — guards against corrupt provider data only; does not alter any plan's advertised or enforced limit.

---

## Stray "grant ultra" SQL File (Repo Hygiene / Manual Plan-Override Path)

This "feature" is a single leaked artifact rather than a designed subsystem, so
its strengths/weaknesses lists are shorter than the others by nature — padding
them further would mean inventing points that aren't really there.

**What's included:**
- `update users set plan = 'ultra' whe.txt` (repo root, untracked) — one line:
  `update users set plan = 'ultra' where id = 'SaAyXhJWwnZ9KZn4byPT3WC4E3n1';`
- Confirmed via repo-wide search: referenced nowhere else — not in `supabase/schema.sql`, not in any migration, script, test, or CI step. It is inert.
- No `app/api/admin/**` directory or equivalent admin tooling exists anywhere in the codebase (confirmed via glob) — this raw SQL statement is, as far as this repo shows, the *only* mechanism ever used to manually set a user's plan outside of Stripe.

**Strengths:**
1. It's a plain `UPDATE` statement, not an executable script — it requires a human to manually paste it into the Supabase SQL editor; its mere presence in the repo doesn't grant anyone `ultra` by itself.
2. It targets one specific user id, not a wildcard or a reusable "grant anyone" tool.
3. Saved as `.txt` at the repo root, not under `supabase/` or any migrations directory — it is not picked up by the schema-application tooling (`SETUP_INSTRUCTIONS_SUPABASE.md`'s only instruction is to run `supabase/schema.sql`), so it can't be accidentally re-run as part of normal setup.
4. Repo-wide search confirms it is not referenced by any script, seed file, test, or CI step — it's wired into nothing.
5. The (clumsy, truncated) filename is at least descriptive of its own content, which is exactly how this audit found it immediately.
6. The statement only ever touches the `plan` column for one row — it doesn't fabricate a `stripe_customer_id`/`stripe_subscription_id`, so it can't confuse `/api/stripe/sync` into believing a real subscription exists (`sync/route.ts:46-49` would just see no customer id and no-op).
7. It contains no secrets, tokens, or passwords — the disclosure is bounded to "this Firebase UID exists and was manually set to Ultra," not a credential leak.

**Weaknesses:**
1. **It sits as an untracked file in the working tree of a git repo, one `git add -A`/`git add .` away from permanently entering project history** — with a real (or real-looking) production Firebase UID (`SaAyXhJWwnZ9KZn4byPT3WC4E3n1`) baked into a source-adjacent file, on a project whose own `CLAUDE.md` states "No placeholder/demo/fake data" — this is not fake data, it's a real user identifier.
2. **It documents that the only way to manually grant/adjust a user's plan is a raw, hand-run SQL `UPDATE` against production**, with no admin tool, audit log, confirmation step, or accompanying Stripe action — support/ops work for billing exceptions has no tooling at all (no `app/api/admin/**` exists).
3. **The manual UPDATE bypasses Stripe entirely** — it grants Ultra-tier access with zero corresponding subscription/customer/payment. If that same user later gets a *real* (even lower-tier) Stripe subscription, `/api/stripe/sync`/the webhook will silently downgrade them from the manually-granted `ultra` to whatever the real subscription maps to, with no warning that a manual override is being overwritten.
4. No comment, README, or commit message anywhere explains why this specific user was granted `ultra` manually — unexplained even to someone reading the whole repo.
5. The filename is truncated mid-word ("...whe.txt"), suggesting an accidental save (e.g., pasting SQL text into a filename field) rather than intentional documentation — further evidence it was never meant to persist in the project directory.
6. Sits at the repo root alongside other stray, non-source-controlled scratch material (`FEATURE_AUDIT.md`, `FullAuditReport.md`, `MERIDIAN_MASTER_BUILD_PROMPT.md`) — a general repo-hygiene pattern, flagged here because this specific file was named in scope.
7. No `.gitignore` rule excludes ad hoc root-level `.txt` scratch files, so nothing structurally prevents this class of artifact from being committed by accident in the future.
8. Because a Firebase UID in this project maps 1:1 to a real account with a unique, required email (`users.email` is `not null unique`, `schema.sql:23`), this file — combined with any future DB export — could be used to correlate the UID to a specific person's email; storing it in a plain scratch file outside any access-controlled system is a minor PII-handling lapse.
9. Unlike every code-driven write to `plan` (webhook, sync), this manual path leaves `stripe_subscription_id` untouched — a manually-patched row (`plan: 'ultra'` with a stale/null `stripe_subscription_id`) is an inconsistent shape that none of the application's own logic ever produces, and any future defensive code cross-checking plan-vs-subscription would need to special-case it.

**Fixes:**
1. [SAFE-NOW] Delete `update users set plan = 'ultra' whe.txt` from the repository (it's untracked, so this doesn't touch git history) — pure cleanup, not code; doesn't change any pricing/limit/plan logic.
2. [SAFE-NOW] If the underlying grant is still intended, apply it directly via the Supabase dashboard/SQL editor as a one-off, not stored in the repo — an operational action outside the codebase.
3. [SAFE-NOW] Add a `.gitignore` rule or pre-commit check to catch stray root-level `.txt` scratch files before they're committed — repo hygiene only.
4. [DEFERRED] Build a minimal internal admin tool/endpoint (its own auth, audit log, required reason field) for manually adjusting a user's plan, so future exceptions don't require raw SQL against production — new plan-management functionality, a billing/plan-logic change.
5. [DEFERRED] Have `/api/stripe/sync`/the webhook detect and refuse to silently clobber a plan with no backing `stripe_subscription_id` (i.e., recognize "this looks like a manual override") — changes plan-sync behavior.
