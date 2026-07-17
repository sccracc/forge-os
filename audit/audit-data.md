# ForgeOS Feature Audit — Auth, Persistence, Files, Publishing

Scope: `lib/auth/**`, `lib/firebase/**`, `lib/supabase/**`, `components/auth/**`, `app/(auth)/**`, `app/api/auth/**`, `lib/data/**`, `app/api/data/**` (agents, conversations, messages, files, profile, projects, publish, skills, usage, export — excluding checkpoints/build-log), `lib/files/**`, `lib/pdf/**`, `app/p/[id]`, `app/api/published/**`, `lib/export.ts`, `firestore.rules`, `storage.rules`, `supabase/`, `firebase.json`.

**Architecture note:** the app is a hybrid. Firebase is used *only* for Google sign-in (client + Admin SDK ID-token verification) and, nominally, Storage. All application data (conversations, messages, projects, files, skills, agents, usage, publishing) lives in **Supabase Postgres**, accessed exclusively through Next.js API routes using the **service-role client** (`lib/supabase/server.ts`), after the route verifies the caller's Firebase ID token and derives `uid` server-side. Firestore itself is not used anywhere in the codebase (`firebase/firestore` is never imported) — `firestore.rules` describes a data model the app has abandoned.

---

## Firebase Authentication (Google sign-in + server verification)

**What's included:**
- Client Firebase app/auth/storage singletons, config-presence gate: `lib/firebase/client.ts:15-36`.
- Admin SDK singleton (Auth + Storage only, no Firestore admin), configured from `FIREBASE_ADMIN_*` env vars, private key newline-unescaping: `lib/firebase/admin.ts:12-45`.
- Server-side bearer-token verification, returns `null` on any failure, never trusts a client-sent uid: `lib/auth/server-auth.ts:15-36`.
- `googleProvider` with `prompt: select_account`: `lib/firebase/client.ts:39-40`.
- `AuthProvider` client context: subscribes to `onAuthStateChanged`, calls `ensureProfile` + `ensureBuiltinSkills` on sign-in, exposes `signInGoogle`/`signOutUser`/`getIdToken`: `components/auth/auth-provider.tsx:66-157`.
- Popup-error classification with actionable messages (blocked popup, unauthorized domain, storage-partitioned mobile browsers): `components/auth/auth-provider.tsx:43-64`.
- `AuthGate`: redirects unauthenticated users to `/sign-in`, shows a splash while loading and a "finish configuring" screen when Firebase env vars are absent: `components/auth/auth-gate.tsx:92-103`.
- `/sign-in` page: Google button, graceful "not configured" state, auto-redirect home when already signed in: `app/(auth)/sign-in/page.tsx:32-124`.
- `/api/auth/sync-user`: POST-only, calls `requireUser` then `ensureUserRows`, uid taken solely from the verified token, body values used only as fallbacks: `app/api/auth/sync-user/route.ts:13-30`.

**Strengths:**
1. UID is derived exclusively from the verified Firebase ID token server-side, never from the request body — `lib/auth/server-auth.ts:26-32`, and reinforced in the sync-user route comment `app/api/auth/sync-user/route.ts:11`.
2. Auth uses `Authorization: Bearer` headers (not cookies), so the whole `/api/data/*` surface is inherently CSRF-immune.
3. `adminConfigured`/`firebaseConfigured` booleans let the app degrade to a clean "finish configuring" UI instead of crashing when env vars are missing: `lib/firebase/admin.ts:17`, `lib/firebase/client.ts:15-17`, `components/auth/auth-gate.tsx:100`.
4. Token verification failures are swallowed to `null` rather than throwing/leaking stack traces: `lib/auth/server-auth.ts:33-35`.
5. Private-key literal-`\n` restoration is handled centrally in one place: `lib/firebase/admin.ts:15`.
6. Popup sign-in ignores benign cancellation codes (`popup-closed-by-user`, `cancelled-popup-request`) instead of surfacing an error toast: `components/auth/auth-provider.tsx:39-41,126`.
7. Specific, actionable error copy for the three most common real-world Firebase auth failures (popup blocked, unauthorized domain, storage-partitioned mobile): `components/auth/auth-provider.tsx:48-63`.
8. `AuthGate` never renders protected children before both `loading` is false and `user` is present: `components/auth/auth-gate.tsx:101-102`.
9. Firebase app/auth singletons are memoized via `getApps().length` checks, avoiding duplicate-app errors on HMR: `lib/firebase/client.ts:23-25`, `lib/firebase/admin.ts:24-33`.
10. `jsonError` gives a uniform JSON error shape across the whole API surface: `lib/auth/server-auth.ts:38-43`.
11. Skill seeding on login is fire-and-forget and idempotent-by-slug, so it can't block sign-in or duplicate rows: `components/auth/auth-provider.tsx:95-100`.

