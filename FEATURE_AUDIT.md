# ForgeOS Feature Audit

Read-only, code-first audit of every feature currently implemented in this repository, checked against the invariants and stack description in `CLAUDE.md`. Each section was produced by an independent review of the owning files (cited as `file:line`), not from the product spec's stated intentions.

## Summary

The codebase is materially more mature than `CLAUDE.md`'s phase status implies — only Phase 1 (chat) is marked complete, but Skills, Agents, Memory, Stripe billing, and the full Forge Code IDE/build/verification pipeline all have substantial, largely-functional implementations with real tests. The single biggest documentation-vs-code gap is the data layer: CLAUDE.md describes "Firebase (Auth + Firestore + Storage)" with a Firestore `users/{uid}/…` tree, but the actual persistence layer is Supabase/Postgres for nearly everything (conversations, messages, projects, files, agents, skills, checkpoints, billing, usage) — Firebase is retained only for auth and as the primary binary-blob store, and `firestore.rules` is dead configuration securing a database the app no longer writes to. The provider-secrecy invariant is well-enforced for the DeepSeek chat path (clean `models.ts`/`models.public.ts` split, generic client-facing errors) but is violated in adjacent subsystems: Gemini (vision), SiliconFlow (image generation), and E2B (code execution) provider names leak into client-visible error strings, and one test suite explicitly codifies a SiliconFlow error leak as expected behavior. Several independently-discovered security/access-control gaps compound into a real pattern: an unauthenticated Stripe debug endpoint exposes account/pricing internals; the Instruction Inspector exposes the full assembled system prompt to any signed-in user with no admin gate; the artifact-publish endpoint has no ownership check, letting any user hijack another user's public URL; and Forge Code's preview "Open in new tab" action writes AI-generated HTML into a same-origin popup, completely bypassing the iframe sandboxing used everywhere else. Rate limiting is opt-in/no-op by default (a single env var), and usage-quota enforcement (both general token usage and code-execution counts) has a check-then-act race with no reservation, allowing overspend via concurrent requests. Markdown rendering enables raw HTML with no sanitizer, a live XSS surface. Finally, the most sophisticated piece of the Forge Code pipeline — the strict LLM "Verifier/Fixer" review cycle — is fully implemented and tested but gated behind a hardcoded `false` flag in production, making it dead code today.

---

# Forge Chat

## Firebase Auth + gate
**What's included:**
- Firebase client SDK init, gated on env presence: `lib/firebase/client.ts:15-17` (`firebaseConfigured`), `:21-26` (lazy singleton `getFirebaseApp`), `:28-31` (`getFirebaseAuth`), `:33-36` (`getStorageClient`, unused downstream of auth), `:39-40` (Google provider with `prompt: "select_account"`).
- Firebase Admin SDK init, gated on env presence: `lib/firebase/admin.ts:12-17` (`adminConfigured` from `FIREBASE_ADMIN_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`), `:15` (literal `\n` → real newline fix-up for the private key), `:21-35` (`getAdminApp`, reuses existing app via `getApps()`), `:37-40` (`getAdminAuth`), `:42-45` (`getAdminStorage`, unused downstream of auth).
- Server-side token verification: `lib/auth/server-auth.ts:15-36` (`verifyRequest`) — pulls `Authorization: Bearer <token>` header, calls `auth.verifyIdToken`, returns `{uid, email, name, picture}` or `null` on any failure; `:38-43` `jsonError` helper for uniform JSON error responses.
- Client auth context/provider: `components/auth/auth-provider.tsx` — `onAuthStateChanged` subscription (`:82-109`), calls `ensureProfile` on sign-in (`:89-94`), fires-and-forgets `ensureBuiltinSkills` (`:98-100`), subscribes to profile updates (`:101`); `signInGoogle` via `signInWithPopup` with popup-specific error mapping (`:39-64`, `:116-130`); `signOutUser` (`:132-135`); `getIdToken` (`:137-140`); exposes `configured` alongside `user`/`profile`/`loading`.
- Route/UI gate: `components/auth/auth-gate.tsx` — `ConfigNotice` when Firebase env vars are missing (`:32-90`), `Splash` loading spinner (`:9-30`), redirect-to-`/sign-in` when configured but unauthenticated (`:96-98`).
- Sign-in page: `app/(auth)/sign-in/page.tsx` — self-redirects to `/` if already signed in (`:36-38`), "Continue with Google" button (`:86-100`), config-needed notice when `!configured` (`:101-116`).
- Sync-user API route: `app/api/auth/sync-user/route.ts` — `POST` calls `requireUser` (verifies Firebase ID token + checks Supabase configured), upserts rows into **Supabase** (`users`/`user_settings`/`usage`), using only the server-verified `uid`/`email`/`name`/`picture`, falling back to client-supplied values only when the token lacks them (`:23-28`).
- `lib/supabase/route-helpers.ts:16-21` (`requireUser` — 503 if Supabase not configured, 401 if token invalid).

**Strengths:**
1. Token verification never trusts client-supplied identity — `lib/auth/server-auth.ts:26-32` decodes the bearer token server-side and `app/api/auth/sync-user/route.ts:23-28` explicitly prefers the verified token's claims over the request body.
2. Graceful degradation instead of a crash when unconfigured: both `firebaseConfigured`/`adminConfigured` are checked before any Firebase call, and the UI surfaces a real "finish configuring" screen rather than a broken white screen.
3. Popup sign-in error handling is specific and actionable: distinguishes `auth/web-storage-unsupported`, `auth/popup-blocked`, `auth/unauthorized-domain` with tailored copy, and silently ignores user-initiated cancellations.
4. No secrets leak client-side: `FIREBASE_ADMIN_*` vars are read only in `lib/firebase/admin.ts`, and `lib/auth/server-auth.ts:1` has `import "server-only"`.
5. Idempotent profile provisioning: `ensureProfile` is safe to call on every sign-in, backed by upsert semantics.

**Weaknesses:**
1. **CLAUDE.md's stack claim is false for auth-adjacent data.** CLAUDE.md states "Firebase (Auth + Firestore + Storage) + Admin SDK," but `sync-user/route.ts` upserts into **Supabase**, and `lib/data/profile.ts` talks to Supabase-backed REST routes, never Firestore. Firebase is used exclusively for authentication.
2. Dead/unused Storage wiring gives a false impression of capability: `getStorageClient`/`getAdminStorage` are implemented but nothing in the auth flow consumes them.
3. No error state surfaced when `verifyIdToken` fails downstream of a real session — `verifyRequest` swallows every exception into a bare 401 with no client-side refresh/re-auth handling.
4. `ensureProfile` failure path swallows errors post-sign-in (`console.error` only) — user is authenticated but `profile` may stay `null` forever with no toast/retry.
5. No explicit dark/light toggle exercised in these files; the hardcoded Google "G" logo uses fixed brand colors against a theme-variable background — not independently verified against dark-theme tokens in this pass.

## Model selection & provider secrecy layer
**What's included:**
- `lib/ai/models.ts:10` guarded with `import "server-only"`; only file holding `PROVIDER_MODEL` (`deepseek-v4-flash`/`deepseek-v4-pro`, lines 13-16) and `resolveProviderModel(id)` (31-33).
- `lib/ai/models.public.ts` — client-safe metadata only: `FORGE_MODELS_PUBLIC` with `label`/`blurb` (5-14), `DEFAULT_MODEL = "spark-2.5"`. Confirmed zero provider-identifier strings.
- `components/chat/model-menu.tsx` — imports only `models.public` (line 8), renders label/blurb, never touches `models.ts`.
- `lib/ai/provider.ts` — sole runtime consumer of `models.ts` (`import "server-only"`, calls `resolveProviderModel` once, line 138). Reads `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` only here.
- `app/api/chat/route.ts` — `friendlyError()` (60-73) maps errors to generic strings, never forwards raw provider error text.
- Repo-wide import check: `lib/ai/models.ts` is imported by exactly two files — `provider.ts` (server) and `tests/models.test.ts`. No `app/`/`components/` file imports it. Repo-wide `deepseek` grep hits only those two files plus docs.

**Strengths:**
1. Clean two-file split enforced by `import "server-only"` in both files — a build-time guard, not just convention.
2. `models.public.ts` verified provider-string-free and the only model-metadata import in `model-menu.tsx`.
3. Client-visible chat errors are hand-written generic strings, not proxied provider error text.
4. The streamed `ProviderEvent` shape carries no model-id/provider field at all.
5. Model list is real and load-bearing — two models wired to two real DeepSeek endpoints, no fake stats.

**Weaknesses:**
1. `FORGE_MODELS` (`models.ts:18-29`, bundling `label`+`blurb`+`provider`) is dead code with zero importers — an attractive nuisance for a future dev to import "just the label" and drag the provider string along.
2. `ProviderRequestError` carries the raw upstream response body as `error.message`; today discarded by the route, but only one careless `err.message` change away from leaking.
3. No lint-level/structural guard (e.g. restricted-import boundary) blocks `app/**`/`components/**` from importing `lib/ai/models` — the invariant holds by convention + grep, not enforcement.
4. A `console.warn` in the fallback-tier path is fine today but sits next to fetches embedding the provider base URL/key.
5. `models.test.ts` asserts the literal `deepseek-v4-flash`/`-pro` strings — the real provider identifiers now live in a second location (test fixtures) beyond `models.ts`.

## Streaming chat engine + continuation loop
**What's included:**
- Server-only DeepSeek client (`lib/ai/provider.ts:1`) building OpenAI-compatible bodies (`buildBody`, 126-162), reading env only in `baseUrl()`/`postProvider()`.
- Tiered-fallback POST helper (`postProvider`, 164-217): on a 400, steps `max_tokens` down through 6 tiers so a rejecting endpoint still answers.
- SSE-like parsing of `data:` lines (`streamOnce`, 237-339), accumulating content/reasoning/tool-calls/usage.
- Agent loop (`streamForgeCompletion`, 349-451) unifying tool calls and length-truncation continuation under one `MAX_ROUNDS = 8` cap (10, 364); on `finishReason === "length"`, replays `answer` + `CONTINUATION_PROMPT` as a synthetic user turn.
- Reasoning surfaced to client only on first segment but always captured/replayed on tool-call turns (88-91, 405).
- `app/api/chat/route.ts` wraps the generator in a `ReadableStream`, translating events into a provider-free wire protocol (`lib/ai/types.ts:92-124`, explicitly commented "Contains NO provider identifiers").
- Client: `hooks/use-chat-send.ts:374-419` reads NDJSON into `useStreamStore` (`lib/store/stream-store.ts`), a module-level (not component-scoped) Zustand store keyed by `conversationId`.
- Abort/stop wired end-to-end: `stop()` aborts an `AbortController` mirrored server-side on `req.signal` and `ReadableStream.cancel()`.

**Strengths:**
1. Provider secrecy enforced structurally (`server-only`, centralized env reads, provider-free wire type and error copy).
2. Continuation loop is genuinely robust: detects truncation per-round, replays only answer text with an explicit anti-repeat prompt, shares a hard round cap with the tool loop.
3. The 400-tiered fallback ladder sacrifices thinking/tools/effort only as a last resort.
4. Streaming state genuinely survives client-side navigation via the module-level store.
5. Abort handling is complete end-to-end and persists the partial answer as editable/regenerable rather than discarding it.

**Weaknesses:**
1. No dedicated test coverage exercising the continuation/tool-loop branching logic.
2. `MAX_ROUNDS = 8` is a combined cap for tool rounds + continuations; hitting it silently breaks with `finishReason: "length"` and nothing downstream warns the user the response was cut off by the round cap.
3. `stream-store.ts` has no persistence layer — despite the "survives navigation" claim, a hard refresh or closed tab loses all in-flight content with no rehydration.
4. Non-400 provider errors (5xx/429) are not retried at all — only 400s step down tiers.
5. The continuation loop's `baseContext` only grows across tool rounds/continuations with no re-collapse safeguard, risking prompt-size growth within a single turn.

## Thinking/reasoning replay + effort levels
**What's included:**
- `lib/ai/effort.ts:5-26` defines 5 levels (low/medium/high/xhigh/max) with `maxTokens` (32k→384k) and `tempNoThink` (0.8→0.35).
- `lib/ai/prompts.ts:29-40` gives each level a distinct system-prompt directive tagged `[EFFORT: ...]`.
- `lib/ai/provider.ts:99-107` maps effort → provider `reasoning_effort`, but collapses `xhigh` to the same value as `high` — only 4 distinct provider-side buckets for 5 UI levels.
- `max_tokens`/`temperature` still differ across all 5 levels independent of that collapse.
- The `providerEffort` field defined per-level in `effort.ts` is dead code — `provider.ts` uses its own separate map.
- Reasoning replay is real: `provider.ts:290-295` reads live `reasoning_content`/`reasoning` deltas, appended in `stream-store.ts:117`, rendered by `ThinkingPanel`.
- Reasoning persisted/replayed on tool-call turns (`provider.ts:88-91`).
- `tests/effort.test.ts` checks exactly 5 levels, monotonic `maxTokens`/`tempNoThink`, and unique directive text.

**Strengths:**
1. Effort truly changes behavior (tokens, temperature, prompt text), verified by monotonicity/uniqueness tests.
2. Reasoning replay is genuine, end-to-end, no synthetic text anywhere in the chain.
3. Both `effort.ts` and `thinking-panel.tsx` are provider-agnostic.
4. `thinking-panel.tsx` fully uses design-token CSS classes, correct in both themes.
5. Reasoning is conditionally re-sent only on tool-call turns, avoiding payload bloat.

**Weaknesses:**
1. `provider.ts:99` contains the comment `// Forge's 5 effort levels → DeepSeek V4 reasoning_effort` — the real vendor/model name appears in a second file beyond `models.ts`, contradicting the letter of the provider-secrecy invariant (though server-only, never reaching the client).
2. `xhigh` silently collapses to the same provider `reasoning_effort` as `high` — 2 of the "5 distinct" levels aren't distinct at the model layer.
3. `providerEffort` in `effort.ts` is dead/misleading config, never read by `provider.ts`.
4. `tests/effort.test.ts` never touches `thinking-panel.tsx`/`stream-store.ts`/`provider.ts` — no test verifies reasoning deltas actually populate the panel or the `xhigh` collapse.
5. Minor a11y gap: the scrollable reasoning body has no `role`/`aria-label` distinguishing streaming vs. finished state beyond the chevron.

## Intent detection, prompts, tools, context & rate-limiting
**What's included:**
- `lib/ai/intent.ts:5-28` — regex-only `detectCreatorIntent()` classifying "create/edit a skill" vs "create/edit an agent" from composer text.
- `lib/ai/prompts.ts` — `assembleSystemPrompt()` (407) deterministically concatenates identity → mode → web-craft directive → effort → persona → Forge state → internal knowledge → agent/project/FORGE.md/custom/memory → active skills + management blocks → skill catalog → attached context → tool addenda → date. Distinct blocks for 5 modes, 5 efforts, 2 personas, a strict build-mode contract, a fabricated-data corrective pass, and a separate "Verifier" persona.
- `lib/ai/tools.ts` — `WEB_SEARCH_TOOL`/`GENERATE_IMAGE_TOOL` schemas; `executeWebSearch` calls real Serper→Brave fallback; `executeGenerateImage` calls real SiliconFlow then re-hosts to Supabase Storage.
- `lib/ai/context-server.ts` — loads agent/user/project prompt context from Supabase, all three swallow errors silently to `{}`/`undefined`.
- `lib/ai/rate-limit.ts:13` — in-memory sliding window per uid, 60s window, limit from `FORGE_RATE_LIMIT_PER_WINDOW`; **disabled entirely** if unset or ≤0.
- `lib/ai/title.ts`/`app/api/title/route.ts` — fixed model/effort auto-titling, rate-limited, falls back to raw-message titling on any failure.

**Strengths:**
1. Provider secrecy is clean — no "deepseek" string anywhere in these 6 files; `BASE_IDENTITY` explicitly instructs the model to identify only as Forge OS and deflect provider questions.
2. Tool integrations are real, working third-party calls (Serper→Brave search, SiliconFlow image gen with permanent re-hosting).
3. Image-gen fallback notice correctly preserves provider secrecy even in a degraded scenario.
4. `assembleSystemPrompt` is deterministic and documented as such, important since its output is surfaced verbatim via the Instruction Inspector.
5. Unusually concrete anti-hallucination guardrails for generated code (forbidding fake/truncated bulk data with a mandated runtime-fetch pattern).

**Weaknesses:**
1. Rate limiting is decorative by default — returns `true` (no limiting) whenever `FORGE_RATE_LIMIT_PER_WINDOW` is unset, with no evidence of what the deployed default actually is.
2. Rate limiting is in-memory/per-instance only (explicitly flagged as a known gap in the code) — multiplies the effective limit by instance count on any multi-instance deployment.
3. Regex-based creator-intent detection is coarse and can false-positive (e.g. "real estate agents" triggers agent-creation intent).
4. `context-server.ts` silently swallows all errors with no logging — a Supabase misconfiguration is indistinguishable from "user has no agent/project instructions."
5. Image-gen fallback half-credit accounting depends entirely on caller-supplied `ctx` with no independent validation inside `tools.ts`.

## Composer + §5.7 menu
**What's included:**
- Model/effort trigger opening `ModelMenu`; `AgentMenu` inline picker with `role="menuitemradio"` items and an active-agent chip.
- "+" menu: "Skill or command" (seeds `/`) and "Attach image or PDF".
- Slash-command skill picker with arrow-key nav, active chips with remove controls.
- Attachments pipeline: images (≤10MB), text-layer PDFs (≤25MB, free), scanned PDFs (gated), drag-and-drop and paste-to-attach.
- Plan-gated features (image understanding, document analysis, voice) each check `getFeatureLimit`/`openGate`.
- Voice dictation: MediaRecorder capped at 60s, posts to `/api/voice/transcribe`, inserts transcript at caret.
- `lib/store/composer-store.ts` exposes model/effort/thinking/toolsEnabled/webSearchEnabled/activeSkillSlugs/activeAgentId/incognito, plus `hydrateDefaults`/`syncFromConversation`.