**Weaknesses:**
1. `verifyIdToken(token)` is called without the `checkRevoked=true` flag, so a disabled/deleted Firebase user or a revoked refresh token still has any already-issued ID token accepted as valid for up to its natural ~1-hour expiry — `lib/auth/server-auth.ts:26`. There is no admin "kick this user out now" capability anywhere in the app.
2. No token-audience/issuer pinning beyond what `verifyIdToken` does by default, and no check that `decoded.email_verified` is true anywhere before treating the account as real — `lib/auth/server-auth.ts:26-32`. A Google account with an unverified email could still sync a profile.
3. `/api/auth/sync-user` and every `/api/data/*` route call `requireUser`/`verifyRequest` per-request with no caching — every single API call re-verifies the JWT against Firebase (network round-trip via Admin SDK's public-key cache), which is correct for security but has no documented/monitored latency budget; combined with the realtime layer's 10s polling (`lib/data/realtime.ts:60`) across conversations/projects/files/skills/agents/profile, a busy tab issues a large, constant volume of token-verified requests with no batching.
4. There is no rate limiting anywhere on the auth or data API surface (`app/api/auth/**`, `app/api/data/**`) — confirmed no `middleware.ts` exists and the only rate-limit helper in the repo (`lib/ai/rate-limit.ts`) is scoped to the chat/AI routes, not auth or data. `sync-user`, profile PATCH, etc. can be hammered freely by any holder of a valid token.
5. `AuthGate`'s redirect-to-`/sign-in` is client-side only (`useEffect` + `router.replace`) — `components/auth/auth-gate.tsx:96-98`; there is no server-side/middleware enforcement, so any statically-renderable protected page briefly mounts on the server/client before the redirect fires (defense-in-depth gap, not a data leak since data still requires a valid token).
6. `signOutUser` only calls Firebase `signOut` — it does not proactively clear the polling caches in `lib/data/realtime.ts` (`cacheStore`, `listeners`), so a stale user's cached profile/conversalready-fetched data could theoretically flash before a full page reload if the app ever navigated between accounts without a hard reload.
7. No CAPTCHA/anti-automation and no email allowlist/domain restriction on Google sign-in — anyone with a Google account can self-provision an account (may be intended, but worth flagging as it interacts with the unmetered `/api/auth/sync-user` route, item 4).
8. The `ConfigNotice` component enumerates every required Firebase env var name in the client-rendered DOM (`components/auth/auth-gate.tsx:33-40`) — low-severity info disclosure (var *names*, not values) but unnecessary in a production build.
9. No tests exist for `verifyRequest`, `requireUser`, or the sign-in/auth-gate flow (only `tests/tree.test.ts` exists in the whole repo, unrelated to auth).
10. `getIdToken()` in `AuthProvider` doesn't force-refresh (`forceRefresh` param omitted) — `components/auth/auth-provider.tsx:137-140` — so a token nearing expiry could be sent and rejected mid-session, surfacing as a generic 401 to the user rather than a silent refresh.

**Fixes:**
1. Pass `true` for `checkRevoked` in `auth.verifyIdToken(token, true)` at least on sensitive mutations (profile/plan changes, publish), accepting the extra latency.
2. Optionally gate account creation on `decoded.email_verified` in `verifyRequest`/`ensureUserRows`.
3. Add a small in-memory/edge rate limiter (reuse the pattern already built for `lib/ai/rate-limit.ts`) in front of `/api/auth/sync-user` and the mutating `/api/data/*` routes.
4. Add a `middleware.ts` that redirects unauthenticated requests to protected routes before they reach the client bundle, complementing `AuthGate`.
5. Clear `lib/data/realtime.ts`'s `cacheStore`/`listeners` maps on `signOutUser`.
6. Drop the env-var-name enumeration from `ConfigNotice` in production builds (or gate it behind `NODE_ENV !== "production"`).
7. Add unit/integration tests for `verifyRequest` (expired/invalid/missing token cases) and a route-level test harness for at least one `/api/data/*` handler.
8. Call `getIdToken(true)` (force refresh) when a request comes back 401 to auto-retry once before surfacing an error.

---

## Supabase Data Layer & Route Helpers

**What's included:**
- Service-role admin client (bypasses RLS by design), with build-safe fallback values and a `supabaseConfigured` flag: `lib/supabase/server.ts:10-23`.
- Unused anon client kept for "the brief's contract," explicitly documented as inert because RLS has no policies: `lib/supabase/client.ts:1-16`.
- `requireUser`: verifies Supabase is configured, then delegates to `verifyRequest`, returning either the user or a `Response` to short-circuit: `lib/supabase/route-helpers.ts:16-21`.
- `isResponse`, `readJson` (swallow-to-`{}` on bad JSON), `dbError` helpers used by every route: `lib/supabase/route-helpers.ts:23-38`.
- `profile-server.ts`: `loadProfile` (join of `users` + `user_settings`) and `ensureUserRows` (idempotent upsert-on-sign-in of `users`/`user_settings`/`usage`): `lib/supabase/profile-server.ts:7-51`.
- `mappers.ts`: the single translation boundary between camelCase app `*Doc` types and snake_case Postgres rows for conversations, messages, projects, files, skills, agents, checkpoints, build_log, and profile, including timestamp `ms<->iso` conversion and `compact()` to drop `undefined` keys from partial patches: `lib/supabase/mappers.ts:1-559`.
- `storage.ts`: fetch-and-reupload of externally generated images into a public `generated-images` Supabase Storage bucket, unguessable per-user/uuid paths, never throws: `lib/supabase/storage.ts:15-49`.
- `usage.ts`: `deductForgeTokens` (RPC-backed, rolling 5h/weekly/daily windows), `recordChatUsage`, and `incrementUsage` with an RPC-first + manual-read-modify-write fallback for per-feature monthly counters: `lib/supabase/usage.ts:9-165`.
- `supabase/schema.sql`: full DDL — base schema (section 1) plus "Forge OS additions" (section 2: agents, checkpoints, build_log, file_chunks, published, and every incremental column), all migrations written idempotently (`if not exists`), RLS `enable`d on every table with **zero policies** defined anywhere in the file.

**Strengths:**
1. Every `/api/data/*` route funnels through `requireUser`, which itself gates on `supabaseConfigured` before even trying to verify the token — clean fail-closed default: `lib/supabase/route-helpers.ts:16-21`.
2. `compact()` in the mapper layer means partial PATCH bodies only ever touch columns the client explicitly sent, preventing accidental null-outs of untouched fields: `lib/supabase/mappers.ts:51-53`.
3. The anon Supabase key is provably unused anywhere in application code (confirmed via repo-wide search) — RLS-with-no-policies is a correct belt-and-suspenders default even though nothing currently exercises it.
4. `ensureUserRows`/`loadProfile` split identity (`users`) from preferences (`user_settings`) cleanly, and `ensureUserRows` only overwrites `name`/`avatar_url` when explicitly provided (`if (args.name !== undefined)`), so a token refresh with stale display data can't clobber a user's customized profile: `lib/supabase/profile-server.ts:39-40`.
5. `usage.ts` functions are all designed to *never throw* and are explicitly documented as best-effort, so a billing/usage-tracking failure can never break the user-facing chat/build flow: `lib/supabase/usage.ts:8,21-30,37-50`.
6. `incrementUsage` has a defensive fallback path (manual read-modify-write) if the `increment_usage` RPC is missing entirely (e.g., schema migration not yet applied), so the app degrades gracefully rather than losing all usage tracking: `lib/supabase/usage.ts:96-165`.
7. All SQL migrations in `schema.sql` are written to be safely re-runnable (`create table if not exists`, `add column if not exists`), reducing operational risk of running the file against a partially-migrated database.
8. `deduct_forge_tokens` and `increment_usage` RPCs use `select ... for update` row locking before mutating counters, giving real atomicity for concurrent requests from the same user: `supabase/schema.sql:186-193,419-424`.
9. `dbError`/`jsonError` give a consistent error contract (`{error: string}` + status) across the entire API surface, simplifying client-side error handling in `lib/data/authed-fetch.ts:40-45`.
10. Storage image re-upload (`storeImageFromUrl`) uses `randomUUID()` for object keys (cryptographically strong), unlike the app's general-purpose `uid()` helper — `lib/supabase/storage.ts:34`.

**Weaknesses:**
1. **RLS is enabled but has zero policies on every table** (`supabase/schema.sql:167-176,342,357,375,388,398`). This means the *entire* data-access security model rests on every single API route remembering to add `.eq("user_id", uid)` (or `.eq("owner", uid)`) — there is no database-enforced backstop. A single forgotten `.eq()` in any future route is a full cross-tenant data leak with no second layer of defense. (See ownership gaps found in Files/Publish sections below — this is not theoretical.)
2. `firestore.rules` and `storage.rules`/`firebase.json` describe a Firestore-first security model ("every document lives under users/{uid}/…") that no longer matches reality — Firestore is never imported/used anywhere in the app (verified via repo-wide search for `firebase/firestore`, `getFirestore`, `onSnapshot`). This is dead/misleading configuration that could give a false sense of the actual security boundary during review.
3. `supabaseAdmin`/`supabase` (anon) both fall back to placeholder values (`"http://localhost:54321"`, `"service-role-key-not-set"`, `"anon-key-not-set"`) when env vars are absent — `lib/supabase/server.ts:10-12`, `lib/supabase/client.ts:13-14`. `supabaseConfigured` mitigates this for routes that check it, but the raw `supabaseAdmin` client object is still constructed and importable/callable directly by any code that forgets the guard.
4. No column-level or row-level input validation anywhere in the mapper layer — `messageToInsert`/`conversationToInsert`/etc. pass client-supplied strings straight through to Postgres with no length caps (e.g., `content`, `instructions`, `systemPrompt`, `html` in publish). Combined with no request body size limits, this is an unbounded storage-growth / cost vector.
5. `readJson` silently swallows JSON parse errors to `{}` (`lib/supabase/route-helpers.ts:27-33`), which means a malformed request body doesn't fail loudly — for POST/PATCH routes that don't separately validate required fields (most of them), a bad request can silently succeed as a partial/empty write instead of returning a 400.
6. The anon Supabase client (`lib/supabase/client.ts`) is dead code — never imported by any other file in the repo — yet is still bundled and initialized at import time with a fetch to nothing (harmless today only *because* RLS has no policies; if a policy is ever added, this file becomes a live foot-gun since nobody currently reviews it).
7. `usage.ts`'s fallback path (manual read-modify-write when the RPC fails) is explicitly documented as "not perfectly atomic" (`lib/supabase/usage.ts:71-73`) — under concurrent requests (e.g., two parallel image-generation calls) it can under- or over-count monthly usage, which is a quota-bypass surface if usage gates ever key off these fields precisely.
8. No test coverage exists for any Supabase route helper, mapper, or RPC-fallback logic — the entire persistence layer is unverified by automated tests.
9. `messageToInsert` allows a fully client-controlled `role` field (including `"system"`) to be inserted for the user's own messages with no validation — `lib/supabase/mappers.ts:142`; while scoped to the user's own conversation, this could be used to inject fabricated "system" turns into exported/replayed transcripts.
10. `getAdminStorage`/Firebase Storage admin access exists (`lib/firebase/admin.ts:42-45`) but no server route ever uses it to enforce storage quotas or validate uploads server-side — all storage writes happen client-side directly to Firebase Storage (see Files section), so the admin SDK's storage capability is unused for any governance purpose.

**Fixes:**
1. Add real RLS policies (even simple `user_id = auth.jwt() ->> 'sub'`-style checks are not directly usable since auth is Firebase not Supabase Auth, but at minimum add `USING (false)` / explicit deny-by-default comments, or migrate identity so Supabase-native RLS can be layered in) as defense-in-depth, or at minimum add an automated test that asserts every `/api/data/*` route includes a `user_id`/`owner` filter.
2. Delete or clearly mark `firestore.rules`/`storage.rules`(Firestore portion)/`firebase.json`'s Firestore section as vestigial, or remove them entirely if Firestore is never coming back, so reviewers aren't misled about the actual security boundary.
3. Make `supabaseAdmin` construction lazy (only build the client inside functions that already check `supabaseConfigured`), removing the placeholder-credential foot-gun.
4. Add server-side length/size validation in the mapper or route layer for free-text fields (`content`, `html`, `instructions`, `systemPrompt`) with sensible caps.
5. Change `readJson` to return a discriminated result (ok/error) so routes can 400 on genuinely malformed bodies instead of silently treating them as `{}`.
6. Delete the unused `lib/supabase/client.ts` (or add a code comment + lint rule preventing its import) until/unless a real RLS-policied use case exists.
7. Document the non-atomicity of the usage fallback path prominently and consider making the RPC failure loud (alerting) rather than silently falling back, since silent fallback both here and for quota enforcement means quota bypass failures are invisible operationally.
8. Add unit tests for at least `rowToMessage/messageToInsert`, `rowsToProfile/profilePatchToRows`, and one RPC-fallback scenario.
9. Whitelist/validate the `role` field server-side to the expected set for user-submitted messages.

---

## Conversations & Messages (branching persistence)

**What's included:**
- `GET/POST /api/data/conversations`: list (ordered by `updated_at desc`) and create, both scoped to `user_id`: `app/api/data/conversations/route.ts:9-30`.
- `GET/PATCH/DELETE /api/data/conversations/[id]`: single-conversation CRUD, all three verbs filter `.eq("user_id", user.uid).eq("id", id)`: `app/api/data/conversations/[id]/route.ts:11-53`.
- `GET/POST /api/data/conversations/[id]/messages`: list messages for a conversation / append one: `app/api/data/conversations/[id]/messages/route.ts:11-35`.
- `PATCH /api/data/messages/[id]`: patch a single message, scoped by `user_id`+`id`: `app/api/data/messages/[id]/route.ts:11-25`.
- Client wrapper `lib/data/chat.ts`: `createConversation`, `subscribeConversations`/`subscribeConversation` (polling), `updateConversation`, `deleteConversation`, `addMessage`, `updateMessage`, `subscribeMessages`, `getMessagesOnce` — all optimistically update the `realtime.ts` cache so the UI never waits on a refetch: `lib/data/chat.ts:13-138`.
- Message-tree utilities (branching): `buildActivePath` (walks parent pointers from `activeLeafId`, or falls back to most-recent-child traversal), `leafOf`, `siblingsOf`: `lib/data/tree.ts:15-86`. Covered by `tests/tree.test.ts`.
- `messages.parent_id` FK is `ON DELETE SET NULL`, `messages.conversation_id` FK is `ON DELETE CASCADE`: `supabase/schema.sql:95,84`.

**Strengths:**
1. All four conversation CRUD verbs consistently double-filter on `user_id` **and** `id`, so no route relies on `id` uniqueness alone for authorization: `app/api/data/conversations/[id]/route.ts:18-19,34-35,49-50`.
2. Message tree logic is pure, well-factored, and the only code in the whole audited scope with actual unit test coverage (`tests/tree.test.ts`, 8 passing cases covering empty state, linear paths, branch selection via `activeLeafId`, sibling counts, and default-to-most-recent-child).
3. `realtime.ts`'s epoch-guarded `setCache`/polling design (`lib/data/realtime.ts:19-25,74-89`) correctly prevents a stale in-flight fetch from clobbering a just-written optimistic update — a subtle race that's explicitly reasoned about in code comments.
4. Deleting a conversation server-side relies on the DB's `ON DELETE CASCADE` for messages rather than a fragile two-step client-orchestrated delete: `app/api/data/conversations/[id]/route.ts:45`.
5. `addMessage`/`updateMessage` immediately patch the local message cache (`setCache`) so the sending user sees their message with zero network round-trip lag, while `invalidate(convListKey(uid))` still keeps the sidebar's ordering fresh: `lib/data/chat.ts:100-104`.
6. Conversation list is server-sorted by `updated_at desc`, avoiding client-side sort bugs/inconsistency across devices: `app/api/data/conversations/route.ts:16`.
7. `messagePatchToUpdate`/`conversationPatchToUpdate` only set columns present in the partial input (`"x" in p` checks), so a `PATCH {content}` can never accidentally null out `reasoning`, `tokens`, etc.: `lib/supabase/mappers.ts:166-185,91-103`.
8. `buildActivePath`'s fallback (no `activeLeafId`) deterministically follows the most-recently-created child at each level, giving predictable behavior for legacy conversations created before branching existed: `lib/data/tree.ts:39-47`.
9. Empty-messages/empty-activeLeafId edge cases are explicitly handled (`if (messages.length === 0) return []`): `lib/data/tree.ts:19`.
10. `readJson` + `Object.keys(update).length` guard means a no-op PATCH body doesn't generate a wasted UPDATE statement: `app/api/data/conversations/[id]/route.ts:29-30`, `app/api/data/messages/[id]/route.ts:15-16`.

**Weaknesses:**
1. **`POST /api/data/conversations/[id]/messages` never verifies that the `conversationId` path param actually belongs to `user.uid` before inserting** — `app/api/data/conversations/[id]/messages/route.ts:25-34`. The insert sets `user_id: user.uid` correctly, but `conversation_id: conversationId` is taken verbatim from the URL with zero ownership check against the `conversations` table. Any authenticated user can attach a row referencing another user's `conversation_id`. It isn't directly readable back by the victim (their own `GET` still filters by `user_id`), but it: (a) silently succeeds where it should 403/404, (b) pollutes referential integrity (a message with `user_id=A` pointing at `conversation_id` owned by `B`), and (c) means if `B` later deletes that conversation, `A`'s message is silently cascade-deleted by `B`'s action (`ON DELETE CASCADE` on `messages.conversation_id`, `supabase/schema.sql:84`) — a cross-user side effect with no error surfaced to `A`.
2. Same missing-parent-ownership pattern appears for `conversationId` alone with no existence check either — a `POST` to a conversation id that doesn't exist at all (typo, deleted conversation) still "succeeds" and creates an orphaned message row instead of 404ing.
3. `GET /api/data/conversations/[id]` returns `Response.json(null)` (200 status) for both "not found" and "not yours" — `app/api/data/conversations/[id]/route.ts:21-22` — the client can't distinguish the two cases, and more importantly a 200-with-null gives no signal to log/alert on repeated cross-user probing attempts.
4. Message and conversation `id`s are entirely client-generated via `genId()`/`uid()` (`Math.random()`+timestamp, **not** cryptographically random — see `lib/utils.ts:10-12`) and are the Postgres primary key with **global** (not per-user) uniqueness (`conversations.id text primary key`, `messages.id text primary key` — `supabase/schema.sql:70,82`). A collision between two different users' client-generated ids (low but non-zero probability given `Math.random()`) causes a hard insert failure for whichever request lands second, with no dedup/retry logic in `createConversation`/`addMessage`.
5. No maximum message/conversation count enforcced per user anywhere — a user (or buggy client loop) can create unbounded conversations/messages with no quota check server-side (contrast with checkpoints, which does cap at `MAX_CHECKPOINTS = 30`).
6. No content length limit on `MessageDoc.content`/`reasoning` at the API layer — a pathological client could insert an arbitrarily large message body.
7. `updateMessage`/`PATCH /api/data/messages/[id]` has no equivalent check that the message being patched belongs to a conversation the user still owns (though it does correctly check `user_id` on the message row itself, so this is lower-severity than #1 — flagged only because the pattern of "trust the id, filter only on user_id" is systemic).
8. The 10-second default polling interval (`lib/data/realtime.ts:60`) applies to `subscribeMessages`/`subscribeConversations` too — an active conversation being viewed on two tabs/devices can show up to 10s of staleness for anything not covered by the optimistic `setCache` path (e.g., edits made from a different device).
9. There is no soft-delete/audit trail for conversations or messages — `DELETE` is a hard, immediate, unrecoverable Postgres delete with cascade, with no confirmation step enforced server-side (the API trusts whatever the client sends).
10. No tests exist for any of the conversations/messages API routes themselves (only the pure `tree.ts` helper functions are tested) — the ownership-check gap in weakness #1 would have been easy to catch with a route-level authorization test.

**Fixes:**
1. Before inserting a message, `SELECT id FROM conversations WHERE id = :conversationId AND user_id = :uid` and return 404 if no row is found — mirror the existing single-resource-ownership pattern already used everywhere else in this codebase.
2. Return proper 404 status (not `200 {null}`) from `GET /api/data/conversations/[id]` when no matching row exists, and consider a distinct log/metric for "requested id exists but belongs to another user" to detect probing.
3. Switch `genId`/`uid()` to `crypto.randomUUID()` (already a dependency via Node/browser APIs, and already used correctly in `lib/supabase/storage.ts:34`) for all persisted entity ids.
4. Add a soft per-user cap (e.g., configurable, mirroring `MAX_CHECKPOINTS`) on conversations/messages to bound storage growth, and a max length check on `content`/`reasoning`.
5. Add integration tests exercising the API routes directly (e.g., via a test Supabase instance or mocked `supabaseAdmin`) asserting that user A cannot write into user B's conversation.

---

## Projects & File System (CRUD, bulk ops, binary/chunk fallback)

**What's included:**
- `GET/POST /api/data/projects`: list + create-with-optional-initial-files, both `user_id`-scoped: `app/api/data/projects/route.ts:9-39`.
- `GET/PATCH/DELETE /api/data/projects/[id]`: single-project CRUD; `DELETE` explicitly deletes the project's files first (since `files.project_id` is `ON DELETE SET NULL`, not cascade) before deleting the project row: `app/api/data/projects/[id]/route.ts:41-55`.
- `GET /api/data/projects/[id]/files`: list a project's files, double-scoped by `user_id`+`project_id`: `app/api/data/projects/[id]/files/route.ts:10-21`.
- `POST /api/data/files`, `GET/PATCH/DELETE /api/data/files/[id]`, `POST /api/data/files/bulk` (batched insert/update/delete — used for folder rename/move/delete cascades and AI build writes): `app/api/data/files/route.ts`, `app/api/data/files/[id]/route.ts`, `app/api/data/files/bulk/route.ts`.
- `GET/POST/DELETE /api/data/files/chunks`: base64 blob-chunk fallback storage in the `file_chunks` table, scoped by `user_id`+`file_id`: `app/api/data/files/chunks/route.ts:11-63`.
- `lib/files/filestore.ts`: `FileStore.put/getUrl/remove` — primary backend Firebase Storage (`users/{uid}/files/{fileId}`), falls back to base64 chunks in Supabase if Storage upload throws: `lib/files/filestore.ts:38-94`.
- `lib/data/files.ts`: client CRUD/tree helpers — `createNode`, `updateContent`, `renameNode`/`moveNode` (with folder-descendant cascade path-rewriting), `deleteNode`, `duplicateNode`, `writeFilesByPath` (AI-build batched writer, with a 900KB per-file inline-content guard): `lib/data/files.ts:43-277`.
- Storage/Firestore security rules for the blob path: `storage.rules:6-9` (`users/{uid}/{allPaths=**}`).

**Strengths:**
1. Every files/projects route consistently double-filters `user_id` + resource `id` (or `project_id`), matching the pattern established in conversations — `app/api/data/files/[id]/route.ts:18-19,34-35,48-49`, `app/api/data/projects/[id]/route.ts:18-19,34-35,50-52`.
2. `writeFilesByPath` enforces a hard 900KB per-file inline-content cap client-side with a clear error message telling the caller to use Storage/`fetch()` for large data instead: `lib/data/files.ts:224-230`.
3. `moveNode` explicitly guards against moving a folder into itself or one of its own descendants (`newParent.path.startsWith(node.path + "/")`), preventing a corrupt cyclic tree: `lib/data/files.ts:121-122`.
4. `renameNode`/`moveNode` correctly cascade path rewrites to all descendants of a renamed/moved folder in one batched `/files/bulk` call rather than N individual requests: `lib/data/files.ts:100-111,136-145`.
5. `DELETE /api/data/projects/[id]` correctly handles the `ON DELETE SET NULL` vs `ON DELETE CASCADE` distinction — deleting a project's files explicitly before deleting the project itself, with checkpoints/build_log left to their own `ON DELETE CASCADE` FKs: `app/api/data/projects/[id]/route.ts:46-53`.
6. Storage rules correctly mirror the exact path shape the client actually writes to (`users/${uid}/files/${fileId}` vs. rule `users/{uid}/{allPaths=**}`) — one of the few places where a security rule is verified to match real usage: `lib/files/filestore.ts:43`, `storage.rules:7-8`.
7. `FileStore.put` never throws on a Storage failure — it transparently falls through to the Supabase chunk fallback, so a Firebase Storage outage degrades rather than breaks uploads (in principle — see weaknesses on reachability): `lib/files/filestore.ts:41-50`.
8. Bulk file mutations correctly stop and surface the first error encountered rather than silently continuing after a partial failure: `app/api/data/files/bulk/route.ts:28,40`.
9. `detectLang`-derived `category`/`language`/`mime` metadata is recomputed on rename (not just create), keeping syntax highlighting/preview correct after a file extension change: `lib/data/files.ts:95-98`.
10. `duplicateNode` correctly refuses to duplicate folders (`if (node.kind !== "file") return`), avoiding an easy way to accidentally create a broken partial-subtree copy: `lib/data/files.ts:160`.

**Weaknesses:**
1. **`POST /api/data/files` and `POST /api/data/files/bulk` never verify that a supplied `projectId`/`parentId` actually belongs to the requesting user** — `app/api/data/files/route.ts:9-16`, `app/api/data/files/bulk/route.ts:19-29`. Same class of gap as the conversations/messages issue: a file can be inserted referencing another user's `project_id` (FK only requires the project to *exist*, not to be owned by the inserting user). It won't be visible to the victim's own `GET /api/data/projects/[id]/files` (filtered by `user_id`), but the victim deleting their project will delete their own files (fine) while the attacker's rogue file, still pointing at the now-nonexistent project via `ON DELETE SET NULL`, becomes an untethered orphan row that nothing ever cleans up.
2. **The primary binary/blob upload path (`FileStore.put`) is never called anywhere in the codebase** (verified: zero matches for `FileStore.put(` outside its own definition). The only file-import code path, `components/code/file-tree.tsx:158` (`const text = await f.text()`), reads every dropped file as UTF-8 text and calls `createNode` with that text as inline `content` — meaning any real binary file (image, zip, font, etc.) dropped into the IDE is silently corrupted through forced UTF-8 decoding, and never reaches Firebase Storage or the chunk fallback. `BinaryViewer` (`components/code/binary-viewer.tsx:20-29`) — the only consumer of `FileStore.getUrl` — is consequently unreachable dead code in practice, since `storagePath`/`chunked` are never set by any writer.
3. No server-side size validation on file `content` for `POST /api/data/files` / `/files/bulk` / `PATCH /api/data/files/[id]` — the 900KB cap in `writeFilesByPath` (`lib/data/files.ts:226`) is a client-side-only guard bypassable by calling the API directly; the plain `createNode`/`updateContent` paths (used by the IDE editor itself) enforce no cap at all.
4. `file_chunks` POST has no limit on chunk count or total size (`app/api/data/files/chunks/route.ts:27-49`) — combined with weakness #3, there is no server-enforced per-user storage quota anywhere in the file system, despite a `usage` table existing that tracks *other* feature usage (images/vision/searches/documents) but not storage bytes.
5. `moveNode`'s self/descendant-cycle guard (`lib/data/files.ts:121-122`) is client-side only — the `/api/data/files/bulk` PATCH path has no equivalent server-side check, so a client that skips `moveNode` (e.g., a future feature, a bug, or a direct API call) could create a cyclic `parentId` chain that would infinite-loop any tree-walking code.
6. File ids (`genId("file")`/`genId("folder")`) share the same weak `Math.random()`-based generator as conversations/messages (`lib/utils.ts:10-12`) and are globally-unique Postgres primary keys — same collision/predictability concern as flagged in Conversations & Messages.
7. `PATCH /api/data/files/[id]` accepts and blindly applies whatever is in `filePatchToUpdate` including `projectId`/`parentId` reassignment (`lib/supabase/mappers.ts:291-293`) with no check that the new `projectId`/`parentId` target belongs to the same user — a file could be "moved" via direct API call into another user's project namespace.
8. No confirmation/soft-delete for `deleteNode`/bulk deletes — deletion (including recursive folder deletion computed client-side via `descendants()`) is immediate and irreversible, and the "descendants" list is computed from a client-fetched snapshot (`getProjectFilesOnce`) that could be stale by the time the bulk-delete request lands, silently leaving newly-created files under a deleted folder orphaned (parent gone, entry remains, not cleaned up since `parent_id` is `ON DELETE CASCADE` — actually the child *would* cascade-delete correctly at the DB level since `files.parent_id references files(id) on delete cascade`, `supabase/schema.sql:118` — but only for files that existed as children *in the DB* at delete time, not ones inserted concurrently between the client's snapshot read and the bulk delete request).
9. No tests exist for any file/project route or for `lib/data/files.ts`'s tree-manipulation helpers (`renameNode`, `moveNode`, `writeFilesByPath`, `descendants`) despite this being some of the most structurally complex logic in the audited scope.
10. `getFileOnce`/`GET /api/data/files/[id]` returns file `content` inline in the JSON response with no distinction/redaction for large content — fetching a single file's metadata always pulls its (potentially large, up-to-900KB) text body too.

**Fixes:**
1. Before any insert/update that sets `project_id` or `parent_id`, verify the target row exists **and** belongs to `user.uid` (a single extra `SELECT ... WHERE id = X AND user_id = :uid` per foreign key referenced), returning 403/404 otherwise — apply uniformly across `files`, `files/bulk`, and (per the Conversations section) `messages`.
2. Either wire real binary uploads into the file-drop flow (`file-tree.tsx` should route non-text/binary `File` objects to `FileStore.put` instead of `f.text()`, detecting binary via MIME type or a text-decode failure) or remove the dead `FileStore`/`BinaryViewer` code paths and document that inline text is the only supported storage model today.
3. Enforce the 900KB (or a chosen) content-size cap server-side in the mapper/route layer, not just in `writeFilesByPath`.
4. Add a per-user aggregate storage-size check (sum of `files.size` + `file_chunks` bytes) against a quota before accepting new content, and track it in the existing `usage` table.
5. Add a server-side cycle check (walk `parent_id` before applying a move) or switch to a materialized-path/closure-table model that makes cycles structurally impossible.
6. Move to `crypto.randomUUID()` for all generated ids.
7. Restrict `filePatchToUpdate`'s allowed fields for cross-tenant-sensitive columns (`projectId`, `parentId`) to require the same ownership check as #1.
8. Consider re-deriving the descendants list server-side (from the DB, at delete time) rather than trusting a client-supplied stale snapshot, closing the race in weakness #8.

---

## Skills & Agents Persistence

**What's included:**
- `GET/POST /api/data/skills`, `PATCH/DELETE /api/data/skills/[id]`: standard `user_id`-scoped CRUD: `app/api/data/skills/route.ts`, `app/api/data/skills/[id]/route.ts`.
- `GET/POST /api/data/agents`, `PATCH/DELETE /api/data/agents/[id]`: same pattern: `app/api/data/agents/route.ts`, `app/api/data/agents/[id]/route.ts`.
- `lib/data/skills.ts`: slug generation/uniqueness (`slugify`, `uniqueSlug`), CRUD wrappers, `ensureBuiltinSkills` (idempotent-by-slug seeding), import/export as JSON: `lib/data/skills.ts:11-214`.
- `lib/data/agents.ts`: CRUD wrappers, duplicate/import/export as JSON: `lib/data/agents.ts:10-143`.

**Strengths:**
1. Skills and agents both consistently apply the `user_id`+`id` double filter on every mutating route, matching the rest of the codebase's (mostly correct) pattern: `app/api/data/skills/[id]/route.ts:20-21,34-35`, `app/api/data/agents/[id]/route.ts:20-21,34-35`.
2. `uniqueSlug` correctly excludes the item being updated from its own collision check via `ignoreId`, so renaming a skill back to a name close to its own slug doesn't spuriously bump the suffix: `lib/data/skills.ts:26-33,87`.
3. `ensureBuiltinSkills` is idempotent by slug and explicitly documented to never touch a user's existing enabled/disabled state: `components/auth/auth-provider.tsx:95-97`, `lib/data/skills.ts:142-166`.
4. Skill `version` auto-increments on update unless explicitly provided, giving cheap optimistic-concurrency/history tracking: `lib/data/skills.ts:88-91`.
5. `importSkills`/`importAgents` validate the minimum required fields (`name`+`instructions`/`systemPrompt`) before creating anything, skipping malformed entries rather than crashing the whole import: `lib/data/skills.ts:199-212`, `lib/data/agents.ts:127-141`.
6. `exportSkill`/`exportAgent` deliberately whitelist only presentational/behavioral fields for export (not internal ids/timestamps), producing clean, re-importable JSON: `lib/data/skills.ts:168-182`, `lib/data/agents.ts:95-110`.
7. `duplicateAgent`/`duplicateSkill` correctly fetch the full source object first and explicitly reject if not found (`throw new Error("Agent not found")`) rather than silently creating a blank duplicate: `lib/data/agents.ts:77-79`, `lib/data/skills.ts:101-104`.

**Weaknesses:**
1. `PATCH /api/data/agents/[id]` and `/skills/[id]` accept fully client-controlled `enabled`/`builtin` flags with no server-side check preventing a user from flipping `builtin: true` on their own custom agent/skill — cosmetic risk only (no separate privilege tied to `builtin` server-side that was found), but worth confirming `builtin` isn't used anywhere as a trust signal.
2. `importSkills`/`importAgents` (`JSON.parse(json)`) have no size limit on the imported payload or on individual `instructions`/`systemPrompt` string length, and no cap on how many skills/agents a single import can create in one loop — a large pasted JSON blob could create hundreds of rows in one client-side loop with no server-side backpressure.
3. No uniqueness/collision handling for agent names/slugs the way skills have `uniqueSlug` — two agents can silently share the exact same name with no disambiguation.
4. `uniqueSlug` calls `listSkills()` (a full `GET /api/data/skills` round-trip) on every single create/update — for a user with many skills this is an O(n) full-table refetch per write instead of a targeted existence check.
5. No ownership check that a `defaultProjectId` set on an `AgentDoc` belongs to the same user (mirrors the same missing-FK-ownership-check pattern seen in Files/Conversations): `app/api/data/agents/route.ts:21-28`.
6. `duplicateSkill`/`duplicateAgent` re-fetch the *entire* skill/agent list client-side just to find one by id (`(await listSkills()).find(...)`), an unnecessary O(n) fetch instead of a direct `GET /api/data/skills/[id]` (which doesn't even exist as a route — only `PATCH`/`DELETE` are defined for `/skills/[id]`, no `GET`).
7. No tests for slug uniqueness, import/export round-tripping, or the agents/skills API routes.

**Fixes:**
1. If `builtin` is ever used as a trust/permission signal anywhere, strip it from client-writable PATCH fields; otherwise document it's purely cosmetic.
2. Add a max-entries-per-import cap and per-field length limits to `importSkills`/`importAgents`.
3. Add agent name uniqueness (or at least a "(2)" suffix pattern like skills already have).
4. Add a single-item `GET /api/data/skills/[id]` route and have `uniqueSlug`/`duplicateSkill` use targeted lookups instead of full-list refetches.
5. Validate `defaultProjectId` ownership before accepting an agent create/update.

---

## Usage Tracking & Profile

**What's included:**
- `GET /api/data/usage`: returns plan + full usage snapshot (5h/weekly/daily forge-token windows, monthly per-feature counters), all camelCase/ms-converted: `app/api/data/usage/route.ts:9-60`.
- `GET/PATCH /api/data/profile`: load merged profile, patch splits across `users`/`user_settings` tables via `profilePatchToRows`: `app/api/data/profile/route.ts:10-36`.
- `lib/data/usage.ts`: thin `fetchUsage()` wrapper.
- `lib/data/profile.ts`: `defaultProfile` (client-side fallback shape), `ensureProfile` (calls `/api/auth/sync-user`), `subscribeProfile` (polling), `updateProfile`.

**Strengths:**
1. `GET /api/data/usage` correctly derives `plan` from the server-verified user's own row, never from client input: `app/api/data/usage/route.ts:33-38`.
2. `profilePatchToRows` cleanly separates identity fields (`users`) from preference fields (`user_settings`), and the route only issues an `UPDATE`/`upsert` for whichever half of the patch actually has keys: `app/api/data/profile/route.ts:24-33`.
3. The settings-row `upsert` (not plain `update`) correctly handles the case where `user_settings` doesn't exist yet for an early-lifecycle account: `app/api/data/profile/route.ts:31-33`.
4. `EMPTY` usage snapshot constant gives new/no-row users a well-typed zeroed response instead of `null`/undefined fields: `app/api/data/usage/route.ts:9-24`.
5. Timestamps are consistently converted at the boundary (`isoToMs`/`tsOrNull`) so the client never has to deal with ISO strings: `app/api/data/usage/route.ts:26,41-54`.

**Weaknesses:**
1. **`PATCH /api/data/profile` lets a user set their own `users.email` column to an arbitrary string with no validation against the Firebase-verified token's actual email** — `app/api/data/profile/route.ts:16-21` → `profilePatchToRows` → `lib/supabase/mappers.ts:539`. Since `users.email` has a `unique not null` constraint (`supabase/schema.sql:23`), a user could set their own row's email to a value that later collides with a legitimate new user's real email during `ensureUserRows`'s upsert (`onConflict: "id"`, not `email`), causing that other user's account provisioning to fail with a unique-constraint violation — an account-creation DoS against a specific victim email, or at minimum a way to display a spoofed email in the UI/export.
2. `plan` (billing tier) is *not* client-writable via this route (confirmed: absent from `profilePatchToRows`), which is good, but it's worth noting there's no positive test asserting this — a future refactor of `profilePatchToRows` could accidentally add it.
3. No server-side validation of `defaultModel`/`defaultEffort` against the actual allowed enum values before writing — `profilePatchToRows` passes them straight through; an invalid value would silently persist and could break UI rendering elsewhere expecting one of a known set.
4. `PATCH /api/data/profile`'s body is parsed with a bare `req.json().catch(() => ({}))` (`app/api/data/profile/route.ts:20`) — a malformed body silently becomes a no-op patch rather than a 400, matching the systemic `readJson`-swallowing pattern flagged elsewhere.
5. No rate limiting on profile PATCH — a client could spam identity-field changes (e.g., toggling `email` rapidly) with no throttling.
6. No audit trail of profile changes (e.g., email history) — if the email-spoofing issue in weakness #1 is exploited, there's no record of the prior value.

**Fixes:**
1. Either reject client-supplied `email` changes entirely (email should only ever be set from the verified Firebase token, e.g., in `ensureUserRows`) or, if user-settable email is a real product requirement, verify uniqueness proactively and return a friendly 409 instead of letting the DB constraint fail unpredictably at a future unrelated user's signup time.
2. Add an explicit test that `plan` cannot be set via `PATCH /api/data/profile`.
3. Validate `defaultModel`/`defaultEffort` against the known enum (`ForgeModelId`/`EffortId`) server-side before writing.
4. Make `readJson`/manual `req.json().catch()` patterns 400 on invalid JSON rather than silently defaulting to `{}`.

---

## Data Export ("download all my data")

**What's included:**
- `GET /api/data/export`: parallel-fetches conversations, messages, files, projects, skills (all `user_id`-scoped) plus profile, and assembles a single JSON payload grouping messages under their parent conversation: `app/api/data/export/route.ts:18-56`.
- `lib/export.ts`: `conversationToMarkdown`/`exportConversationMarkdown` (single-conversation → branded Markdown download) and `exportAllData` (fetches the export payload, builds a `.zip` via JSZip with `conversations/*.md`+`*.json`, `files/*` real contents + `_files.json` metadata, `projects.json`, `skills.json`, `profile.json`, `memory.txt`).

**Strengths:**
1. The export route reuses the exact same `rowTo*` mappers as every live route, guaranteeing the exported JSON shape matches what the app actually reads/writes (no separate, divergent export-only serialization to maintain).
2. All five underlying queries are correctly `user_id`-scoped and run in parallel via `Promise.all`, keeping the endpoint fast despite touching five tables: `app/api/data/export/route.ts:23-29`.
3. `safeName()` sanitizes conversation titles/filenames before use as zip entry paths, preventing path-traversal-style characters (`/`, `..`, etc.) from escaping into unexpected zip paths: `lib/export.ts:14-16`.
4. The single-error-check pattern (`firstErr = convs.error || msgs.error || ...`) correctly fails the whole export atomically rather than returning a partial/inconsistent bundle silently: `app/api/data/export/route.ts:31-32`.
5. Markdown export optionally includes assistant "thinking"/reasoning content behind an explicit `includeThinking` flag, and wraps it in a collapsible `<details>` block rather than always exposing it: `lib/export.ts:46-47`.
6. File export writes real file contents (not just metadata) for every file with inline `content`, giving users a genuinely complete, useful backup rather than a metadata-only stub: `lib/export.ts:88-93`.

**Weaknesses:**
1. `GET /api/data/export` has no pagination/streaming — a user with a very large history (many conversations/messages/files) gets everything loaded into memory and serialized in one `Response.json(...)` call, which could time out or OOM the serverless function for power users; there's no size-based warning or chunked/streaming export.
2. Files with binary content stored via `storagePath`/`chunked` (the Firebase Storage / chunk-fallback path) are **not included in the export at all** — `lib/export.ts:88-93` only checks `typeof fd.content === "string"`, meaning any file that went through the (largely dead, per the Files section) blob path would silently be missing its actual content in the exported zip, appearing only in `_files.json` metadata. (This compounds weakness #2 in the Files section, since the binary path was dead anyway.)
3. Agents (`agents` table) are entirely absent from both the export API response and the zip contents — a user's custom agents are not included in "download all my data" despite being clearly user-authored, persisted data.
4. Checkpoints and build-log history (excluded from this audit's route scope, but reachable via `lib/data/checkpoints.ts`/`build-chat.ts`) also appear absent from the export payload — a project's version history isn't exportable.
5. No content-type/size limit on the resulting zip — `exportAllData` happily attempts to build and hold an arbitrarily large blob in browser memory via `zip.generateAsync({ type: "blob" })`, which could hang or crash the tab for a large account.
6. No rate limiting on `/api/data/export` — since it touches five tables in parallel, it's a comparatively expensive endpoint that could be called repeatedly with no throttling.
7. The export markdown/JSON includes `reasoning`/`thinking` content and full message history with no redaction step — reasonable for a personal data export, but worth noting there's no confirmation dialog surfaced anywhere in the reviewed code before triggering (UI layer is outside this audit's file list, noted for completeness).

**Fixes:**
1. Add pagination or a background-job + download-link pattern for large accounts instead of one synchronous in-memory response.
2. Include `agents` (and, coordinating with the other audit covering checkpoints/build_log, that history) in both the API response and the zip.
3. For files using `storagePath`/`chunked`, fetch the actual blob (via `FileStore.getUrl`-equivalent server-side, or a presigned URL) and include real bytes in the export zip rather than silently omitting them — moot until the binary-storage dead-code issue is fixed, but should be fixed together.
4. Add a size guard/warning threshold before attempting `zip.generateAsync` client-side.

---

## Artifact Publishing (`/p/[id]`)

**What's included:**
- `POST /api/data/publish`: upserts `{id, owner, name, html, at}` into the public `published` table (`onConflict: "id"`), then best-effort updates the source project's `published` metadata field: `app/api/data/publish/route.ts:9-33`.
- `GET /api/api/published/[id]` (public, unauthenticated): reads `name, html` by `id` only, explicitly documented as safe because it goes through the service-role client while RLS stays locked: `app/api/published/[id]/route.ts:10-20`.
- `app/p/[id]/page.tsx`: client page that fetches `/api/published/[id]` and renders the stored `html` inside a **sandboxed iframe without `allow-same-origin`**, with a storage shim injected first so client-side code that touches `localStorage`/`sessionStorage` doesn't crash on the resulting opaque origin: `app/p/[id]/page.tsx:63-69`, `lib/code/sandbox-shim.ts:1-40`.
- `lib/code/export.ts`: `publishProject` — assembles the static HTML client-side (`assembleWeb`/`bundleApp` depending on preview mode), reuses the project's existing `published.id` on republish or generates a new one via `genId("pub")`, and POSTs the fully-rendered HTML to the publish route: `lib/code/export.ts:40-59`.
- `published` table: `id text primary key, owner text references users(id) on delete cascade, name, html, at`, RLS enabled with no policies: `supabase/schema.sql:391-398`.

**Strengths:**
1. The public read route (`/api/published/[id]`) only ever selects `name, html` — never `owner` or any other internal field — so the public API surface can't be used to enumerate ownership/user ids: `app/api/published/[id]/route.ts:15`.
2. The preview iframe is deliberately built **without** `allow-same-origin` in its sandbox attribute, giving arbitrary published/user-authored HTML an opaque origin that cannot reach the parent app's cookies, Firebase session, or DOM — a well-reasoned, explicitly-commented security design: `app/p/[id]/page.tsx:67`, `lib/code/sandbox-shim.ts:1-3`.
3. The storage shim is injected defensively (probe-then-fallback) so the opaque-origin security property is never silently broken just to make `localStorage`-using published apps work: `lib/code/sandbox-shim.ts:11-20`.
4. The published `name`/state UI in `app/p/[id]/page.tsx:47` renders via plain JSX interpolation (not `dangerouslySetInnerHTML`), so the project *name* can't be used for a DOM-based XSS on the wrapper chrome even though the `html` payload itself is intentionally rendered as raw HTML inside the sandboxed iframe.
5. `published.owner` has an `ON DELETE CASCADE` FK to `users(id)` (`supabase/schema.sql:393`), so deleting a user account correctly cleans up their published pages rather than leaving dangling public content.
6. Updating the source project's `published` metadata field is deliberately scoped by `.eq("user_id", user.uid).eq("id", projectId)` (`app/api/data/publish/route.ts:29-30`) — even though (see weaknesses) the core publish action isn't gated on project ownership, this particular side-effect at least can't corrupt another user's project row.

**Weaknesses:**
1. **`POST /api/data/publish` never verifies that `projectId` belongs to `user.uid`, and — more seriously — never verifies ownership of an *existing* `published` row before overwriting it.** `app/api/data/publish/route.ts:9-33` does `supabaseAdmin.from("published").upsert({id, owner: user.uid, ...}, {onConflict: "id"})` with **no prior check that any pre-existing row with that same `id` is already owned by someone else.** Any authenticated user who submits a request with an `id` matching another user's already-published page will **silently overwrite that page's `html`, `name`, and `owner`** — a full published-content takeover with no error, no ownership check, and no audit trail. The `id` is normally client-generated (`genId("pub")`, `lib/code/export.ts:51`), and while a legitimate client always reuses only its own project's previously-returned id, nothing stops a direct API call from targeting an arbitrary/guessed id.
2. Compounding #1: `genId`/`uid()` ids are **not cryptographically random** (`Math.random()` + timestamp, `lib/utils.ts:10-12`) — the entropy is low enough that combined with no rate limiting on `/api/data/publish`, a brute-force/guessing attack against known-recent-timestamp ids is more feasible than it would be with a proper UUID.
3. There is **no unpublish/revoke endpoint anywhere** — grepped the full repo for any DELETE handler touching the `published` table or an "unpublish" route and found none. Once a project is published, the owner has no way to take the public link down again short of a direct database operation; if sensitive content is accidentally published, it stays live indefinitely.
4. The publish route trusts a fully client-assembled `html` string with **no size limit and no content validation** — the actual project files are never independently re-fetched/re-rendered server-side; whatever the browser sends becomes the public page verbatim. Combined with no rate limiting, this is an open (to any authenticated user) unbounded-size public-content-hosting endpoint.
5. `/api/published/[id]` (the public read route) has no caching headers set at all — every visit to a published page re-queries Postgres directly with the service-role client, with no CDN/edge caching, meaning a popular published page's read load falls entirely on the primary database.
6. No rate limiting on either the publish (write) or published-read (public, unauthenticated) endpoints — the public read endpoint in particular is an **unauthenticated** surface that can be hit at unlimited volume by anyone with (or guessing) an id.
7. The republish flow reuses `project.published?.id` client-side (`lib/code/export.ts:51`) — if that client-held value is ever stale/tampered (e.g., a user manually edits browser state or replays an old request), the same ownership-bypass in weakness #1 applies.
8. No content-security-policy/sanitization is applied to the stored `html` beyond the iframe sandbox — this is likely an intentional trade-off (arbitrary user-authored apps need to run arbitrary JS) but is worth flagging explicitly since it means a published page can still, e.g., open popups (`allow-popups` is in the sandbox list, `app/p/[id]/page.tsx:67`) or run scripts that phish within the opaque-origin iframe's visible content — a lower-severity but real concern for arbitrary user-generated public content with no review step.
9. No tests exist for the publish route or the ownership model at all.
10. The project's `published.at`/`id` metadata update (`app/api/data/publish/route.ts:26-30`) is fire-and-forget with its error unchecked/undeclared (no `error` variable is captured from this second `update` call at all) — if it fails, the client is told the publish succeeded (`Response.json({id})` at line 32 runs regardless) but the project's own record of being published silently never updates, leaving the UI (`onPublish` in `app/(app)/code/[id]/page.tsx`) and the actual `published` table out of sync.

**Fixes:**
1. Before the upsert, `SELECT owner FROM published WHERE id = :id` — if a row exists and `owner !== user.uid`, return 403. If no row exists, proceed with insert. Additionally verify `projectId` belongs to `user.uid` before accepting the publish at all (same fix pattern as the Files/Conversations ownership gaps).
2. Switch to `crypto.randomUUID()` for published ids (and all entity ids generally, per earlier sections).
3. Add a `DELETE /api/data/publish/[id]` (or `/api/data/publish?id=`) route that verifies ownership and removes the `published` row (and clears `project.published`), plus a corresponding "Unpublish" UI action.
4. Add a server-side size cap on the `html` payload (e.g., a few MB) and reject oversized publishes with a clear error.
5. Add `Cache-Control`/CDN caching headers to `/api/published/[id]` given it's public, immutable-until-republished content.
6. Add rate limiting to both the publish write route and the public read route.
7. Capture and check the `error` from the project `published`-field update call, and surface a warning to the client if it fails (or make the whole operation transactional).
8. Add an integration test asserting user B cannot overwrite user A's published page by reusing A's id.

---

## Security Rules vs. Actual Usage (`firestore.rules`, `storage.rules`, `firebase.json`)

**What's included:**
- `firestore.rules`: uid-scoped `users/{uid}/**` read/write, public-read/owner-write `published/{pubId}`, deny-all default: `firestore.rules:9-33`.
- `storage.rules`: uid-scoped `users/{uid}/{allPaths=**}` read/write, deny-all default: `storage.rules:6-13`.
- `firebase.json`: wires both rule files to their respective Firebase products, nothing else configured (no Hosting, no Functions, no emulators section): `firebase.json:1-9`.

**Strengths:**
1. `storage.rules` correctly matches the actual path shape used by `FileStore.put` (`users/{uid}/files/{fileId}`) — this is the one rules file that's still accurate to real (if largely unreached) usage.
2. Both rule files have an explicit deny-by-default fallback (`match /{document=**} { allow read, write: if false; }` / equivalent for storage), which is the correct fail-closed default regardless of whether the primary rules above it are still relevant.
3. The `published`-collection rule in `firestore.rules:21-27` (public read, owner-only write) is conceptually the *right* model for the publishing feature — it's just enforcing a security model for a Firestore collection that no code in the app actually reads or writes anymore (see weaknesses).

**Weaknesses:**
1. **`firestore.rules` governs a data model the application does not use.** A repo-wide search for `firebase/firestore`, `getFirestore`, `collection(`, `doc(`, `onSnapshot` (excluding this file and docs) returns zero application-code hits — the entire chat/file/project/skill/agent/profile persistence layer runs through Supabase, not Firestore. `firestore.rules` describes uid-scoped `users/{uid}/**` and a `published/{pubId}` collection that have no corresponding Firestore reads/writes anywhere, making this file dead configuration that misrepresents the actual security boundary to anyone reviewing it (including, presumably, this very audit's brief, which references it as if it were load-bearing).
2. Because the real "published" security boundary now lives in `app/api/data/publish/route.ts` (Supabase, service-role, no RLS policy — see the Publishing section's weakness #1), the *actual* enforcement of "only the owner can overwrite their published page" is **weaker** than what `firestore.rules:23-24` specifies for the (unused) Firestore equivalent — the Firestore rule correctly requires `request.resource.data.owner == request.auth.uid` on create/update, but the live Supabase route has no equivalent check at all. If this ever gets pointed out during a rules-only security review, the reviewer could easily conclude publishing is properly owner-gated when it is not.
3. `firebase.json` has no `hosting`, `emulators`, or `.firebaserc`-adjacent configuration reviewed alongside it, so it's unclear whether `firebase deploy` in this repo would even do anything meaningful beyond pushing these two (partially dead) rule files — worth confirming this file is still part of the actual deployment pipeline.
4. No CI check or test exists that fails the build if `firestore.rules`/`storage.rules` drift further from actual usage (e.g., if Storage usage is also fully removed later, `storage.rules` would become entirely dead with nothing to flag it).
5. There's no equivalent, explicit "here is the real security model" documentation anywhere in the repo pointing from `firestore.rules` to the actual Supabase/service-role enforcement pattern — a future contributor reading only the rules files would form an incorrect mental model of the app's authorization boundary.

**Fixes:**
1. Either delete `firestore.rules`'s Firestore-data-model rules entirely (keeping only what's genuinely still relevant, if anything) or add a prominent header comment stating "Firestore is not used for application data; see `lib/supabase/route-helpers.ts` for the real authorization model," so reviewers don't mistake it for the live boundary.
2. Port the ownership check that `firestore.rules:23-24` already correctly specifies (`data.owner == request.auth.uid`) into the live `POST /api/data/publish` route in code, per the fix already recommended in the Publishing section.
3. Confirm whether `firebase.json`/`firestore.rules`/`storage.rules` are still part of an active deploy step; if Firestore is fully decommissioned, remove its rules and the `firestore` key from `firebase.json`, keeping only `storage`.
4. Add a lightweight repo-level check (even a comment-based lint or a README note) tying the rules files' continued relevance to actual code usage, so this doesn't silently drift further.

---

## PDF Handling (client-side parse/rasterize)

**What's included:**
- `lib/pdf/parse.ts`: `parsePdf` (lazy-imports `pdfjs-dist`, extracts per-page text via `getTextContent`, classifies a PDF as having a real text layer vs. being scanned based on a density heuristic) and `rasterizePdf` (renders up to `MAX_RASTER_PAGES=10` pages to PNG data for scanned/image-only PDFs), both entirely client-side with no persistence: `lib/pdf/parse.ts:28-87`.

**Strengths:**
1. `pdfjs-dist` is lazily imported (`await import(...)`) so it never ships in the server bundle and is only downloaded on first actual PDF attachment: `lib/pdf/parse.ts:28-33`.
2. The text-vs-scanned heuristic (`MIN_CHARS_PER_PAGE = 16` non-whitespace chars per page) is a simple, defensible way to route documents to the free (text-extraction) vs. gated (vision/OCR) path without a server round-trip: `lib/pdf/parse.ts:24,51`.
3. `rasterizePdf` explicitly caps the number of pages rasterized (`MAX_RASTER_PAGES = 10`) specifically to prevent a huge scanned PDF from ballooning the request sent to the vision model: `lib/pdf/parse.ts:26,68`.
4. Both functions correctly call `pdf.destroy()` in a `finally` block, avoiding a resource/memory leak in the pdf.js document object even on error: `lib/pdf/parse.ts:53-55,83-85`.
5. No data leaves the browser at the parsing stage — text extraction and rasterization are both pure client-side operations, with persistence/upload handled entirely by the (separately audited) chat/attachment pipeline.

**Weaknesses:**
1. No maximum input file size check before calling `pdfjs.getDocument({ data })` — an extremely large PDF (hundreds of MB) would be fully loaded into a `Uint8Array` in browser memory with no guard, risking a tab crash on lower-memory devices.
2. No timeout/cancellation for `parsePdf`'s per-page text-extraction loop — a pathological PDF with an enormous page count could hang the main thread for a long time (each `getPage`/`getTextContent` call is awaited serially, not batched or yielded).
3. `rasterizePdf` renders to a `<canvas>` at full page dimensions scaled by 1.5x with no maximum canvas size cap — a PDF with unusually large page dimensions could create a very large canvas, risking a browser memory/allocation error.
4. No test coverage for the text/scanned classification heuristic or the page-count/size caps.

**Fixes:**
1. Add a file-size check (e.g., reject or warn above some MB threshold) before invoking `pdfjs.getDocument`.
2. Consider yielding between pages (e.g., via `requestIdleCallback`/micro-batching) for very-high-page-count PDFs, or add an explicit page-count cap mirroring `MAX_RASTER_PAGES` for the text-extraction path too.
3. Cap the rendered canvas's width/height (clamping the render `scale`) for unusually large PDF page dimensions.
4. Add unit tests for the `hasTextLayer` heuristic using representative sample PDFs (text-based vs. scanned).

---

## Cross-Cutting Observations (not tied to one feature)

1. **Systemic ownership-of-foreign-key gap**: the same pattern — inserting a row that references a parent resource (`conversation_id`, `project_id`, `parent_id`) without first verifying that parent belongs to the requesting user — recurs across Messages (`app/api/data/conversations/[id]/messages/route.ts:25-34`), Files (`app/api/data/files/route.ts:9-16`, `app/api/data/files/bulk/route.ts:19-29`), and Publish (`app/api/data/publish/route.ts:9-33`), and is also present in the (out-of-scope-for-this-audit but corroborating) Checkpoints route (`app/api/data/checkpoints/route.ts:28-35`). This strongly suggests a missing shared helper (e.g., `requireOwnedResource(table, id, uid)`) rather than N independent oversights — a single shared utility, added once and applied everywhere, would close all of these at once.
2. **Weak, non-cryptographic id generation** (`lib/utils.ts:10-12`, `Math.random()` + `Date.now()`) is used as the primary-key source for every persisted entity across every table (conversations, messages, projects, files, skills, agents, and critically the public `published` table), while the one place that *does* use `crypto.randomUUID()` (`lib/supabase/storage.ts:34`) shows the fix is already known/available in the codebase — it just wasn't applied consistently.
3. **No rate limiting anywhere in the audited surface** (confirmed: no `middleware.ts`, and the repo's only rate-limit helper is scoped to AI/chat routes) — every route audited here (auth sync, all of `/api/data/*`, `/api/published/*`) is unmetered.
4. **No automated test coverage for any API route** in the audited scope — the only test file touching this scope (`tests/tree.test.ts`) covers pure client-side tree math, not authorization or persistence behavior. Every ownership gap found in this audit would have been directly catchable by a basic "user A cannot touch user B's row" integration test.
5. **`readJson`/bare `req.json().catch(() => ({}))` swallow-to-empty pattern** is used uniformly across the API layer (`lib/supabase/route-helpers.ts:27-33` and inline in `app/api/data/profile/route.ts:20`) — a systemic choice that trades input-validation rigor for route-handler brevity; worth a single coordinated fix rather than N per-route fixes.