**Strengths:**
1. Attachment gating is well-layered with per-type size caps and toast-surfaced failures.
2. Real empty states for skills/agents menus, no seeded/dummy entries.
3. `AgentMenu` uses correct interactive semantics (real buttons, `menuitemradio`/`aria-checked`, Escape-to-close).
4. No hardcoded colors in composer/agent-menu — fully theme-token driven.
5. `tests/composer-store.test.ts` locks in that switching models doesn't clobber effort/thinking.

**Weaknesses:**
1. **Enter-key bypasses the usage gate the Send button enforces** — `doSend()`'s guard never checks `usageFull`, so a user at their cap can still submit via Enter.
2. Dead/unreachable store fields: `toolsEnabled`/`incognito` setters have zero call sites in the composer or agent menu.
3. Skill/agent selection leaks across conversations — `syncFromConversation` never resets `activeSkillSlugs`/`activeAgentId`, so a previously active agent/skill persists into a new chat.
4. No guard on paste/message size or attachment count beyond per-file byte limits.
5. Inaccessible custom controls — skill-picker items are plain `<div>`s with no `role="option"`/`aria-selected`, and chip "remove" spans have no `tabIndex`/`onKeyDown`.

## Message persistence + branching/edit/regenerate
**What's included:**
- **Backend is Supabase/Postgres, not Firestore** — every route imports `supabaseAdmin` and issues `.from("conversations")`/`.from("messages")` queries. `lib/data/realtime.ts:3` self-documents as "Realtime replacement for Firestore onSnapshot, fully server-backed" via 10s polling + optimistic cache writes. `supabase/schema.sql` confirms the migration explicitly.
- Tree/branching genuinely implemented: `messages.parent_id` FK, `conversations.active_leaf_id` tracks selected branch; `lib/data/tree.ts:15-86` (`buildActivePath`, `leafOf`, `siblingsOf`) are pure, tested helpers.
- Branch switch, edit (creates a new sibling off the same parent), and regenerate (new assistant branch under the same parent) are all traced end-to-end from UI → hook → REST → Postgres, not stubs.
- Cascade delete relies on Postgres `ON DELETE CASCADE`.
- `tests/tree.test.ts` is a solid 8-case suite against a realistic branched fixture. `tests/message-assembly.test.ts` is misleadingly named — it tests AI provider prompt assembly, not persistence.

**Strengths:**
1. Tree/branching model is cleanly implemented, backend-independent, and well unit-tested.
2. Branch/edit/regenerate are complete, real end-to-end flows, not stubs.
3. The realtime layer is honest about its own nature via a self-documenting comment.
4. Clean camelCase/snake_case translation boundary keeps the app decoupled from Postgres column names.
5. Theming is correctly token-driven throughout the message/branch UI.

**Weaknesses:**
1. **CLAUDE.md's data-model description is materially false and unmaintained** — "Firestore data model: everything under users/{uid}/…" describes nothing about the actual system.
2. No dedicated test exists for `lib/data/chat.ts`'s mutation functions or the Supabase mappers round-tripping correctly.
3. Leftover Firestore-era naming (`ConversationDoc`, `MessageDoc`, `subscribeX`) is cosmetically confusing given the relational backend.
4. Thumbs-up/down feedback in `message.tsx` is local component state only — never persisted, vanishes on reload.
5. Polling-based "realtime" (10s interval) means cross-tab/cross-device changes can lag up to that interval.

## Markdown/code rendering
**What's included:**
- GFM, math (remarkMath + rehypeKatex), raw HTML passthrough (rehypeRaw), Shiki syntax highlighting (single fixed theme `github-dark-default` in both app themes by design).
- Language detection via className + alias table; inline-vs-block heuristic; `<pre>` unwrapped so `CodeBlock` supplies its own chrome.
- Copy-to-clipboard, download-as-file, "Run code" affordance, debounced (150ms) async highlighting.
- Domain-specific fenced-block hijacking: `forge-skill`/`forge-agent` fences render save cards instead of code blocks; artifact-detected code renders `ArtifactCard` instead.
- External links forced to `target="_blank" rel="noopener noreferrer"`.

**Strengths:**
1. Clean separation of concerns across markdown/code-block/highlighting.
2. Debounced highlighting with stale-result guarding avoids re-highlighting every keystroke while streaming.
3. Per-theme CSS custom properties adapt code-block chrome independently of the fixed Shiki theme.
4. Sensible copy/download/run affordances plus a clean inline-vs-block heuristic.
5. Domain-specific fenced-block handling is a clean extension point reusing the same pipeline.

**Weaknesses:**
1. **XSS risk — no sanitization of raw/rendered HTML.** `rehypeRaw` is enabled with no `rehype-sanitize`/DOMPurify step anywhere in the pipeline (confirmed absent from `package.json`). Any `<script>`/`onerror`/`javascript:` URL in model output or pasted content renders unsanitized. Top-priority fix.
2. A second `dangerouslySetInnerHTML` sink renders Shiki's output with no comment/justification of why it's considered safe.
3. Single hardcoded Shiki theme means no true light code theme — a deliberate simplification, but "both themes" QA for code blocks is really "one theme + themed chrome."
4. Unmatched language classNames silently fall through to `"text"` highlighting with no dev-visible warning.
5. No size/complexity guard on markdown/KaTeX/Shiki input — converges with weakness #1 on the same untrusted-input surface.

## Artifacts + publish
**What's included:**
- Artifact detection (`isPreviewable`/`isArtifactCode` in `lib/code/snippet.ts`) flags previewable HTML/SVG and generic multi-line code.
- Inline card, modal, and panel views all offer Preview/Code tabs, Copy, Download, "Open in new tab".
- Preview rendering via `<iframe sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock" srcDoc=...>` — `allow-same-origin` deliberately omitted everywhere in the artifact-card/modal/panel/public-page paths.
- `lib/code/sandbox-shim.ts` polyfills storage APIs for the resulting opaque-origin failures.
- Publish flow: client assembles a self-contained HTML snapshot, `POST /api/data/publish` upserts into a public `published` table; `GET /api/published/[id]` is fully public with no auth; `app/p/[id]/page.tsx` renders it sandboxed.

**Strengths:**
1. Deliberate, well-documented opaque-origin sandboxing consistently applied across all three rendering surfaces for chat-side artifacts.
2. The storage-shim workaround preserves the security property while fixing a real usability bug.
3. Public publish/read endpoints are appropriately unauthenticated by design and documented as such.
4. The `/projects` update on publish is correctly scoped to the authenticated user.
5. No placeholder/seed data anywhere in the flow.

**Weaknesses:**
1. **Broken access control on re-publish.** `POST /api/data/publish` upserts `{id, owner, html}` with no check that an existing row at that `id` already belongs to the caller. Since published ids are public (they're in the shareable URL), any authenticated user who learns another user's published id can overwrite their content and reassign ownership — hijacking the victim's public link.
2. No CSP anywhere in the app to back up the iframe sandboxing as defense-in-depth.
3. `allow-popups` without `allow-popups-to-escape-sandbox` broadens the surface slightly with no CSP `sandbox` header as a second layer.
4. Weak/predictable publish ID generation — `uid()` uses `Math.random()`, not `crypto.randomUUID`, for what is now (per weakness #1) the sole authorization boundary.
5. Theme inconsistency — `app/p/[id]/page.tsx` hardcodes `background: "#fff"` for the content area regardless of `[data-theme]`, producing a jarring white frame around dark-themed published pages.

## Image generation & vision
**What's included:**
- SiliconFlow text-to-image/edit client (server-only), model routing by plan (Z-Image-Turbo for starter/pro, FLUX.2-pro for max/ultra, FLUX.1-Kontext-dev for edits), dual-host failover, premium→starter fallback with half-credit accounting.
- Gemini 2.5 Flash vision client (server-only), multi-image description and a separate document/OCR prompt mode for scanned PDFs.
- `GeneratedImageCard`/`AnalyzingImage` UI with shimmer loading, download, upgrade-card for gate/limit errors.
- Public-safe plan→label mapping with no provider identifiers (`lib/images/public.ts`).

**Strengths:**
1. All real, non-mocked provider integrations — tests exercise actual request bodies/response shapes/error branching.
2. Careful provider secrecy in the happy path — `public.ts` never leaks provider/model strings; the fallback notice is scrubbed and unit-tested.
3. Both image/analyzing UI components are fully theme-token driven.
4. Thoughtful edit-vs-generate fallback semantics (no silent re-generation-as-fallback for edits, since the fallback model can't use the input image).
5. Server-only enforcement correctly keeps API keys out of client bundles.

**Weaknesses:**
1. **Provider-name leakage in error paths reaches the client**, contradicting the spirit of CLAUDE.md's invariant. `lib/vision/gemini.ts` builds messages like `"Gemini rejected the image request..."` that are thrown, caught in `app/api/chat/route.ts`, and returned verbatim in the HTTP error body. Symmetrically, `lib/images/siliconflow.ts`'s `friendlySiliconFlowError` produces messages naming "SiliconFlow" that reach `GeneratedImageErrorCard` unmodified. `tests/imagegen.test.ts` explicitly asserts the SiliconFlow-naming message text as expected behavior — the leak is codified, not caught.
2. (Confirmed not a leak): file/module naming itself never reaches the client per repo-wide grep — only the runtime error strings above do.
3. `tests/vision-attachments.test.ts` doesn't actually exercise `lib/vision/gemini.ts`'s logic at all — zero test coverage of Gemini's prompt building/error mapping.
4. `imageSizeForModel()` always returns `"1024x1024"` regardless of model/plan — a dead/stubbed parameter.
5. The upgrade-card error-matching regex is narrow; other provider errors (including the leaking ones above) render identically to a generic failure with no retry affordance.

## Voice (speak/transcribe)
**What's included:**
- `app/api/voice/speak/route.ts` — Firebase-authenticated proxy to OpenAI TTS (`tts-1`, voice `alloy`), streams MP3 back, 4096-char cap.
- `app/api/voice/transcribe/route.ts` — Firebase-authenticated proxy to Groq Whisper (`whisper-large-v3`), tracks clip duration for usage metering.
- Both plan-gated/metered (`voice_output_chars`, `voice_input_minutes`).
- `hooks/use-tts.ts` — single-active-player singleton with full stop/cleanup path.
- UI wiring: mic capture in `composer.tsx` (MediaRecorder, auto-stop timer, transcript insertion at caret), read-aloud button in `message.tsx`.

**Strengths:**
1. Genuine third-party APIs wired end-to-end, no mocks.
2. Clean provider secrecy — all client-facing errors are generic strings, no provider names/URLs/keys reach the browser.
3. Mic permission denial and unsupported-browser cases have distinct, actionable toasts.
4. Thorough resource hygiene (tracks stopped, object URLs revoked, in-flight fetches aborted).
5. Properly plan-gated and metered server-side, consistent with the rest of the monetization model.

**Weaknesses:**
1. Generic `"Voice playback failed"` error doesn't distinguish network/decoding/auth failures.
2. Hardcoded single voice (`alloy`) and model (`tts-1`) with no user-facing selection.
3. `MediaRecorder` has no explicit `mimeType`; server hardcodes filename `audio.webm` regardless of actual encoding — could mismatch on browsers producing a different container (e.g. Safari), silently failing Groq-side decode.
4. No client-side content-type/size check on the returned audio blob before playback.
5. Root-level `SETUP_INSTRUCTIONS_VOICE_*.md` files are worth checking separately for provider-name leakage in docs (out of this audit's file scope).

## Web search integration
**What's included:**
- Two provider backends: Brave and Serper, both `server-only`. `searchWeb()` tries Serper first, falls back to Brave only if Serper is unconfigured or returns zero results.
- Shared provider-agnostic result shape; `search-status.tsx` renders live/persisted search chips with favicons via `icons.duckduckgo.com`.
- `executeWebSearch` in `lib/ai/tools.ts` clamps result count to [1,10] and never throws.

**Strengths:**
1. Clean separation of concerns across provider modules, shared types, and orchestrator.
2. Provider secrecy well maintained — generic error strings, no provider names in the UI component (confirmed via grep, only server files + setup docs mention them).
3. Defensive error handling — both providers catch failures and return `[]` rather than throwing.
4. Sensible fallback logic — Serper primary, Brave genuine fallback, not dead code.
5. UI styling is fully theme-token driven.

**Weaknesses:**
1. No caching/de-duplication of identical queries — the model can call search multiple times per turn with no memoization.
2. No dedicated rate limiting/retry-backoff for the search providers — a 429 is treated the same as any other failure with only a console.error.
3. Test coverage is thin — one test covers only the Serper-success path; no test for Brave fallback, both-unconfigured, or count clamping.
4. Favicon requests leak the visited-source hostname to a third party (`icons.duckduckgo.com`) for every result shown.
5. The fallback trigger (empty array) can't distinguish "zero real results" from "provider error masquerading as zero results," making failures hard to diagnose from behavior alone.

## PDF parsing & attachments
**What's included:**
- Client-side PDF parsing via `pdfjs-dist`, classifying text-PDFs vs scanned PDFs by a density heuristic (16 non-whitespace chars/page).
- Scanned/no-text PDFs are rasterized to PNG (capped at 10 pages) and handed to the vision model for OCR.
- Supported MIME types: JPEG/PNG/WEBP/GIF images + PDF. Size gates: images ≤10MB, PDFs ≤25MB.
- Persisted document attachments store only `{type, name, analyzed?}` — extracted text is never persisted, only sent for that turn.
- Plan/quota gating on scanned-PDF (vision) analysis; free text extraction is ungated.

**Strengths:**
1. Clean separation: parsing is pure/client-only, attachment normalization is pure type-narrowing with no side effects.
2. Sensible free-vs-gated split — text-layer extraction is free, only scanned PDFs consume gated quota.
3. Bounded rasterization (max 10 pages) plus `try/finally` cleanup of pdf.js resources.
4. Size limits enforced before expensive parsing work runs.
5. Robust error handling around parsing with user-facing toasts rather than crashes.

**Weaknesses:**
1. No magic-byte/signature check on PDFs — relies entirely on file extension/MIME type and pdf.js's own robustness against malformed input.
2. No cap on extracted text size — a dense 25MB text PDF's full extracted string is forwarded unmodified into the model payload.
3. No per-page dimension/memory guard on rasterization — a malicious PDF declaring an enormous page size could attempt a huge canvas allocation.
4. Same Firestore-vs-Supabase drift as elsewhere — the attachment-normalizing mapper layer is Supabase-based.
5. The 16-chars/page "has text layer" heuristic is blunt — a lightly-scanned PDF could be misclassified and skip the more-accurate (gated) vision path.

## Skills system
**What's included:**
- Full CRUD backed by Supabase; polling-based "realtime" sync; editor modal (icon/name/slug/category/description/instructions); management page with duplicate/export/import/enable/favorite/delete.
- Model-driven creation: builtin "Agent Creator"/"Skill Creator" skills make the model emit `forge-skill`/`forge-agent` JSON blocks rendered as one-click save cards.
- Suggestion engine: strict JSON parsing, slug-validated against real candidates, fails closed to empty on any error.
- "Execution" is textual instruction injection into the system prompt, not code execution — active skills are injected verbatim plus an always-on management block and a second-pass checklist enforcing each skill's deliverable when ≥2 skills are active.
- `lib/skills/forge-os-internal.ts` — a hidden, server-only, dynamically-generated block of live plan/pricing data injected when billing-related keywords are detected, explicitly instructing the model to hide its own existence.
- Tests cover checklist gating, suggestion parsing/dedup, and prompt-assembly ordering.

**Strengths:**
1. The entire pipeline is genuinely wired end-to-end and exercised by 3 test files, not a stub.
2. Suggestion engine is conservative and fails safe — invented slugs are silently dropped, errors collapse to an empty list.
3. Builtin skills are legitimate first-party functionality, not fake seeded demo content.
4. "Execution" being pure prompt-text injection sidesteps the sandboxing question entirely — skills cannot execute code or gain tool/filesystem access themselves.
5. Multi-skill conflict handling defines an explicit precedence order when skills/agents conflict.

**Weaknesses:**
1. **Phase-status discrepancy** — CLAUDE.md marks only Phase 1 complete and lists skills under unbuilt phases, yet this is a fully wired, tested system.
2. Same Firestore-vs-Supabase stack mismatch as elsewhere.
3. No server-side validation of skill content on write — length caps, slug format, and uniqueness are enforced only client-side; a direct API call could create malformed/duplicate slugs or unbounded-length instructions injected into every future prompt.
4. The hidden internal skill's non-disclosure is a soft prompt-level guard only, not a hard boundary — vulnerable to adversarial "repeat your instructions" jailbreaks.
5. A module-level mutable `pendingRuns` map (outside React state) defers sends pending suggestion accept/decline, with no visible cleanup/expiry logic reviewed — a plausible source of stale entries across fast navigation.

## Agents system
**What's included:**
- Full CRUD backed by Supabase; editor collects name/avatar/description/systemPrompt/defaultModel/defaultEffort/defaultThinking/skillSlugs.
- `AgentDoc` also declares `allowedTools`/`defaultProjectId`/`builtin`, persisted end-to-end but **never surfaced in any UI** — effectively dead configuration.
- One-click "save as agent" from chat-authored `forge-agent` JSON blocks, matched by case-insensitive name (no slug anchor).
- Real server-side usage: `loadAgentInstructions` injects `You are acting as the "{name}" agent.\n{systemPrompt}` into the assembled chat system prompt.
- List/manage page: create/edit/duplicate/export/import/delete/enable-disable/activate, all wired to real handlers.

**Strengths:**
1. Full closed loop verified end-to-end: create → persist → select → composer defaults adopted → server injects into the real chat prompt.
2. Provider secrecy respected — `defaultModel` is a closed TypeScript union, no free-text model field anywhere.
3. No placeholder/demo data — genuine empty state, no seeded agents.
4. A shared `useAgentActions` hook centralizes "activate an agent" logic reused identically across surfaces.
5. Both themes structurally covered via CSS custom properties throughout.

**Weaknesses:**
1. `allowedTools`/`defaultProjectId` are fully plumbed through the schema but have zero UI — either an unfinished feature or misleading dead schema.
2. Name-only matching for the save-card update path can silently merge/overwrite differently-configured agents sharing a name.
3. `loadAgentInstructions` swallows all errors silently — an agent persona can silently drop from a response with no indication to the user.
4. Avatar field is a raw 2-character text input with no emoji picker/validation.
5. Imported/updated agent JSON isn't runtime-validated against `EFFORT_IDS`/`FORGE_MODEL_IDS`, allowing bad imported data to persist an invalid enum value.

## Memory feature
**What's included:**
- `POST /api/memory` performs session-boundary "memory distillation": auth-checked, validated, all early-outs (not configured, disabled, <4 messages, any error) return a silent `{ok:true, skipped:...}`.
- Fetches the conversation transcript scoped to `user_id`, builds a capped (40,000 char) transcript, asks the model to merge new durable facts into the existing memory profile or return `NO_MEMORY`.
- Persisted to `user_settings.memory_profile`, scoped by `user_id`.
- Fully wired into UI: triggered on conversation-boundary from `chat-view.tsx`, editable/toggleable in Settings, injected back into future prompts via `context-server.ts`, surfaced in the Instruction Inspector, and included in the data export.

**Strengths:**
1. Defense-in-depth authorization — every query scoped by the verified `user.uid`, never a client-supplied id.
2. Fails safe/silent by design, matching its own documented intent.
3. The distillation prompt explicitly avoids persisting sensitive one-off details or app-centric facts.
4. Genuinely wired end-to-end, not an orphaned backend route.
5. Reasonable safety caps (40k char transcript, ≥4 message minimum).

**Weaknesses:**
1. No verification that `conversationId` belongs to the caller beyond the `messages.user_id` filter — the sole authorization mechanism, no defense-in-depth via a separate conversation-ownership check.
2. No plan/tier gating in the route itself despite billing copy advertising tiered memory ("Basic" vs "Full") — any user with `memoryEnabled` gets full distillation regardless of plan.
3. Silent swallowing of all errors with no logging makes genuine bugs indistinguishable from intentional no-ops.
4. Client-triggered distillation is fire-and-forget with no retry/error handling — a failed distillation silently loses that session's update.
5. Memory is a single opaque free-text blob — the "edit/delete" billing claim is only partially true (full-text edit, no per-fact delete).

## Usage tracking & plan gates
**What's included:**
- Five plan tiers (`free`/`starter`/`pro`/`max`/`ultra`) with daily (free) or 5h+weekly (paid) token windows plus monthly feature counters (images/vision/searches/documents/voice/code executions).
- Feature/model gates: `canUseModel`/`canUseEffort`/`canUseThinking`/`canUseForgeCode`/`canUseFileSystem`/`getProjectLimit`.
- Enforcement: plan gates checked first (403), then `checkTokenLimit` (429) before the chat request proceeds.
- Post-request deduction computes `forgeTokens = realTokens * modelMultiplier * thinkMultiplier`, called via an atomic (`SELECT ... FOR UPDATE`) Postgres RPC only **after the full stream completes**.
- Client store/UI (`usage-indicator.tsx`, `usage-section.tsx`) render exclusively from a real `/api/data/usage` snapshot.

**Strengths:**
1. The deduction RPCs use real row-locking, making the deduction itself atomic against concurrent lost updates.
2. Consistent "fail open" philosophy — a Supabase outage degrades to unmetered access rather than blocking chat.
3. Window semantics (stale-counter-as-zero) implemented identically and independently in SQL, server pre-check, and client compute, with matching tests.
4. No placeholder data — UI renders exclusively from live counters.
5. Plan gates defined once and reused for both server enforcement and client UI locks.

**Weaknesses:**
1. **Race condition / quota bypass via check-then-act with no reservation.** `checkTokenLimit` reads counters once at request start; the actual deduction only happens after the full response streams (which can be tens of seconds to minutes for high-effort completions). Nothing reserves quota for in-flight requests — N concurrent requests all pass the same pre-request check and all deduct afterward, allowing multi-fold overspend of a cap like the free tier's 7,500 daily tokens.
2. First-ever request for a brand-new user auto-provisions a usage row and returns "allowed" unconditionally, compounding weakness #1 for a user's very first burst.
3. No pre-flight estimate of a request's likely cost against remaining quota — even a single very large `max`-effort request can overshoot the cap in one shot.
4. Zero test coverage for `lib/usage/check.ts`/`deduct.ts`/`lib/supabase/usage.ts` — the actual race-prone control flow is completely untested.
5. `getUsageContext` and `checkTokenLimit` each independently query Supabase per request rather than sharing one fetch — a minor latency inefficiency.

## Stripe billing
**What's included:**
- Webhook handler verifies `stripe-signature` correctly via `constructEvent` on the raw body; handles `checkout.session.completed`, `subscription.updated` (downgrade on unmapped status/price), `subscription.deleted` (force-downgrade).
- `app/api/stripe/debug/route.ts` — a fully unauthenticated GET endpoint exposing live-mode status, whether the webhook secret is set, all configured price IDs, and up to 20 active Stripe prices account-wide including internal nicknames. Comment says "TEMPORARY... DELETE THIS FILE."
- Entitlement mapping (`ENTITLED_SUBSCRIPTION_STATUSES`), env-driven price map with no hardcoded IDs, a `sync` route reconciling missed webhooks after checkout redirect.
- Checkout/portal routes are auth-gated and re-validate the price is active/monthly server-side.

**Strengths:**
1. Webhook signature verification is done correctly and safely.
2. `subscription-entitlement.ts` is a sound, small, well-tested single source of truth for status→entitlement.
3. `sync/route.ts` provides genuine reconciliation for missed/delayed webhooks, conservative about downgrading.
4. Price map is env-driven with no stale hardcoded IDs baked into source.
5. Checkout/portal are properly auth-gated with server-side re-validation.

**Weaknesses:**
1. **`app/api/stripe/debug/route.ts` is a real, unauthenticated production exposure** — no auth check, no admin check, no env gating, despite the comment claiming it's temporary and safe. This is live in production as shipped and should be deleted or gated before any real deployment.
2. Zero test coverage on the webhook, checkout, portal, or sync routes — only pure helper functions are tested, while the actual money+auth-handling code paths have none.
3. Reconciliation relies on the client visiting `/settings?upgraded=true` or the webhook firing — no scheduled/cron reconciliation job for a cancellation that misses both paths.
4. Displayed plan prices in `billing-section.tsx` are hardcoded UI copy independent of the actual Stripe `Price` objects resolved server-side, risking silent drift.
5. Any unhandled Stripe event type returns 400, which will cause Stripe to log/retry-alert on routine event types the app simply doesn't care about.

## Settings page
**What's included:**
- Appearance (theme toggle), Usage section, Plan & Billing (composes audited-elsewhere components) plus a defensive post-Stripe-checkout reconciliation effect (retries `/api/stripe/sync` once more after 3.5s since "the webhook is easy to misconfigure").
- Defaults (model/effort/thinking/tools), Forge Code build autonomy, Personalization (custom about/style), Memory & history (toggles + editable memory profile), Data & account (download all data, clear all chats, sign out).
- Deep-linking support scrolling to a section via URL hash.

**Strengths:**
1. Every toggle/select is a real, wired control with loading/success/error states — no dead UI.
2. The Stripe-return handling is unusually careful/defensive for a settings page.
3. Deep-link + scroll-to-section with stable ids is a nice touch.
4. The destructive "Clear all chats" action is gated behind a real confirmation dialog showing the live count.
5. Styling consistently uses CSS custom properties rather than hardcoded colors.

**Weaknesses:**
1. `clearAllChats` swallows individual delete errors silently and always shows a blanket success toast even on partial failure.
2. No true "Delete account" flow exists — only chat-clearing and a data export.
3. Pervasive inline `style={{...}}` objects instead of centralized Molten classes, inconsistent with the stated design-system convention.
4. Duplicated verbose inline style blocks for the effort/autonomy selects rather than a shared component.
5. No visible error/rollback handling if a simple toggle's `updateProfile` patch fails — could visually flip "on" and silently fail to persist.

---

# Shared Infrastructure & Design System

## Molten design system (CSS + component set)
**What's included:**
- Token architecture: `@theme inline` Tailwind bridge plus `:root[data-theme="light"]`/`:root[data-theme="dark"]` blocks covering bg/surface/border/text/amber/code/syntax/status colors.
- ~150 component class groups (buttons, chips, shell, chat/markdown/code, composer, menus/palette, toasts/modals, skills/agents, Forge Code IDE, billing) plus a large "motion polish" layer appended at the end of the file.
- `Toaster`, `ConfirmDialog`, `ConnectionStatus` (real online/offline listener), `CountUp`, `SuccessCheck`, `icons.tsx` — all confirmed genuinely wired in (not dead code).

**Strengths:**
1. Consistent token architecture — every light-theme token has a corresponding dark override.
2. Real state management in `toast-store.ts`/`confirm-store.ts` (Promise-based confirm() replacement), not stubs.
3. Accessibility is partially further along than CLAUDE.md's Phase-7 caveat suggests — `aria-live="polite"`/`role="status"` on toasts, `role="alertdialog"`/`aria-modal` plus Escape/Enter on the confirm dialog.
4. A real `prefers-reduced-motion` global override neutralizes the extensive motion-polish layer.
5. `connection-status.tsx` is driven by real browser events, not a placeholder indicator.

**Weaknesses:**
1. **Confirmed CSS variable bug** — `--surface-2` is referenced (`.dock-build-bar`) but never defined in either theme's token block, resolving to an invalid/unset custom property in both themes.
2. Duplicate/colliding class names: `.artifact-icon` and `.artifact-meta` are each defined twice with materially different specs for two different components — a real cascade-collision risk, not just a documented deviation.
3. Accessibility is still meaningfully incomplete despite the partial credit above — no focus trap, no return-focus-to-trigger, no scroll lock on modals/menus/palette.
4. Scale/maintainability — a single 5,435-line CSS file with only loose comment banners for organization; the duplicate-class-name bug is direct evidence this isn't being caught.
5. Two accumulated "motion polish" waves retroactively bolt extra rules onto components already defined earlier, splitting a component's full visual behavior across 2-3 non-adjacent locations.

## Theme system (cookie-driven, no-flash)
**What's included:**
- Pre-paint inline script (`lib/theme.ts:31-36`) injected into `<head>` before `<body>` renders, reads the `forge-theme` cookie, resolves `system` via `matchMedia`, sets `data-theme` before first paint.
- Server-side cookie read in `app/layout.tsx` computes `ssrTheme` for the initial HTML.
- Default is `"light"`, centralized in one constant consumed identically by server, client store, and the inline script's own fallback.
- `ThemeApplier` re-applies on every pref change, writes the cookie (`document.cookie`, no `Secure` flag), subscribes to `matchMedia` changes for live "system" updates.
- Theme is deliberately excluded from Zustand's `localStorage` persistence — the cookie is the single source of truth.

**Strengths:**
1. The inline script is a genuinely synchronous `<head>` script — the no-flash claim is structurally correct for explicit light/dark prefs.
2. Default is unambiguous and centralized with no drift across the three call sites.
3. Cookies-disabled/first-visit paths degrade cleanly to the light default on both server and client.
4. Single write path with no competing localStorage override.
5. `try/catch` around the inline script with a hardcoded fallback ensures a deterministic default even on script exceptions.

**Weaknesses:**
1. **SSR does not honor system preference at all** — a `"system"` cookie always server-renders `data-theme="light"`; correctness depends entirely on the client inline script running before paint, so a no-JS or CSP-blocking-inline-scripts user with a dark OS gets a permanent light flash.
2. No CSS-only `prefers-color-scheme` fallback exists to cover the no-JS/CSP-blocked case — the "no flash" guarantee is conditional, not architecturally guaranteed.
3. Cookie write has no `Secure` flag and no server-side `Set-Cookie` fallback if a browser blocks JS cookie writes.
4. Redundant reconciliation — `ThemeHydrator` re-sets the pref on every mount even though the store already reads the identical cookie at creation time.
5. No automated test coverage for the theme bootstrap logic — relies entirely on manual/visual QA.

## App shell (sidebar, mode-switcher, topbar)
**What's included:**
- Mode switcher is a fully working, real toggle (not merely a "scaffold" as CLAUDE.md's phrasing suggests) — derives active mode from pathname, animates a sliding thumb, plan-gates Code mode with a lock icon and upgrade flow.
- Sidebar renders differently per mode: Code mode shows recent projects; Chat mode shows a live-search, date-bucketed conversation list with per-item delete.
- Topbar: shared frame with mobile hamburger/desktop collapse, chat-specific title rename/delete/export-as-markdown.
- Account row: usage meter, theme switcher, links, plan badge, sign-out.
- Responsive: off-canvas mobile drawer with scrim-to-close; `Ctrl/Cmd+B` toggles collapse/drawer depending on viewport.

**Strengths:**
1. Mode switcher is genuinely wired to routing/state, not a stub.
2. Sidebar content is 100% live data with proper loading/empty states.
3. Thoughtful mobile handling — dedicated drawer, scrim, auto-close on navigation, viewport-aware shortcut behavior.
4. Account menu is unusually complete for a "Phase 1" shell.
5. Mode derivation is resilient to direct URL navigation via independent re-derivation in multiple components.

**Weaknesses:**
1. Redundant/fragile mode detection — three components each independently re-derive mode from pathname rather than a single shared selector.
2. `sidebarCollapsed` persists to `localStorage` (not a cookie), so a fresh SSR load can flash the expanded sidebar before rehydration — the same class of flash issue solved for theme but not for layout.
3. No persistent affordance to re-expand a fully collapsed desktop sidebar besides the keyboard shortcut.
4. Code-mode project list lacks the chat sidebar's search/filter and delete affordance — an inconsistency between two variants of the same list UI.
5. Account photo `<img>` has no error/fallback handling if the URL 404s.

## Command palette + keyboard shortcuts
**What's included:**
- Global `⌘K`/`Ctrl+K` toggle and `?` for shortcuts; every palette command is a real handler (navigation, mode switch, theme, sign-out, instruction inspector) — no no-ops.
- Naive case-insensitive substring filtering, no fuzzy matching.
- Every shortcut documented in the cheat-sheet was cross-referenced and confirmed to have a real, working binding elsewhere in the codebase.

**Strengths:**
1. Every documented shortcut has a verified real handler — no aspirational/orphaned entries found.
2. All palette actions are real handlers, no placeholder commands.
3. Thoughtful platform handling (⌘/Ctrl, ⌥/Alt labels derived from `navigator.platform`).
4. Basic accessibility present (`role="dialog"`, `aria-modal`, Escape-to-close, autofocus).
5. Both themes supported for free via CSS custom properties.

**Weaknesses:**
1. Filtering is plain substring matching with no fuzzy/typo tolerance or relevance ranking.
2. No ARIA combobox/listbox pattern — active-item state is purely visual, a real gap for screen-reader users.
3. No focus trap inside the palette — Tab can leave the dialog into the underlying page.
4. The documented `/` "shortcut" is actually just textarea content-watching, not an intercepted keystroke — conceptually different from the other listed shortcuts and could mislead users.
5. The shortcuts sheet is a static hand-maintained list with no mechanism tying it to the real keydown handlers — future binding changes have no link back to this display list.

## Data layer / Supabase backend infrastructure
**What's included:**
- `lib/supabase/client.ts` — public anon-key client, exported but **never imported anywhere** in the codebase; dead-by-design.
- `lib/supabase/server.ts` — service-role admin client used by every `/api/data/*` route.
- `supabase/schema.sql` enables RLS on all 13 tables with **zero `CREATE POLICY` statements** — RLS-enabled-with-no-policies blocks the (unused) anon client entirely; authorization is actually enforced by `requireUser` + service-role queries scoped to `user_id`.
- `requireUser` is confirmed as the first statement in all 23 `/api/data/**` route handlers.
- `lib/data/realtime.ts` is **not Supabase Realtime** — no `.channel()`/`postgres_changes` usage anywhere; it's 10s polling + optimistic cache writes.
- `lib/files/filestore.ts` — real Firebase Storage as the primary binary-blob backend, falling back to base64 chunks in a Supabase table only if Storage is unavailable.

**Strengths:**
1. Total separation of concerns — all mutable data access is server-only through the service-role client; the anon client is provably dead code.
2. `requireUser` is a single well-designed choke point, fails safe on missing config/invalid token, used by every route with no bypass found.
3. Authorization derives the uid exclusively from a server-verified Firebase ID token, never a client-sent uid.
4. Defense-in-depth is present even though redundant today — RLS-enabled-with-no-policies would block the anon client even if it were ever wired up by mistake in the future.
5. Usage/token-accounting RPCs are deliberately non-blocking/non-throwing, a sound choice for a side channel that must never break the chat response path.

**Weaknesses:**
1. **Critical discrepancy — `firestore.rules` describes a security model the app doesn't use.** `firestore.rules` implements a fully worked-out `users/{uid}/**` per-user model, but there is zero Firestore usage anywhere in the app (`getFirestore`/`onSnapshot` — 0 matches repo-wide). It is dead configuration securing a database the app doesn't write app data to, directly contradicting CLAUDE.md's stated stack. `storage.rules`, by contrast, **is** still live, since Firebase Storage remains the primary blob backend.
2. `lib/data/realtime.ts` is misleadingly named — it's polling, not push-based Realtime; cross-tab/device updates can lag up to ~10s.
3. `dbError`, the documented standard error-mapping helper in `route-helpers.ts`, is never actually called from any route — each route hand-rolls its own error responses inconsistently.
4. Stale comments in `lib/data/types.ts` still describe "Firebase Storage object path"/"users/{uid}/files" security-rules language left over from the pre-migration design.
5. `ensureUserRows` synthesizes a placeholder email (`{uid}@placeholder.forge`) for phone-auth users with no downstream guard/flag if a code path assumes `email` is always real.

## Instruction inspector (internal debug tool)
**What's included:**
- A client modal ("Active instructions") that POSTs the user's live composer state to `/api/inspect`, which re-runs `assembleSystemPrompt()` with real user/project/agent context and returns the exact, unredacted system prompt string the model would receive.
- Reachable in production: mounted unconditionally in `AppShell` and exposed as an ordinary command-palette action to any signed-in user.
- Auth check is only "is this a valid Firebase ID token" — no role/admin/dev check anywhere in the route or component.
- Zero "deepseek" references in either owned file — whatever leaks is limited to whatever `assembleSystemPrompt()`'s output itself contains, passed through unredacted.

**Strengths:**
1. Server-side auth is enforced correctly at the token-verification layer, with strict zod input validation.
2. No placeholder/demo data — always calls the real assembly function with real live context.
3. Clear, honest labeling in the UI and code comments about what the feature does.

**Weaknesses:**
1. **No access-control gate beyond "is signed in."** Any regular authenticated user can open "Inspect active instructions" from the command palette and retrieve the full unredacted assembled system prompt — including project instructions, FORGE.md, custom instructions, memory content, and full skill instructions — with zero special privilege. This is a real internal prompt-engineering/config exposure to the general user base, not a properly gated debug tool.
2. The route returns `assembleSystemPrompt()`'s output completely unfiltered — no allowlist/stripping step guarantees provider-identifying strings or other internal-only directives can never leak through if ever added to the template.
3. The feature is framed as "full transparency" but ships with no user-facing indication that it exposes internal prompt-assembly mechanics that a typical product would keep as an implementation detail — reads like a debug/dev tool left wired into the production command palette.

---

# Forge Code (in-progress phases)

## Forge Code gallery & project data
**What's included:**
- Gallery renders a live grid backed by real Supabase-backed `useProjects()`; per-project cards with gradient thumbnail, icon, name, language, file count, relative time, delete with confirm.
- Plan gating locks the whole page behind an upgrade CTA and caps project count.
- New Project modal collects a name and a starter selection from 5 real, functional starters (blank/HTML/React/Vue/Python) — genuinely working boilerplate, not stubs.
- Every project/file route double-scopes queries by `user_id` and resource id — no cross-tenant path found.

**Strengths:**
1. Zero seeded/demo data — gallery is 100% real Supabase rows with a text-only empty state.
2. Starters are genuinely functional boilerplate that render a real working page immediately.
3. Consistent multi-tenant authorization across all three route files.
4. Thoughtful delete ordering avoids orphaned files given the FK's `ON DELETE SET NULL`.
5. Theme handling is structurally correct via semantic CSS custom properties.

**Weaknesses:**
1. Thumbnails are just CSS gradients + a static icon, not real project previews — every card for a given starter looks identical.
2. Empty state is minimal (one line of muted text) — thinner than CLAUDE.md's "polished empty states" language implies.
3. Project creation inserts the project row and files rows as two separate non-transactional calls — a failure after the project insert leaves a broken/empty project with no rollback.
4. Unrecognized starter ids silently fall back to "blank" rather than erroring, potentially masking a UI bug.
5. The `blank`/`python` starters are literally empty files, contradicting the same file's own comment about opening to "a visible 'your new project' page."

## Forge Code IDE (file tree, editor, storage, preview)
**What's included:**
- File tree with tree/grid views, create/rename/delete/duplicate/drag-move, OS drag-drop import.
- Monaco editor with custom light/dark themes, ~30 mapped languages, multi-tab editing, debounced (800ms) autosave, Ctrl+S.
- Live preview for static web/React/Vue projects via in-browser esbuild-wasm bundling, resolving relative imports against the virtual file map.
- Binary/blob storage: Firebase Storage primary, base64-chunk Supabase fallback.
- `lib/code/path-safety.ts` rejects empty/absolute/drive/UNC/URL-scheme/home-relative/`..`/control-char/over-long/over-deep paths, unit-tested.
- Binary viewer for images/SVG/PDF with a download fallback.

**Strengths:**
1. The live-preview iframe is correctly sandboxed for the common case — `allow-same-origin` deliberately omitted, giving generated docs an opaque origin.
2. `checkWritePath`/`filterSafeOps` is a solid, well-tested pure function covering drive paths, UNC paths, URL schemes, and depth/length abuse.
3. Monaco integration is real, not a minimal wrapper — custom themes, per-language detection, multi-tab dirty tracking, debounced autosave.
4. Preview engine handles three different project shapes with actual in-browser bundling, not a canned template.
5. No placeholder data anywhere — empty states are real, not seeded example files.

**Weaknesses:**
1. **"Open in new tab" bypasses the iframe sandbox entirely.** `preview-pane.tsx` calls `window.open("", "_blank")` then `document.write(srcDoc)` — the same AI-generated HTML/JS that's safely opaque-origin-sandboxed in the iframe is instead written into a plain, un-sandboxed popup that inherits the opener's origin. Any script in that page can read/write the app's `localStorage`/cookies and, since `noopener`/`noreferrer` aren't used, reach back into `window.opener` to manipulate the real app window — exactly the session-hijack risk the sandboxed iframe exists to prevent, one click away. **Top issue in this feature.**
2. **Path-safety enforcement is client-side only, at a single call site** (`build-dock.tsx`). `writeFilesByPath` itself does no validation, and the server file routes accept any client-supplied path/projectId with only a `user_id` ownership check — no path or project-membership validation, and `file-tree.tsx`'s own rename/move/create actions never call `checkWritePath` either.
3. Binary file storage is effectively dead/incomplete — `FileStore.put` (the only path that sets `storagePath`/`chunked`) is never called anywhere; the only import path reads all dropped files as UTF-8 text, corrupting any real binary dropped into the tree.
4. No size/quota enforcement on the chunk-fallback path — unlike the ~900KB inline-content guard for AI writes, there's no equivalent ceiling for the blob path.
5. The PDF viewer's `<iframe>` has no `sandbox` attribute, inconsistent with the otherwise-careful sandboxing posture elsewhere.

## Build dock, build plan & streaming
**What's included:**
- Plan phase parses a `forge-plan` JSON block, gated behind an autonomy setting (auto/plan/step) requiring user approval.
- Streaming protocol parser scans for `path=`/`edit=` fenced blocks, stripping all code from visible narration.
- Genuine targeted-diff editing (`build-edits.ts`): parses SEARCH/REPLACE hunks with an exact-match-then-whitespace-tolerant-fallback strategy — not whole-file-rewrite-only.
- Write-safety guards reject truncated or "destructive" (≥12-line file collapsed to ≤3 lines / <20% original length) full-file writes.
- Post-write re-read verification (`persistedAppliedOps`) only counts a path as applied if storage actually reflects what was sent.
- Checkpoint-before-write, then a bounded self-correction loop (cycle/token-budget/wall-clock/stagnation caps) with an honest final summary distinguishing truncated/claimed/applied outcomes.
- Model override confirmed: build mode always forces `magnum-2.8` regardless of the user's selected model.

**Strengths:**
1. Edit mode is a real, load-bearing search/replace diff engine, not rewrite-only, with tests proving both success and graceful failure.
2. Strong anti-silent-failure design — truncated/destructive-write detection, post-write verification, and an honest summary rather than always claiming success.
3. Bounded, budget-aware self-correction loop prevents runaway "spin without converging" builds.
4. Checkpoint-before-write gives a real rollback point before any file is touched.
5. Test suite covers genuine production-relevant edge cases (unterminated fences, cumulative multi-block resolution) referenced by name in code comments.

**Weaknesses:**
1. Same Firestore-vs-Supabase CLAUDE.md mismatch as elsewhere.
2. A 1,620-line single client component houses the entire orchestration state machine — correctness-critical logic this large in one file is hard to unit-test directly; only the extracted pure modules are tested.
3. The edit-hunk matcher's string-replace has no protection against a SEARCH string matching multiple locations, with no test for the ambiguous-match case.
4. **The strict verifier/fixer self-correction loop is gated behind a hardcoded `shouldRunStrictRequestReview = false`** — permanently disabling the most sophisticated review/fix cycle in current production behavior, leaving only the simpler runtime-only auto-heal active. (See also: Build verification suite, below.)
5. Failure surfacing is textual-only with no one-click "restore checkpoint" affordance visible from this component.

## Code execution / runner / sandbox
**What's included:**
- Real remote sandbox execution via E2B (`Sandbox.create`/`runCode`), always `kill()`ed in a `finally` block — genuine isolated execution, not local eval.
- Auth required; plan-gated (free/starter get 0 executions; paid tiers get monthly caps enforced against a persisted counter).
- 30s execution timeout; stdin-need detection short-circuits before ever creating a sandbox for scripts that would hang without input.
- Graceful "unavailable" mode with no fake/simulated output if `E2B_API_KEY` is unset.
- Error normalization strips raw E2B internals into friendly messages, no stack traces leaked.

**Strengths:**
1. Execution genuinely happens in an isolated remote sandbox, always torn down, not local eval.
2. "E2B" is confined entirely to the server-only runner file and its test — zero client-visible occurrences.
3. Free/starter tiers are hard-gated to zero executions; paid tiers have real enforced monthly caps — meaningful anti-abuse control for arbitrary code execution.
4. Auth is mandatory and server-verified, not client-trusted.
5. The live-preview iframe correctly omits `allow-same-origin`, and the storage shim is well-reasoned and tested.

**Weaknesses:**
1. **No per-request/per-minute rate limiting, only a monthly counter** — a paid user can burst all monthly executions in seconds with no cooldown or concurrency cap, a real DoS/cost-abuse vector against the E2B billing account.
2. No output size cap — stdout/stderr are returned as-is with no truncation, risking memory/bandwidth abuse.
3. Check-then-increment monthly-limit enforcement is not atomic — concurrent requests can all pass the check before any increment lands, exceeding the cap via parallel requests.
4. `incrementUsage` runs regardless of execution outcome — even unavailable/failed executions consume a quota unit.
5. The sandbox-shim's in-memory storage polyfill is unbounded in size, though scoped only to the previewing tab's memory.

## Checkpoints
**What's included:**
- Full-file-content snapshot per checkpoint (not diff-based), auto-created before every AI build plus manual "save now."
- List endpoint is metadata-only; single-checkpoint fetch includes full file content.
- Restore writes back all snapshot files and deletes any file not present in the snapshot — a true rollback, not a partial overwrite.
- Server-side pruning caps each project at 30 checkpoints, enforced on every insert independent of client trust.
- Every route scoped by `user_id`.

**Strengths:**
1. Genuine end-to-end restore including deletion of files that didn't exist at snapshot time.
2. Storage growth is bounded server-side rather than left to client trust.
3. List/detail split (metadata vs. full snapshot) is a sensible size optimization for a polling UI.
4. Auth properly scoped on every route — no cross-tenant read/write by guessing an id.
5. An oversized-project guard prevents pathological writes with a clear user-facing message.

**Weaknesses:**
1. Full-content-per-row snapshotting means up to ~27MB per project across 30 checkpoints near the size cap, with no dedup of unchanged files between consecutive checkpoints.
2. Prune-after-insert is a second round-trip with no transaction tying insert+prune together — a race under concurrent checkpoint creation could over/under-prune.
3. Restore is not atomic — write phase and delete phase are separate, so an interruption between them can leave the project in a mixed state.
4. Silent failure swallowing on delete and per-file restore errors gives no user-facing signal of partial failure.
5. No diff/preview before restore — the user sees only label/kind/file count/timestamp, with a generic overwrite warning.

## Build verification suite
**What's included:**
- Fabrication detection (`lib/code/fabrication.ts`) catches placeholder markers (`// ...1995 more words`) and claimed-dataset-size vs. actual-content mismatches, with an explicit escape hatch for legitimate runtime `fetch`.
- Rename-consistency backstop scans for stale old-term leftovers after a rename request.
- A strict-LLM-verdict schema (`verdict.ts`) with severity/category normalization, forcing `status="fail"` whenever any issue is present regardless of the model's self-report.
- Implied-checks infers unstated acceptance criteria (e.g. for game/physics requests) and generates runtime smoke-test assertions.
- The actual runtime verification engine (`lib/code/verify/`) genuinely executes the assembled project in a sandboxed iframe, capturing real `window.onerror`/console errors and DOM state, plus static reference/compile checks via esbuild.
- All wired into and called from `build-dock.tsx`.

**Strengths:**
1. `runtime-probe.ts` is genuine dynamic verification (executes real DOM state and scripted smoke assertions), not just static analysis despite living next to "static-checks.ts".
2. `fabrication.ts`'s detector correctly avoids false-flagging code that demonstrably loads data via runtime fetch/import.
3. `verdict.ts`'s pass/fail logic deliberately overrides a model's self-reported "pass" if any issues are present, with dedicated tests.
4. Failure-recovery prompting routes large truncated files to small edit-hunks instead of a full re-emit, avoiding a doom loop.
5. Test coverage across all 6 files is specific and scenario-driven, not superficial.

**Weaknesses:**
1. **The strict LLM Verifier is built, tested, and wired but never actually executes.** `build-dock.tsx` hardcodes `const shouldRunStrictRequestReview = false;` with no other assignment anywhere — the entire cycle-based Verifier→Fixer loop (strict diff-aware review, convergence/stagnation guards) is permanently dead at runtime; only the simpler deterministic compile+runtime-probe auto-heal loop actually runs today. The "enforceable gate" described in the code's own header comment is currently vibes-only in production.
2. The fabrication heuristic's dataset-size detection is narrowly scoped to one vocabulary domain (words/guesses) and would miss fabrication of other large-dataset types.
3. Compile-check coverage silently degrades to zero if esbuild is unavailable, with no visible signal to the user that verification was skipped.
4. Implied-check intent detection is pure keyword matching scoped only to a game-like archetype — genuinely game-like requests phrased without the trigger words get zero implied checks.
5. Reported issues are silently capped at 20 with no indication to the caller that more were truncated.

## Export functionality
**What's included:**
- `lib/code/export.ts` — client-side single-project zip export (real file paths/content via JSZip), plus a separate publish-to-web flow.
- `lib/export.ts` — account-wide "download all my data" export (conversations as markdown+JSON, files, projects, skills, memory) and single-conversation markdown export, backed by `GET /api/data/export` which scopes every query to the verified uid.

**Strengths:**
1. Real, non-placeholder content throughout — actual DB rows via typed mappers, not seeded data.
2. Auth is solid — server-verified uid, every query scoped by `user_id`.
3. Reasonably complete data coverage for the account-wide export.
4. Filenames are sanitized before use as zip paths/download names.

**Weaknesses:**
1. No size/rate limiting on the export route — an unbounded read of all conversations/messages/files/projects/skills with no pagination or cooldown.
2. The entire account-wide zip is built client-side after one unbounded JSON response — a memory/perf risk for large accounts, and a larger exposure window than server-side streaming would be.
3. The file manifest includes metadata for every file regardless of whether its content was actually inlined — non-inline/binary files appear as metadata-only with no note that the export is silently incomplete for them.
4. `downloadProjectZip` has no authorization check of its own — its safety depends entirely on the caller having fetched files through an authorized channel.
5. No guard against generating an empty zip for an empty account/project.

## Forge Code plan gating & upgrade prompts
**What's included:**
- `forge-code-config.ts` — a fixed 384,000-token output ceiling applied to every Forge Code call regardless of plan/effort, plus per-effort agent-tuning knobs (timeout, self-correct iterations, token budget, retrieval limits) that scale monotonically — these are cost/depth controls, not plan-access gates.
- `ForgeCodeUpgrade` component — static feature checklist and CTA linking to `/settings#billing`, correctly using the public model alias ("Magnum 2.8").
- Actual plan-access gating (`canUseForgeCode`, project limits) lives in `lib/plans/gates.ts`, correctly not duplicated here.

**Strengths:**
1. Numbers are real and non-trivial, scaling sensibly and monotonically across five effort tiers, verified by tests.
2. Deliberate separation of concerns — this file governs work-per-build depth, not plan-level access.
3. The upgrade CTA correctly uses the public-safe model alias and theme-token-driven styling.
4. A test explicitly guards that no profile field encodes an output/token cap, enforcing a documented policy.
5. Hard ceilings exist on `buildTokenBudget`/`maxCorrectivePasses`, with `selfCorrectIterations` tested to never exceed 4.

**Weaknesses:**
1. The upgrade CTA shows no actual pricing and no direct Stripe checkout link — both buttons just navigate to Settings, an extra hop before completing an upgrade.
2. The component is entirely static/prop-less — it can't say "upgrade to Max" if that's what's actually required, since it doesn't know which tier the gate determined was needed.
3. No test coverage for `forgeCodeEffortProfile`'s fallback behavior on invalid input.
4. Two of nine profile fields (`planTimeoutMs`, `retrievalNeighborDepth`) have no monotonicity test.
5. No visual/theme-specific test for the upgrade component beyond inferred token usage.

## Forge Code build utilities (diff, snippet, retrieval)
**What's included:**
- `lib/code/diff.ts` — pure, dependency-free line-based unified diff generator (LCS-based) with hunk grouping, a 400-line emit cap, and a 24,000-byte prompt budget; falls back to a coarse diff for very large file pairs.
- `lib/code/retrieval.ts` — keyword + structural ranking (not embedding-based): exact path mentions, keyword overlap, entry-point boosts, reference-graph proximity via regex-parsed imports. Always emits the full file tree; inlines top-ranked files within a byte budget and reduces the rest to a signature with an explicit "ask to see it in full" note — never silently drops a file.
- `lib/code/snippet.ts` — chat code-block helpers (language/extension mapping, previewable/artifact detection, `wrapPreviewDoc` which always runs generated HTML through the storage shim).

**Strengths:**
1. Both diff and retrieval modules are genuinely pure/dependency-free, cheaply unit-testable.
2. Retrieval never silently drops a file — always inlines or signature-summarizes with an explicit "ask to see it in full" instruction, verified by tests.
3. Diff generation has real cost guards — DP fallback above a size threshold, capped hunk emission and prompt byte budget.
4. The storage-shim injection in `wrapPreviewDoc` is a well-reasoned, well-documented, idempotent fix for a specific real failure mode.
5. Test suites cover core positive-path behaviors for all three modules reasonably well.

**Weaknesses:**
1. `splitLines` only splits on `\n` with no CRLF normalization — a CRLF/LF mismatch between before/after would register every line as changed, untested.
2. The existing "respects the byte cap" test never actually exercises the cap — the truncation/omission branch has zero test coverage.
3. Neither the large-file DP fallback nor the hunk-level truncation path is exercised by any test, despite both being called out as deliberate safety guards.
4. Retrieval's recency/structural boosts have no dedicated test, nor does malformed/duplicate-path or zero/negative-budget input.
5. The hunk-boundary backward rescan isn't independently capped — a latent quadratic-time edge case for sparse-change files that the current dense-change test fixtures wouldn't catch.
