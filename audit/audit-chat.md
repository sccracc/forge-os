# Forge Chat Conversational Engine — Feature Audit

Scope: `lib/ai/*`, `app/api/chat/route.ts`, `app/api/title/route.ts`, `hooks/use-chat-send.ts` and
related chat hooks, `lib/store/composer-store.ts` / `stream-store.ts`, and `components/chat/**`,
plus everything these files import/touch (`lib/ai/tools.ts`, `lib/ai/skill-execution.ts`,
`lib/ai/skill-suggestions.ts`, `lib/data/tree.ts`, `lib/data/attachments.ts`,
`lib/auth/server-auth.ts`, `app/api/suggest-skill/route.ts`, `lib/usage/compute.ts`,
`lib/plans/gates.ts`). All files were read in full before judgment.

---

## Streaming engine, tool-calling agent loop & continuation

**What's included:**
- SSE-less NDJSON streaming: the provider's OpenAI-compatible SSE stream is parsed line-by-line and re-emitted as newline-delimited JSON (`lib/ai/provider.ts:255-328`, `lib/ai/types.ts:126-128`), decoupling the wire format from the underlying provider's format.
- A single agent loop (`streamForgeCompletion`, `lib/ai/provider.ts:349-451`) handles two orthogonal concerns with one state machine: (1) tool calls — execute, feed results back, keep streaming in the same bubble (`provider.ts:397-434`), and (2) output-length continuation — transparently resumes when `finish_reason === "length"` (`provider.ts:436-439`).
- `MAX_ROUNDS = 8` is a combined safety cap shared by tool-call rounds and length-continuations (`provider.ts:10,364`).
- Reasoning (thinking) text is captured every round but only *emitted* to the client on the first turn (`emitReasoning = firstTurn && opts.thinking`, `provider.ts:365,374`), preserving a single "thinking timer" even across multi-round tool loops.
- Reasoning is replayed to the provider (`reasoning_content`) only for the assistant turn that made a tool call (`toProviderMessages`, `provider.ts:88-91`), per the documented DeepSeek constraint (§9).
- Tool-call argument deltas are accumulated by index across SSE chunks (`toolAcc`, `provider.ts:253,301-309`) and only finalized once both `id` and `name` are present (`provider.ts:329`).
- Per-round token accounting (`completionTokens`, `promptTokens`, `reasoningTokens`) is summed across every round into the final `done` event (`provider.ts:391-393,444-450`).
- Route layer (`app/api/chat/route.ts:410-532`) turns provider events into wire events: `reasoning`, `content`, `status` (search), `image`, `done`, `error` — never leaking provider event shapes.
- Multiple tool calls returned in one round are executed sequentially, each yielding its own `tool_start`/`tool_end` pair (`provider.ts:413-431`).
- Abort is wired end-to-end: client `AbortController` → fetch `signal` → route's own `AbortController` tied to `req.signal` (`route.ts:214-215`) → passed into `streamForgeCompletion`/`postProvider` (`provider.ts:181`).
- On abort mid-stream, the client persists whatever partial answer had accumulated so it stays editable/regenerable (`use-chat-send.ts:469-497`).
- `generateText` (`provider.ts:454-466`) reuses the same `postProvider` plumbing (and its fallback ladder) for non-streaming single-shot calls (titles, collapse summaries, skill suggestions).

**Strengths:**
1. One code path serves both "plain chat" and "tool-augmented chat" — `canUseTools` (`provider.ts:362`) is the only branch, so non-tool requests are provably unchanged (explicitly called out in a comment, `provider.ts:347`).
2. The reasoning-replay rule (`hadToolCall` gate, `provider.ts:88-91`) is unit-tested directly (`tests/message-assembly.test.ts:11-21`).
3. Provider secrecy is verified at the message-assembly level, not just the label level — `tests/message-assembly.test.ts:23-26` asserts `"deepseek"` never appears in assembled wire messages.
4. Thinking-timer semantics (`emitReasoning` only on `firstTurn`) correctly avoid restarting the "Thinking…" UI on every tool round, which would look broken.
5. Streaming reader loop buffers partial lines correctly (`buffer.indexOf("\n")`, `provider.ts:261-263`) — never assumes a chunk boundary aligns with an SSE event boundary.
6. Reasoning field name is normalized across two provider dialects (`reasoning_content` vs `reasoning`, `provider.ts:290`), a small but real robustness feature.
7. `[DONE]` sentinel is explicitly ignored rather than mis-parsed as JSON (`provider.ts:266`).
8. The tool loop's `baseContext` cleanly grows in DeepSeek's expected shape (assistant tool_calls turn → tool-role result turns) without polluting the client-visible content stream.
9. Cancellation is cooperative all the way down (`ReadableStream.cancel()` → `ac.abort()`, `route.ts:529-531`), so a client-side Stop button actually stops the upstream fetch, not just the UI.
10. Token accounting distinguishes `completionTokens` from `reasoningTokens` (`provider.ts:249-251,391-393`), enabling correct downstream billing math.
11. `runtime = "nodejs"` and `maxDuration = 300` (`route.ts:44-45`) are explicit, not left to framework defaults, for a route that legitimately needs a long-lived stream.
12. The route never re-throws provider errors verbatim to the client; every failure path is normalized through `friendlyError` (`route.ts:60-73`).

**Weaknesses:**
1. **Tool results can be stranded and billed with no answer.** If the model's tool call happens to land on the very last permitted round (`round === MAX_ROUNDS - 1`), the tool branch still executes (search/image is actually called, `provider.ts:398-434`), `answer` is reset to `""` and the loop `continue`s — but the `for` loop's own bound (`round < MAX_ROUNDS`) then exits with no further round to let the model use that result. The client receives a completed `tool_end` (and, for images, a fully rendered image card) but no assistant text ever explains or uses it, and `incrementUsage` (`route.ts:513-518`) still bills the search/image against the user's monthly quota. This is a real, reachable dead end, not a hypothetical.
2. **Silent truncation with no user-facing signal.** `finishReason` ("length", "tool_calls", etc.) is threaded all the way to the `done` wire event (`types.ts:115-124`, `route.ts:479-483`) but no client code (`use-chat-send.ts:412-419`, `message.tsx`, `streaming-message.tsx`) ever reads `ev.finish`/`ev.t==="done"`'s finish reason to warn the user that an answer was cut short. A Max-effort answer that hits `MAX_ROUNDS` mid-continuation looks identical, in the UI, to one that finished cleanly.
3. **`MAX_ROUNDS = 8` may not reach the advertised 384,000-token "Max effort" ceiling.** The tiered fallback ladder in `postProvider` (`provider.ts:190-198`) itself assumes the provider's *real* per-call output ceiling can be as low as 16,384 or 8,192 tokens (that's why the ladder exists at all). If a request lands on one of those lower tiers, reaching 384,000 total tokens via length-continuation would need on the order of 24-48 rounds — far beyond the shared 8-round budget — so "Max effort" can under-deliver relative to its own configured `maxTokens` (`effort.ts:25`) with no diagnostic.
4. **Sequential tool execution.** Multiple tool calls in one round are awaited one at a time in a `for` loop (`provider.ts:413-431`) rather than run concurrently, adding latency when, e.g., two independent `web_search` calls are requested together.
5. **`hadToolCall` is effectively dead on the persistence path.** The schema/plumbing for replaying `reasoningContent` on tool-call turns (`types.ts:10-11`, `use-chat-send.ts:202-203`) is exercised only *inside* one `streamForgeCompletion` call; the client's `addMessage(...)` calls that persist the final assistant turn (`use-chat-send.ts:444-462`, `733-773`) never set `hadToolCall: true` on the persisted `MessageDoc`, even when a tool was used mid-turn. The Supabase column (`had_tool_call`, `lib/supabase/mappers.ts:124,154,178`) and the wire schema field exist but are never written `true` from the app, so cross-turn history never carries this flag (harmless today because flattened history doesn't need it, but it's a maintenance trap for whoever assumes the field is populated).
6. **No visibility into which round a continuation/tool round is on.** There's no cap-approaching warning or telemetry hook when `round` nears `MAX_ROUNDS`; a silent `break` is the only outcome (`provider.ts:441`).
7. **`console.warn` is the only signal on tiered 400 fallback** (`provider.ts:209`) — no structured logging/metric, so repeated silent downgrades (e.g. always landing on the 16k tier) would be invisible in production monitoring.
8. **Tool-call JSON parse failures are silently swallowed to `{}`.** `JSON.parse(call.arguments)` failures fall back to empty args (`provider.ts:414-419`) with no error surfaced to the model or user — a malformed `generate_image` call would silently execute with an empty prompt (`tools.ts:159,169-176` does catch the empty-prompt case, but only by coincidence of that particular tool's own validation).
9. **`answer` accumulation math is easy to break on refactor.** `answer` is reset to `""` after a tool round but the *client-visible* content (`stream-store.appendContent`) is a totally separate accumulation that never resets — the two "answer" concepts (server-internal continuation buffer vs. client-visible transcript) share no type or naming convention, which is a latent confusion for future maintainers (verified by diffing `provider.ts:432` against `stream-store.ts:86-107`).
10. **`generateText` (non-streaming path) has no round/continuation logic at all** — a single call, no tool loop, no length-continuation (`provider.ts:454-466`). Title/collapse/skill-suggestion calls are low-effort/short so this is low risk today, but the asymmetry with the streaming path is undocumented.
11. **No per-round timeout separate from the overall `maxDuration=300`.** A single slow/hanging upstream round could consume the entire 300s budget before any fallback logic engages (fallback only triggers on HTTP 400, not on slow-but-eventually-200 responses).
12. **Tests cover the reasoning-replay rule but not the round-cap or tool-stranding behavior** — `tests/message-assembly.test.ts` and `tests/streaming.test.ts` exercise message shape and store accumulation, but nothing exercises `streamForgeCompletion`'s round-exhaustion path end-to-end.

**Fixes:**
- In `streamForgeCompletion`, reserve at least one trailing round after any tool-call round so a tool result is never stranded — e.g. change the loop bound so a tool-call executed at `round === MAX_ROUNDS - 1` is either deferred (tool not offered on the final round) or the loop is allowed one extra "answer-only" round after tools run.
- Surface `finishReason` to the client and render a small "response may be incomplete" affordance in `message.tsx`/`streaming-message.tsx` when it isn't `"stop"`.
- Either raise `MAX_ROUNDS` for `max`/`xhigh` effort or cap `EFFORT.max.maxTokens` to a value the fallback ladder can realistically deliver within 8 rounds; document the real assumption instead of leaving it implicit in the ladder.
- Parallelize independent tool calls within a round with `Promise.all`.
- Either start actually setting `hadToolCall` on persisted assistant messages or remove the unused plumbing/tests to reduce confusion.
- Add structured logging (not just `console.warn`) on tiered-fallback engagement, keyed by which tier succeeded, so silent quality degradation is observable.
- Add a test that drives `streamForgeCompletion` to `MAX_ROUNDS` with a mock tool that always requests another call, asserting the loop terminates without stranding a tool result silently.

---

## Provider resilience & fallback ladder

**What's included:**
- `postProvider` (`lib/ai/provider.ts:164-217`) wraps every request/stream in a 6-tier fallback ladder that, on an HTTP 400, steps `max_tokens` down (`undefined → 131072 → 65536 → 16384 → 8192`), then drops `reasoning_effort`, and only as an absolute last resort drops `thinking` and `tools` entirely (`provider.ts:190-198`).
- Non-400 failures (429, 5xx) are not retried — they fail immediately with the response body captured (`provider.ts:212-216`).
- `ProviderNotConfiguredError` / `ProviderRequestError` are the only two exported error types (`provider.ts:14-25`); both carry no provider-identifying data in their public `.message`.
- `baseUrl()` normalizes a trailing slash off `DEEPSEEK_BASE_URL` (`provider.ts:77-80`), defaulting to the real endpoint only when unset.
- Response bodies are explicitly canceled (`res.body?.cancel()`) between fallback attempts to avoid leaking open connections (`provider.ts:204-208`).

**Strengths:**
1. The ladder degrades gracefully in priority order (max_tokens → effort → tools) rather than an all-or-nothing retry, maximizing the chance of a usable answer.
2. `ProviderRequestError.status` is preserved end-to-end so the route can distinguish 429 vs 5xx for user messaging (`route.ts:64-69`).
3. `res.body?.cancel()` on the discarded attempt is wrapped in its own try/catch (`provider.ts:204-207`) so a cancel failure can't crash the fallback loop.
4. The last-resort tier (`sendThinking:false, sendTools:false`) guarantees *some* response for the widest range of transient endpoint quirks, prioritizing "the user gets an answer" over feature completeness.
5. `detail.slice(0, 500)` (`provider.ts:214`) caps the amount of raw upstream text carried in the thrown error, limiting log/error bloat.
6. The comment block documents *why* each tier exists (`provider.ts:184-189`), which is unusually good self-documentation for a fallback ladder.
7. Non-stream (`generateText`) and stream paths share the same `postProvider`, so the ladder's behavior is consistent across titles, summaries, and full chat.

**Weaknesses:**
1. **No fallback on non-400 errors.** A single transient 429/500 from the upstream fails the entire user request outright (`provider.ts:203`: only `status !== 400` triggers early break) even though 429/5xx are exactly the class of error most amenable to a short retry-with-backoff; today they short-circuit straight to `friendlyError`.
2. **Every escalation re-sends the full request body from scratch** — there's no reuse of a partial stream; a 400 on tier 1 means the user waits for tier 1's full round-trip, then tier 2's, etc. Up to 6 sequential network round-trips could stack before a final answer starts streaming, with no cap on total added latency beyond `maxDuration=300`.
3. **Tier detection is coarse** — every 400 is treated as "too many tokens requested," regardless of the actual error body content; a 400 caused by a malformed request (e.g., bad `tools` schema) would still be "fixed" by clamping `max_tokens`, which does nothing and just burns through the ladder before hitting the real fallback (dropping tools) at the very end.
4. **No metrics/alerting hook** on which tier ultimately succeeded — operationally invisible whether production traffic is silently running in a degraded (no-thinking, no-tools) mode most of the time.
5. **`FALLBACK_MAX_TOKENS = 8192`** (`provider.ts:12`) is a hardcoded constant with no environment override, unlike `DEEPSEEK_BASE_URL`/`DEEPSEEK_API_KEY` which are configurable — a future provider swap with a different real ceiling requires a code change, not a config change.
6. **No test exercises the fallback ladder itself** — `tests/` has no mock-fetch test asserting that a 400 on tier 1 correctly retries with tier 2's body shape; the ladder's correctness rests entirely on manual reasoning.
7. **`AbortSignal` is shared across all fallback attempts** (`provider.ts:181`, same `opts.signal` reused each `send()` call) — if the user aborts mid-ladder, that's correct, but there's no way to time-box an individual tier attempt independent of the user's abort, so one slow tier can consume disproportionate time before the ladder even gets to try a smaller request.

**Fixes:**
- Add a bounded retry (1-2 attempts, short backoff) for 429/5xx before giving up, distinct from the 400 ladder.
- Inspect the 400 response body for a token/length-related message before assuming the failure is about `max_tokens`; otherwise skip straight to the tools/thinking-drop tier.
- Emit a structured log/metric (tier index, status codes seen) on every non-first-tier success so degraded-mode traffic is observable in production dashboards.
- Make `FALLBACK_MAX_TOKENS` and the tier token values environment-overridable, mirroring `DEEPSEEK_BASE_URL`.
- Add a mocked-fetch unit test that forces a 400 on the first N tiers and asserts the final request body matches the expected degraded shape.

---

## Model selection & provider secrecy

**What's included:**
- `lib/ai/models.ts` is the sole file mapping public Forge model IDs to real provider strings (`"spark-2.5" → "deepseek-v4-flash"`, `"magnum-2.8" → "deepseek-v4-pro"`, `models.ts:13-16`), guarded by `import "server-only"` (`models.ts:10`).
- `lib/ai/models.public.ts` is the client-safe mirror with only `label`/`blurb` (`models.public.ts:5-14`), consumed by every client component (`composer.tsx:11`, `model-menu.tsx:8`).
- `resolveProviderModel()` (`models.ts:31-33`) is the only function that turns a `ForgeModelId` into a provider string, called exactly once, server-side, inside `buildBody` (`provider.ts:138`).
- The model picker (`model-menu.tsx:56-112`) renders both models with plan-gating (`canUseModel`, `locked` state, `Lock` icon) and a Build-mode-specific unavailability rule for Spark (`model-menu.tsx:57,79-81`, "Use Magnum for reliable file edits").
- `DEFAULT_MODEL = "spark-2.5"` (`models.public.ts:24`) with a code comment explaining Forge Code overrides this to Magnum elsewhere.
- The composer's model trigger button re-renders its label keyed by model/effort (`composer.tsx:769-770`) to drive a "swap-in" morph animation, plus a `modelFlash` pulse on change (`composer.tsx:134-143`).

**Strengths:**
1. The provider-secrecy invariant is structurally enforced (only one file can even reference `"deepseek"`), not just a convention — `models.public.ts` cannot physically import `models.ts`'s constant without the compiler pulling in `server-only`.
2. Both `tests/models.test.ts:23-27` and `tests/message-assembly.test.ts:23-26` independently assert the absence of `"deepseek"` in, respectively, public metadata and assembled wire messages — defense in depth in the test suite itself.
3. `modelLabel()` (`models.public.ts:30-32`) is the single accessor used for display, preventing ad-hoc `FORGE_MODELS_PUBLIC[id].label` spellings from drifting.
4. The Build-mode Spark restriction is enforced in the UI (disabled + tooltip, `model-menu.tsx:77-85`) with a plausible in-universe justification ("reliable file edits") rather than referencing internals.
5. Plan-gating and Build-mode-unavailability are visually distinguished (`Lock` icon vs. dimmed/disabled, `model-menu.tsx:90-99`), so a user isn't confused about *why* a model is unselectable.
6. `isForgeModelId()` (`models.public.ts:26-28`) is a proper type guard, used to validate untrusted input rather than a cast.
7. The system prompt only ever states "You run on Forge's own models, Spark 2.5 and Magnum 2.8" (`prompts.ts:12`) — never derived dynamically from anything that could leak a provider string.

**Weaknesses:**
1. **No test asserts the *route* response stream is provider-free**, only that assembled *input* messages and static metadata are — an end-to-end streamed-response scan (mocking `postProvider`) for `"deepseek"` leaking through a tool result, error body, or `notice` string does not exist.
2. **`ProviderRequestError`'s `detail` (raw upstream text, up to 500 chars, `provider.ts:214`) is never scrubbed for provider identifiers** before being attached to the thrown error's `.message`. It is not currently surfaced to the client (`friendlyError` ignores it), but nothing prevents a future change from doing `err.message` in a client-facing string, at which point raw DeepSeek error text (which could name the model, e.g. `"deepseek-v4-pro exceeded..."`) would leak directly. This is a latent landmine, not a live leak.
3. **The blurbs are static marketing copy** ("Fast and efficient for everyday work" / "Most capable for ambitious work", `models.public.ts:8,12`) with no mechanism to keep them in sync with `MODEL_PERSONA` in `prompts.ts:44-49` if one is edited and not the other — two independent copies of "what each model is for" that can drift.
4. **`FORGE_MODELS` (`models.ts:18-29`) duplicates `label`/`blurb` from `FORGE_MODELS_PUBLIC`** rather than only adding the `provider` field on top via a type/spread that guarantees they can't diverge structurally (they're re-declared per-key, not spread) — low risk today since they read from the same source object, but it's a second hand-authored object literal for the same two models.
5. **No runtime guard against accidentally importing `models.ts` from a client component** beyond `server-only`'s build-time throw — a build misconfiguration (e.g., a bundler that doesn't respect the `server-only` package) would fail open only at request time, not review time.
6. **Build-mode's "Spark unavailable" rule is duplicated logic**: `unavailable = buildMode && id === "spark-2.5"` is inlined in `model-menu.tsx:57` rather than exposed as a named predicate from a shared module — a second Forge Code surface implementing the same rule independently could drift.
7. **The model trigger's flash/morph animation (`composer.tsx:134-143,769-770`) has no `prefers-reduced-motion` guard**, unlike more accessibility-conscious parts of the codebase.

**Fixes:**
- Add an end-to-end test that mocks `fetch` to return a DeepSeek-shaped error body and asserts nothing in the resulting NDJSON stream (including `error` events) contains `"deepseek"`.
- Scrub or drop `ProviderRequestError.detail` before any future client-facing use; today it's safe only because it's unused — make that safety explicit with a comment or a redaction step at construction.
- Derive `FORGE_MODELS`'s `label`/`blurb` via object spread from `FORGE_MODELS_PUBLIC[id]` instead of manual re-declaration, so the two can't textually diverge.
- Extract the Build-mode Spark-unavailability rule into a small shared predicate (e.g. `isModelUnavailableInMode`) importable by both the chat composer and any Forge Code equivalent.
- Respect `prefers-reduced-motion` for the model-flash/swap-in transitions.

---

## Effort levels & system-prompt directives

**What's included:**
- Five effort tiers (`low`, `medium`, `high`, `xhigh`, `max`) each define `providerEffort`, `maxTokens`, `tempNoThink`, and a display `label` (`lib/ai/effort.ts:5-26`).
- `maxTokens` ranges from 32,000 (low) to 384,000 (max); `tempNoThink` decreases from 0.8 to 0.35 as effort rises (`effort.ts:6-25`).
- Each effort has a distinct, verbatim system-prompt directive block tagged `[EFFORT: …]` (`prompts.ts:29-40`), injected right after mode-specific addenda in `assembleSystemPrompt` (`prompts.ts:419`).
- Effort maps to DeepSeek's `reasoning_effort` param via a *separate* mapping in the provider layer (`REASONING_EFFORT`, `provider.ts:101-107`) that collapses `xhigh` down to `"high"` (DeepSeek only accepts low/medium/high/max) — explicitly commented as intentional (`provider.ts:99-100`).
- `reasoning_effort` is only sent when thinking is enabled (`buildBody`, `provider.ts:152-154`); `temperature` is only sent when thinking is disabled (`provider.ts:145`), since thinking mode ignores temperature.
- The effort submenu (`model-menu.tsx:116-188`) plan-gates `xhigh`/`max` per-tier with distinct upgrade copy ("Extra High effort" vs "Max effort", `model-menu.tsx:146-152`).
- `DEFAULT_EFFORT = "low"` is both the default composer state (`composer-store.ts:45`) and visually flagged as "Default" in the menu (`model-menu.tsx:179`).

**Strengths:**
1. `maxTokens` strictly increases and `tempNoThink` strictly decreases across all five tiers, and this monotonicity is directly unit-tested (`tests/effort.test.ts:16-26`), not just asserted in comments.
2. Each directive is verified non-trivial and unique (`tests/effort.test.ts:28-36`), preventing an accidental copy-paste duplicate tier.
3. The `xhigh → "high"` collapse for the provider param is explicitly commented with the reason (DeepSeek's real accepted values), rather than silently truncating with no explanation.
4. Effort's two independent levers — the system-prompt directive (behavioral) and `max_tokens`/`temperature` (mechanical) — are cleanly separated into `prompts.ts` and `effort.ts`/`provider.ts` respectively, keeping "what to tell the model" and "how to configure the request" from tangling.
5. The plan-gating copy is effort-specific ("Max effort" vs "Extra High effort", `model-menu.tsx:146-151`) rather than one generic "upgrade" string, giving users an accurate reason.
6. `EFFORT_IDS`/`isEffortId` (`effort.ts:30,34-36`) provide a proper runtime type guard for validating untrusted `effort` strings, used by the zod schema (`types.ts:52`).
7. Temperature values are conservative and sensibly graduated (0.8 → 0.35), matching the stated intent of "more deliberate at higher effort."

**Weaknesses:**
1. **`xhigh` and `high` are indistinguishable to the provider's reasoning depth control** (`provider.ts:101-106`) — the only actual behavioral difference between "High" and "Extra High" effort, once thinking is on, is the `max_tokens` ceiling (128,000 vs 256,000) and the system-prompt directive text; the model itself gets the identical `reasoning_effort: "high"` hint for both. A user paying for/selecting "Extra High" over "High" gets no distinct reasoning-effort signal from the provider, only a longer output budget and a differently-worded prompt.
2. **No test verifies the `provider.ts` `REASONING_EFFORT` mapping** at all (only `effort.ts` and `prompts.ts EFFORT_DIRECTIVE` are tested, `tests/effort.test.ts`) — the `xhigh→high` collapse, arguably the single most surprising behavior in this feature, has zero test coverage.
3. **`EFFORT.providerEffort` (`effort.ts:6-25`, e.g. `"low"`, `"medium"`...) is dead/unused** — `provider.ts` defines and uses its own separate `REASONING_EFFORT` map (`provider.ts:101-107`) rather than reading `EFFORT[opts.effort].providerEffort`, so the field on the client-safe `EFFORT` object is never consulted by the code that actually builds the provider request. Two sources of truth for the same concept, only one of which is live.
4. **Effort's system-prompt directive length/wording has no correctness check against actual model behavior** — the tests assert the directive text differs per tier (`tests/effort.test.ts:28-36`) but nothing validates it actually changes response depth; this is arguably untestable in CI, but it means the whole "effort" feature's real-world effect is unverified beyond token-ceiling and provider-hint plumbing.
5. **`tempNoThink` is entirely skipped when thinking is on** (`provider.ts:145`) — meaning effort has *zero* temperature-based lever in thinking mode; the only real levers left are `max_tokens` and the (partially collapsed) `reasoning_effort`. This halves the number of effective effort dimensions specifically in thinking mode, undocumented for users choosing an effort level while thinking is enabled.
6. **No UI affordance explains the `xhigh`/`high` provider-side equivalence** to the user — someone paying to unlock "Extra High" via a plan gate (`model-menu.tsx:146-149`) has no way to know the provider-level reasoning hint is identical to "High."
7. **The effort submenu re-derives its label strings ad hoc** (`id === "max" ? "Max effort" : id === "xhigh" ? ... `, `model-menu.tsx:145-152`) instead of pulling from a single label source shared with `EFFORT[id].label` (`effort.ts`), risking wording drift between the selectable label and the upgrade-prompt label.

**Fixes:**
- Either give `xhigh` its own distinct provider signal (if DeepSeek exposes any secondary knob — e.g., a higher `max_tokens` alone might already be the intended differentiator, in which case document that explicitly in `provider.ts` next to `REASONING_EFFORT`) or collapse the two tiers in the UI/plan-gating to avoid charging for an indistinguishable setting.
- Add a unit test for `REASONING_EFFORT` asserting `xhigh` currently maps to `"high"`, so a future change is a deliberate, reviewed diff rather than a silent behavior shift.
- Remove `EFFORT.providerEffort` if it's truly dead, or wire `provider.ts` to consume it instead of maintaining a parallel map.
- Consolidate the effort-tier upgrade-copy strings (`model-menu.tsx:145-152`) to read from `EFFORT[id].label` plus a small suffix, rather than a hand-written ternary chain.

---

## System prompt assembly & Current Forge State

**What's included:**
- `assembleSystemPrompt` (`prompts.ts:407-487`) deterministically concatenates, in a fixed documented order: base identity → mode addendum → (Forge Code) web-craft directive → effort directive → model persona → Current Forge State → internal Forge OS knowledge → agent instructions → project instructions → FORGE.md → user custom instructions → memory → active skills (+ execution rules) → skill/agent management → skill catalog → attached context blocks → tool/web-search/image-gen addenda → today's date.
- `formatCurrentForgeState` (`prompts.ts:371-399`) renders every piece of *runtime* state (model, effort, thinking, mode, plan, tools, web search/image status strings, active skills/agent, connectors, conversation/project IDs, incognito) as plain lines the model is instructed to treat as ground truth for self-state questions (`prompts.ts:396-397`).
- `BASE_IDENTITY` (`prompts.ts:9-26`) hard-bans naming vendors/hidden infra, bans meta-narration ("Let me think…"), and carves out an explicit exception for skill/agent management always being available regardless of mode (`prompts.ts:18`).
- `loadUserPromptContext`/`loadProjectPromptContext`/`loadAgentInstructions` (`context-server.ts:7-95`) fetch personalization, memory, project description/FORGE.md, and agent system prompt server-side from Supabase, never trusting client-sent equivalents.
- Every loader wraps its Supabase call in try/catch and fails soft (`context-server.ts:21-23,44-46,92-94`), so a DB hiccup degrades to "no personalization this turn" rather than failing the whole chat request.
- `internalForgeOsKnowledge` is conditionally built only when `shouldUseForgeOsKnowledge(latestUserText)` (`route.ts:198-200`), avoiding injecting Forge-internal docs into every single turn.
- `incognito` mode explicitly zeroes out `memory` before assembly (`route.ts:332`: `incognito ? undefined : userCtx.memory`).

**Strengths:**
1. Prompt assembly order is documented as a stability contract ("surfaced verbatim to the user in the Instruction Inspector, so ordering must be stable", `prompts.ts:401-406`) — an unusually mature design acknowledgment that system-prompt shape is itself a user-facing, debuggable artifact.
2. `formatCurrentForgeState` is directly unit-tested for both content correctness and the provider-secrecy invariant (`tests/prompt-state.test.ts:6-52`).
3. The "answer only from Current Forge State for self-state questions" rule (`prompts.ts:14,397`) is a concrete, testable anti-hallucination guard against the model inventing capabilities it doesn't have.
4. Every server-side context loader (`context-server.ts`) fails soft and independently, so one broken subsystem (e.g., a bad `agents` row) can't take down the whole chat request.
5. `incognito` is threaded through as a first-class, explicit boolean rather than an implicit "don't call this function" convention — visible directly in `Current Forge State` (`prompts.ts:394`) so the model itself is told, not just the memory loader.
6. Plan-gated feature statuses are phrased for the model to relay accurately without inventing details ("plan locked - " + `getUpgradeMessage`, `route.ts:178-196`), and the prompt explicitly tells the model not to describe plan-locked features as merely "disabled" (`prompts.ts:396`).
7. `section()`/`formatList()` (`prompts.ts:362-369`) are small, reused helpers that keep every injected block's formatting consistent, rather than each call site hand-rolling markdown headers.
8. Skill/agent management addenda are appended unconditionally (`prompts.ts:452-453`), matching the explicit product decision that these are "always available… never requires tools/file access/mode switch" (`prompts.ts:18`, `SKILL_MANAGEMENT`/`AGENT_MANAGEMENT`).
9. The "Never claim a feature… unless it appears in Current Forge State" rule (`prompts.ts:18`) is a strong, specific anti-fabrication instruction, not a vague "be honest" platitude.

**Weaknesses:**
1. **The assembled system prompt is unbounded in size** — every layer (agent instructions, skills, skill catalog, project instructions, FORGE.md, attached context blocks including full project files and conversation summaries) is concatenated with no combined length cap or truncation strategy anywhere in `assembleSystemPrompt` (`prompts.ts:407-487`). A user with many long, enabled skills plus a large FORGE.md plus a big collapse summary could silently balloon the prompt to a size that risks hitting the provider's real context limit, with no graceful degradation — only the 400-fallback ladder in `provider.ts`, which addresses `max_tokens` (output), not input size.
2. **`skillCatalog` is echoed into the prompt in full for every request** (`prompts.ts:454-468`) — every skill's name/slug/description is sent on *every* chat turn regardless of whether any skill is active, purely so the model can "edit by slug." For a user with dozens of skills this is a recurring, avoidable prompt-size and cost tax on every single message.
3. **No caching of per-conversation static context** — `loadUserPromptContext`, `loadProjectPromptContext`, and `loadAgentInstructions` (`context-server.ts`) hit Supabase fresh on every single chat request, even though personalization/project description/agent prompt rarely change within a session. No in-memory or short-TTL cache exists.
4. **Plan-gated status strings are constructed via string concatenation with human copy** (`` `plan locked - ${getUpgradeMessage(...)}` ``, `route.ts:178-196`) rather than a structured field — the model has to string-match on `"plan locked"` conceptually via the instruction at `prompts.ts:396`, which is a fragile "prompt-level API" rather than a typed contract.
5. **`internalForgeOsKnowledge` gating (`shouldUseForgeOsKnowledge`) is a heuristic** whose precision/recall is invisible from this code path — if it under-fires, the model may confidently answer meta-questions about Forge with no grounding; if it over-fires, every matching message pays its token cost. (Function itself lives outside the audited file set, but its call site and blast radius are in scope.)
6. **No max-count guard on `skills`/`skillCatalog` arrays** at the zod layer (`types.ts:71-83`) — `chatRequestSchema` accepts arbitrarily many skill objects with arbitrarily long `instructions`/`description` strings, so a compromised or buggy client could inflate the system prompt arbitrarily (see also the Composer/attachment section for the analogous `documents` gap).
7. **Memory and custom instructions are loaded even when `agentId`/`projectId` aren't relevant to the turn** — there's no short-circuit for, say, a project-scoped chat that doesn't need personalization loaded from a different table, though this is a minor efficiency point given the loaders are cheap try/catch wrappers.
8. **The "never invent tool/skill/connector availability" rule and the "Current Forge State is ground truth" rule live in two different prompt sections** (`BASE_IDENTITY` line 18 vs. the `Current Forge State` section footer, `prompts.ts:397`) with overlapping but not identical wording — a minor internal consistency/maintenance smell rather than a functional bug.
9. **No test asserts total assembled prompt length stays under any bound** for a "worst case" input (many skills + long FORGE.md + long agent + long memory) — the only prompt tests are content-presence assertions (`tests/prompt-state.test.ts`), not size/DoS-shaped ones.

**Fixes:**
- Add a combined-size budget check in `assembleSystemPrompt` (or just before dispatch in `route.ts`) that truncates/prioritizes lower-value blocks (e.g., skill catalog descriptions) when the assembled prompt exceeds a threshold, with a clear priority order (identity/mode/effort never truncated; catalog/context blocks truncated first).
- Only include `skillCatalog` in the prompt when the message plausibly involves skill editing (reuse `detectCreatorIntent` server-side, or accept it from the client's own intent check already computed in `use-chat-send.ts:545`) instead of unconditionally on every turn.
- Add a short-TTL (e.g., 30-60s) in-memory cache for `loadUserPromptContext`/`loadProjectPromptContext`/`loadAgentInstructions` keyed by `uid`/`projectId`/`agentId`, since these rarely change mid-session.
- Bound `skills[].instructions`, `skillCatalog[].description`, and array lengths in `chatRequestSchema` (`types.ts:71-83`).
- Add a test that assembles a prompt with maximal realistic inputs (many skills, long FORGE.md, long memory) and asserts the result stays under a defined character budget.

---

## Conversation history collapsing / summarization

**What's included:**
- Once a conversation exceeds `COLLAPSE_THRESHOLD = 10` messages, everything except the last `KEEP_RECENT = 4` is summarized via a dedicated Spark/medium-effort call (`collapse.ts:7-8,26-49`).
- `splitForCollapse` (`collapse.ts:13-19`) is a pure function (no I/O) separated from `maybeCollapse`'s async summarization, and is directly unit-tested (`tests/collapse.test.ts`).
- The transcript handed to the summarizer is capped at 60,000 characters (`collapse.ts:35`) before being sent.
- Summarization is best-effort: any thrown error or empty result falls back to the *full, uncollapsed* message list (`collapse.ts:44-48`), never silently dropping history.
- The resulting summary is injected as a labeled context block ("Earlier conversation summary", `route.ts:318`) rather than merged into a message role, keeping it visually/structurally distinct in the prompt.

**Strengths:**
1. `splitForCollapse` being pure and separately tested (`tests/collapse.test.ts:11-26`) makes the trickiest part (off-by-one slicing, ordering) verifiable independent of network/mocking concerns.
2. The fail-soft design (`collapse.ts:46-48`) means a summarizer outage degrades to "slower/more expensive requests," never to "lost context" or a broken chat.
3. Using a cheap model (`spark-2.5`) and low-ish (`medium`) effort for summarization (`collapse.ts:38-39`) is a sensible cost/quality tradeoff for a purely-internal compression step.
4. The 60,000-character cap (`collapse.ts:35`) protects the summarizer call itself from unbounded input, even though (see weaknesses) the *outer* system prompt has no equivalent cap.
5. Recency ordering is verified: `s!.recent[0].content` / `s!.recent[KEEP_RECENT-1].content` are asserted in the exact expected order (`tests/collapse.test.ts:22-24`), catching a whole class of off-by-one slicing bugs.
6. The summary is clearly labeled to the model ("Earlier conversation summary") rather than pretending to be verbatim history, reducing the chance the model treats a lossy summary as ground truth for quotes/exact wording.

**Weaknesses:**
1. **No caching/memoization of the summary.** `maybeCollapse` re-summarizes the *entire* "older" slice from scratch on every single subsequent turn once a conversation exceeds the threshold (`collapse.ts:26-49` is called fresh in `route.ts:310` on every request) — there is no persistence of a previously-computed summary to extend incrementally. A 200-turn conversation pays a full extra provider round-trip, on every message, re-summarizing an ever-growing "older" slice that barely changed since the last turn. This is a real, compounding latency and cost cost with no mitigation in the code.
2. **This hidden summarization call's cost is entirely excluded from the user's token accounting.** `route.ts`'s billing (`realTokens = BASE_INPUT_TOKENS + estimateTokens(userInputText) + tokens + reasoningTokens`, `route.ts:494-497`) never includes anything from `maybeCollapse`'s own `generateText` call — that call's real prompt/completion tokens are pure operator cost, invisible in both the per-turn UI and the monthly quota counters. Long conversations are systematically under-billed relative to actual provider spend.
3. **`COLLAPSE_THRESHOLD = 10` / `KEEP_RECENT = 4` are hardcoded constants** with no plan-tier variation and no environment override, unlike other tunables in the codebase (`DEEPSEEK_BASE_URL`, `FORGE_RATE_LIMIT_PER_WINDOW`) — a paid-tier user with a right to "better memory" gets identical collapsing behavior to a free user.
4. **The 60,000-character transcript cap (`collapse.ts:35`) silently drops the earliest part of "older" messages** for very long histories, with no indication to the model or user that the summary itself is based on a truncated (not full) older transcript — a summary-of-a-truncation, unflagged.
5. **No test covers the actual `maybeCollapse` async function**, only its pure helper `splitForCollapse` — the fail-soft catch path (`collapse.ts:46-48`), the empty-summary fallback (`collapse.ts:45`), and the transcript-formatting/truncation logic (`collapse.ts:32-35`) are all untested.
6. **Collapse runs on every request once past the threshold, even when the "older" slice is identical to last turn's** — there's no signature/hash check to skip re-summarization when nothing new has been added to the collapsed region since the previous turn.
7. **The summary prompt (`SUMMARY_PROMPT`, `collapse.ts:10`) has no output-length cap or format contract enforced** (e.g., a max bullet count) — a verbose summary could itself consume a large, unbounded share of the outer system prompt with no truncation.

**Fixes:**
- Persist the most recent computed summary (e.g., alongside the conversation document) and only re-summarize the *newly* collapsed slice on top of the prior summary, rather than recomputing from scratch every turn.
- Fold the collapse call's real token usage into either the user's billed `realTokens` (at some discount factor) or at minimum into operator-side cost telemetry, so this isn't a fully invisible cost.
- Make `COLLAPSE_THRESHOLD`/`KEEP_RECENT` configurable per plan tier or via environment, matching the pattern already used for rate limiting.
- Add a test for `maybeCollapse` itself (mocking `generateText`) covering: success, thrown error, empty-string result, and the 60k-char truncation boundary.
- Consider hashing the "older" slice to skip redundant re-summarization when unchanged.

---

## Rate limiting & plan/usage gating

**What's included:**
- A quiet, server-only per-uid rolling-window rate limiter (`lib/ai/rate-limit.ts`), disabled by default (`FORGE_RATE_LIMIT_PER_WINDOW` unset ⇒ unlimited, `rate-limit.ts:15`), backed by an in-memory `Map<uid, number[]>` (`rate-limit.ts:11`).
- Applied identically to `/api/chat` (`route.ts:88`), `/api/title` (`title/route.ts:25`), and `/api/suggest-skill` (`suggest-skill/route.ts:23`), always *after* auth verification.
- Independently, `/api/chat` enforces per-plan feature gates *before* the token check (`route.ts:135-152`): model access, effort tier, thinking availability — each returning a distinct `403 plan_gate` payload the client maps to a "Feature Locked" modal.
- A separate monthly/window token-quota check (`checkTokenLimit`, `route.ts:154-165`) returns `429 usage_limit` with a machine-readable `reason`/`resetsAt`, mapped client-side to a dedicated countdown modal (`use-chat-send.ts:342-353`, `usage-limit-modal.tsx`).
- Per-feature (searches/images/vision/documents) limits are re-checked turn-locally inside `executeTool` *in addition to* the request-level gate, preventing a single turn's multiple tool calls from exceeding the monthly cap (`route.ts:372-378,384-393`).
- Billing deducts a fixed `BASE_INPUT_TOKENS = 500` plus the user's own latest-message tokens plus completion/reasoning tokens (`route.ts:52,494-497`), explicitly excluding the real, much larger `prompt_tokens` (system prompt, memory, skills, resent history, tool results) from what's charged (`route.ts:488-493` comment).

**Strengths:**
1. Auth is verified strictly before rate-limiting and before any gate check (`route.ts:77-90`), so an unauthenticated caller can never consume a rate-limit bucket slot or trigger any downstream logic.
2. The plan-gate and usage-limit failure modes are cleanly distinguished (`403 plan_gate` vs `429 usage_limit`) and each maps to its own purpose-built modal client-side (`use-chat-send.ts:343-364`), rather than one generic error toast.
3. Turn-local quota re-checking inside `executeTool` (`route.ts:372-378,384-393`) closes an obvious hole where a single agentic turn could call `web_search`/`generate_image` many times and blow past the monthly cap before the next request's gate check would catch it.
4. The rate limiter's swap-seam is explicitly designed for: the comment (`rate-limit.ts:6-8`) calls out that a durable multi-instance limiter (Firestore/Upstash) can replace the body without touching call sites — good forward-looking API design.
5. Fractional billing for a degraded fallback image (`count: fellBack ? 0.5 : 1`, `tools.ts:197`) is a thoughtful fairness touch — users aren't charged a full unit for a lower-quality result.
6. The image-editing path re-validates `siliconFlowApiKey()`/plan/limit *again* server-side (`route.ts:231-241`) even though the client already gates the UI, correctly not trusting client-side gating alone.
7. `getUpgradeMessage`/`getRequiredPlan` (`lib/plans/gates.ts:110-113`) centralize the "upgrade" copy generation so gate messages are consistent in wording across every feature.
8. The chat route awaits `incrementUsage` before closing the stream specifically so the client's immediate usage refresh sees fresh counters (`route.ts:511-512` comment + code) — a subtle race avoided deliberately.

**Weaknesses:**
1. **The quiet rate limiter is disabled by default** (`rate-limit.ts:15`: unset env ⇒ unlimited) — in a default/fresh deployment there is *no* per-user request-rate protection at all on `/api/chat`, `/api/title`, or `/api/suggest-skill`, relying entirely on whoever deploys Forge to remember to set `FORGE_RATE_LIMIT_PER_WINDOW`.
2. **In-memory, per-instance limiter state** (`rate-limit.ts:11`) means the limit is trivially bypassed by load-balancing across multiple server instances/serverless cold starts — the comment acknowledges this (`rate-limit.ts:6-8`) but the gap remains live in any horizontally-scaled deployment.
3. **The `buckets` Map is never pruned of empty/idle entries** — `checkRateLimit` always does `buckets.set(uid, recent)` (`rate-limit.ts:24`) even for a uid whose recent-events array is now empty after filtering, so the Map grows by one entry per distinct uid ever seen and never shrinks; over a long server lifetime with many distinct users this is a slow, unbounded memory leak (small per-entry, but genuinely unbounded).
4. **The real DeepSeek `prompt_tokens` cost is structurally excluded from user billing** (`route.ts:488-493`), by explicit design — meaning the *actual* provider bill scales with full resent history + system prompt + skills + memory + tool results on every round, while the user's quota deduction stays proportional only to their own latest message + completion. Long conversations, many active skills, or large project contexts create an open-ended gap between real spend and collected quota that grows with conversation length and prompt size (compounds with the System-Prompt-Assembly section's unbounded-size finding and the Collapse section's un-billed summarization calls).
5. **No per-request payload size cap in the zod schema** (`types.ts:28-46,49-90`) on `attachedImages[].base64`, `documents[].text`, or `scannedPdfs[].pages[].base64` — no `.max()` anywhere, and no array-length cap on `documents`/`scannedPdfs`/`attachedImages`. Combined with no Next.js body-size-limit configuration (`next.config.ts` has none), an authenticated user can submit an arbitrarily large request body; the "documents" path is explicitly *free and uncounted* (`route.ts:270-274` comment: "no gate, no count"), so while its *token* cost does flow into `estimateTokens(userInputText)` billing (since the enhanced last-user-message includes it), there is still no hard ceiling stopping a single request from being enormous before quota math ever runs.
6. **Scanned-PDF quota counts by document, not by page.** `documentCount += 1` per scanned PDF (`route.ts:292`) and the pre-check compares `usageCtx.documents + scanned.length > docLimit` (`route.ts:282`) — both count *PDF objects*, not the number of page-images inside each. Since `scannedPdfSchema.pages` has no max length (`types.ts:42-46`), a single "document" unit of quota can smuggle an arbitrarily large number of page-images into one `analyzeImages` call (`route.ts:290`), letting a user extract far more Gemini vision analysis per quota-unit than the plan limits intend.
7. **Rate-limit failures return a generic 429 with no `Retry-After` semantics** (`route.ts:88-90`) — the client's error path just shows a static "Forge is busy, try again shortly" (`use-chat-send.ts:368`), giving the user no actual guidance on when to retry.
8. **`/api/suggest-skill`'s rate-limit failure silently degrades to `{skills: []}`** (`suggest-skill/route.ts:23`) rather than a real error status — indistinguishable from "no skill was relevant," which could mask a genuine outage/limiting event from both the user and any monitoring based on response codes.
9. **No test exists for `checkRateLimit`** (no `rate-limit.test.ts` in `tests/`) despite it gating three separate API routes — the sliding-window filter logic, the disabled-by-default behavior, and the leak noted above are all unverified by CI.
10. **Plan-gate checks happen in a fixed order (model → effort → thinking) before the token-limit check** (`route.ts:142-153`) — a user who is both over their token quota *and* requesting a locked model sees only the plan-gate error, never learning they're also out of tokens; the two 4xx classes aren't composable in one response.

**Fixes:**
- Ship a sane non-zero default for `FORGE_RATE_LIMIT_PER_WINDOW` (or fail loudly in non-dev environments if it's unset) rather than silently defaulting to "unlimited."
- Prune `buckets` entries whose `recent` array is empty after filtering (`rate-limit.ts:18-24`), or switch to a periodic sweep, to bound memory growth.
- Fold at least a discounted portion of real `prompt_tokens` into the billed `realTokens`, or explicitly cap conversation/context size more aggressively (lower `COLLAPSE_THRESHOLD`, cap skill-catalog injection) to bound the real-vs-billed gap.
- Add `.max()` bounds to `attachedDocumentSchema.text`, `attachedImageSchema.base64`, and array-length caps to `documents`/`scannedPdfs`/`attachedImages`/`scannedPdfSchema.pages` in `lib/ai/types.ts`.
- Count scanned-PDF quota by total page count across the request, not by PDF-object count.
- Return a `Retry-After` header (or at least an estimated wait) on 429s from the rate limiter.
- Move `/api/suggest-skill`'s rate-limit hit to a distinct status/flag the client can at least log, instead of conflating it with "no suggestion."
- Add unit tests for `checkRateLimit` covering window expiry, the disabled-by-default path, and repeated calls for the same uid.

---

## Title generation

**What's included:**
- `/api/title` (`app/api/title/route.ts`) is a small, separate endpoint: auth → rate limit → validate/truncate the first user message to 2000 chars (`title/route.ts:34`) → `generateText` with fixed `spark-2.5` / `low` effort / thinking off (`title.ts:4-6`) → `cleanChatTitle`.
- `cleanChatTitle` (`title.ts:23-39`) strips code fences, quote/punctuation wrapping, collapses whitespace, caps at 6 words and 70 characters, and falls back to `"New chat"` (or the raw first message) if empty.
- The client (`use-chat-send.ts:114-132,602-611`) only *requests* a title for the first user message of a conversation whose title is still the default ("New chat"), and does so fire-and-forget (`void (async () => …)()`) so it never blocks sending.
- `chatRequestSchema.wantTitle` (`types.ts:88`) is explicitly documented as a legacy flag ignored by `/api/chat` — titles are generated only via `/api/title`.

**Strengths:**
1. Title generation is fully decoupled from the main chat stream (a separate endpoint, fire-and-forget client call) so a slow/failed title never delays or breaks message sending.
2. `cleanChatTitle` is pure and thoroughly unit-tested for the exact edge cases that matter (`tests/title.test.ts:26-32`): quoted output, trailing punctuation, over-length output, and empty output.
3. Pinning the title model/effort/thinking to fixed constants (`title.ts:4-6`, asserted in `tests/title.test.ts:12-16`) keeps title generation cheap and fast regardless of the user's own chat settings.
4. The client only fires the request for genuinely-first messages on genuinely-default-titled conversations (`use-chat-send.ts:602-611`), avoiding redundant title calls on every message.
5. `firstUserMessage` is truncated server-side to 2000 chars (`title/route.ts:34`) before even reaching the model, bounding worst-case cost for this endpoint independent of the client's own truncation (or lack thereof).
6. Failure handling always yields *some* usable title (falling back to a cleaned version of the raw first message, `title/route.ts:49-53`) rather than leaving the conversation titled "New chat" forever on a transient provider error.

**Weaknesses:**
1. **All errors are handled identically and silently** — the `catch (err)` block (`title/route.ts:48-53`) treats `ProviderNotConfiguredError` and every other exception (network failure, malformed response, a genuine bug) the same way, and unlike `/api/chat` (`route.ts:81`: `if (process.env.NODE_ENV !== "production") console.error(...)`), there is **no logging at all**, even in development — a real bug in this endpoint would be completely invisible during development.
2. **No test covers the actual `/api/title` route handler**, only the pure helper functions in `lib/ai/title.ts` — the auth/rate-limit/fallback wiring in `title/route.ts` itself is untested.
3. **The client's title fetch has no retry and no user-visible failure state** — `fetchConversationTitle` (`use-chat-send.ts:114-132`) swallows any fetch error to `null` and simply leaves the conversation titled "New chat" with no indication anything went wrong, and no later retry is ever attempted for that conversation.
4. **A duplicate/independent title-worthy request could race** — nothing prevents two rapid "first messages" in quick succession (e.g., a fast edit-and-resend on the very first turn) from firing two concurrent `/api/title` calls updating the same conversation's title; the last network response to land wins, with no ordering guarantee tied to message order.
5. **`cleanChatTitle`'s truncation is naive word-based, not aware of sentence boundaries** — `words.join(" ").slice(0, 70)` (`title.ts:36-37`) can still cut mid-word if six words already exceed 70 characters, producing a title with a trailing partial word.
6. **The system prompt for titles has no explicit ban on revealing provider/model identity**, unlike `BASE_IDENTITY` — low risk given the tightly scoped instruction (`title.ts:8-17`), but it's a separate system prompt entirely, not composed through `assembleSystemPrompt`, so it doesn't inherit any of the base identity's anti-leak instructions at all. A sufficiently adversarial "first message" (e.g., a prompt-injection attempt disguised as a chat message) is judged only by this narrow, un-hardened prompt.

**Fixes:**
- Log unexpected errors in `/api/title` (guarded by `NODE_ENV` like the chat route) so real bugs aren't invisible.
- Add a route-level test (mocking `generateText`) for the success path, the `ProviderNotConfiguredError` fallback, and a generic-error fallback.
- Surface a subtle retry affordance (e.g., re-attempt title generation once more automatically after a short delay, or let the user manually trigger a rename) rather than a permanently-silent failure.
- Fix `cleanChatTitle`'s truncation to trim at a word boundary within the 70-char cap rather than slicing mid-word.
- Consider running the title prompt through (a minimal subset of) the same anti-leak/anti-injection instructions as `BASE_IDENTITY`, since it's still model output that could theoretically be steered by adversarial user input.

---

## Composer & attachment pipeline

**What's included:**
- Autosizing textarea (`composer.tsx:146-152`), Enter-to-send/Shift+Enter-newline (`composer.tsx:375-378`), and a slash-command skill picker with keyboard nav (arrow keys, Enter/Tab to select, `composer.tsx:357-374`).
- File attachment via three entry points — the "+" menu file picker, drag-and-drop, and clipboard paste (`composer.tsx:298-332`) — all funneled through one `addFiles` function that type-sniffs and plan-gates each file (`composer.tsx:228-296`).
- Images capped at 10MB (`MAX_IMAGE_BYTES`, `composer.tsx:25`), PDFs at 25MB (`MAX_PDF_BYTES`, `composer.tsx:26`); vision/document-analysis plan gates checked client-side before parsing (`composer.tsx:233-241,267-275`).
- PDFs are parsed client-side; text-layer PDFs become free, ungated "document" attachments, scanned (image-only) PDFs are rasterized to page images and gated as "Document analysis" (`composer.tsx:258-285`).
- Voice input: `MediaRecorder`-based recording capped at 60s (`MAX_RECORDING_SECONDS`, `composer.tsx:27,516-522`), auto-stopping and posting to `/api/voice/transcribe`, inserting the transcript at the caret with smart spacing (`composer.tsx:403-456`).
- An "Add" popover offers skill/command entry and file attach (`composer.tsx:696-752`); an `AgentMenu` (`agent-menu.tsx`) offers agent selection inline.
- A usage indicator (`usage-indicator.tsx`) appears once token usage crosses 80%, with amber/orange/red tiers and a click-through to settings.
- Send is blocked while `streaming`, while any PDF is still parsing (`parsingCount > 0`), or once the usage window is full (`composer.tsx:347,812`).

**Strengths:**
1. All three attachment entry points (picker, drag-drop, paste) share one validation/gating funnel (`addFiles`, `composer.tsx:228-296`), so a plan gate or size limit can't be bypassed via one input method but not another.
2. Text-layer vs. scanned PDF detection happens client-side before any AI call (`composer.tsx:260-285`), correctly avoiding a wasted Gemini call (and its quota) for PDFs whose text can be extracted for free.
3. The recording timer visibly hard-stops at `MAX_RECORDING_SECONDS` via `queueMicrotask(stopRecording)` (`composer.tsx:519`) rather than only capping the *display*, so a user can't accidentally record indefinitely.
4. Mic/stream cleanup on unmount (`composer.tsx:540-553`) explicitly stops any in-flight recorder and releases media tracks, avoiding a classic "recording light stays on" bug after navigating away.
5. `insertTranscript` (`composer.tsx:403-423`) inserts at the actual caret position with smart whitespace padding on both sides, rather than crudely appending to the end of the draft.
6. The slash-picker's result list correctly excludes already-active skills (`composer.tsx:109`) and re-filters on both slug and name (`composer.tsx:110-111`), and resets its keyboard-selection index whenever the query changes (`composer.tsx:115`).
7. Drag state (`isDragging`) is cleared only when the drag-leave target is the wrapper itself, not a child (`composer.tsx:328-331`), avoiding the common flicker bug where dragging over child elements repeatedly toggles the dropzone overlay.
8. A cached-image `complete`/`naturalWidth` check (in the related `generated-image-card.tsx:95-97`) prevents a stuck-shimmer bug when an image loads faster than React attaches its `onLoad`.
9. Every gated action (image, document, voice) opens the *same* `openGate` modal with feature-specific copy (`composer.tsx:234-239,268-273,526-531`), keeping the upgrade UX consistent across attachment types.
10. `onFileInputChange` resets `e.currentTarget.value = ""` (`composer.tsx:300`) so re-selecting the identical file twice in a row still fires a change event.

**Weaknesses:**
1. **Client-side size/type gating has no server-side enforcement** — `chatRequestSchema` (`types.ts:28-46`) never validates image/document/PDF-page size, so the 10MB/25MB caps in `composer.tsx:25-26` are purely cosmetic against a direct API call bypassing the browser UI (see the Rate-Limiting section for the fuller quota-abuse implication).
2. **Editing or regenerating a message with attached documents silently drops the documents.** Both `regenerate()` (`use-chat-send.ts:763-768`, comment: "document text isn't persisted") and `chat-view.tsx`'s `handleEdit` (`chat-view.tsx:198`) hardcode `documents: [], scannedPdfs: []`, re-sending only images. There is no UI indication to the user that regenerating/editing a message that had a PDF attached will answer *without* that PDF's content.
3. **Voice input has no visible quota/remaining-minutes indicator** — `voiceInputLocked` (`composer.tsx:85`) is a boolean "is the feature available at all" gate; there is no display of how many voice-input minutes remain on the current plan before/while recording, unlike the token-usage indicator which does show percentage remaining.
4. **The slash-command popover items are plain `<div>`s with no ARIA roles** (`composer.tsx:604-624`) — no `role="listbox"`/`role="option"`/`aria-activedescendant` wiring, so a screen-reader user gets no indication that arrow keys navigate a list or which item is currently highlighted, despite the picker being fully keyboard-operable for sighted users.
5. **No `prefers-reduced-motion` handling** anywhere in the composer's Framer Motion usage (menu open/close springs, send-button "flying" animation, model-flash pulse) — motion-sensitive users get the full animation set unconditionally.
6. **`readImageFile` silently resolves `null` on any `FileReader` error** (`composer.tsx:204-223`) with a generic "Couldn't attach {name}" toast (`composer.tsx:248`) — no distinction between a corrupt file, an unsupported sub-format, or a transient read failure, giving the user no actionable next step.
7. **Recording start failures are coarsely bucketed** — `getUserMedia` rejection is *always* reported as "Microphone access denied" (`composer.tsx:479-482`), even though it could equally be "no microphone device present," which needs a different remedy than "allow permission in browser settings."
8. **The "Add" menu closes on outside click and Escape but has no focus trap or return-focus behavior** (`composer.tsx:166-182`) — closing it doesn't restore focus to the trigger button, a minor but real keyboard-accessibility gap.
9. **`parsingCount` is a simple counter with no per-file cancellation** — if a user attaches five large PDFs and wants to cancel just one mid-parse, there's no way to abort an individual in-flight `parsePdf`/`rasterizePdf` call; the whole batch runs to completion.
10. **The mic button's `data-tip` and `aria-label` can disagree during state transitions** — e.g., mid-transcription the tooltip reads "Transcribing…" while `aria-label` still reads "Start voice input" (`composer.tsx:786-793`), since the `aria-label` ternary only branches on `isRecording`, not `isTranscribing`.
11. **No maximum attachment count per message** — a user (or a scripted client) can attach an unbounded number of images/PDFs in one send; only per-file size and per-feature *monthly* quota are checked, not a sane per-message cap (e.g., "no more than 10 files").

**Fixes:**
- Add server-side size/count validation in `chatRequestSchema` mirroring the client's 10MB/25MB/60s constants, so the API itself enforces the limits regardless of client behavior.
- Show a small inline notice when regenerating/editing a message whose attachments included a document/PDF, explaining that document context won't be resent — or better, persist parsed document text so it *can* be resent.
- Add a voice-minutes-remaining indicator to the mic button/tooltip, mirroring `UsageIndicator`'s approach for tokens.
- Give the slash-command popover proper listbox/option ARIA roles and `aria-activedescendant`.
- Respect `prefers-reduced-motion` across the composer's Framer Motion transitions.
- Distinguish "no microphone found" from "permission denied" in `startRecording`'s catch block via `err.name` (`NotFoundError` vs `NotAllowedError`).
- Cap the number of attachments accepted per send in `addFiles`, with a clear toast when the cap is hit.

---

## Markdown / KaTeX / Shiki rendering & code blocks

**What's included:**
- `Markdown` (`markdown.tsx`) renders via `react-markdown` with `remark-gfm` + `remark-math` + `rehype-katex` + **`rehype-raw`** (`markdown.tsx:5-8,49-50`).
- Custom component overrides: `pre` is unwrapped so `CodeBlock` supplies its own chrome (`markdown.tsx:15`); fenced blocks tagged `forge-skill`/`forge-agent` render dedicated save cards instead of code (`markdown.tsx:20-27`); all links open `target="_blank"` with `rel="noopener noreferrer"` (`markdown.tsx:38-42`).
- `CodeBlock` (`code-block.tsx`) debounce-highlights inline code via Shiki (150ms debounce, `code-block.tsx:20-33`) but routes "substantial/previewable" code straight to an `ArtifactCard` instead (`isArtifactCode`, `code-block.tsx:17,35`).
- Copy-to-clipboard and download-as-file actions on every code block (`code-block.tsx:37-55`), plus an optional "Run" button wired to `useCodeRunner` when the language is executable (`code-block.tsx:65-73`).
- Highlighted HTML from Shiki is injected via `dangerouslySetInnerHTML` (`code-block.tsx:87`).
- `Markdown` is wrapped in `React.memo` (`markdown.tsx:45`) to avoid re-rendering unchanged historical messages.

**Strengths:**
1. Unwrapping `<pre>` (`markdown.tsx:15`) to let `CodeBlock` own the chrome avoids the common nested-`<pre>`/double-scrollbar bug seen in many markdown+syntax-highlighting integrations.
2. `forge-skill`/`forge-agent` fenced blocks are intercepted before generic code rendering (`markdown.tsx:20-27`), giving the skill/agent creation flow a first-class, purpose-built card instead of a raw JSON code block.
3. External links are hardened with `rel="noopener noreferrer"` unconditionally (`markdown.tsx:39`), closing the classic reverse-tabnabbing hole for every AI-generated or search-result link rendered in chat.
4. Highlighting is debounced (150ms, `code-block.tsx:24`) specifically to stay smooth *while streaming*, rather than re-highlighting on every token.
5. `isArtifactCode`'s substantial-code-becomes-an-artifact-card routing (`code-block.tsx:17,35`) cleanly separates "here's a snippet" from "here's a document/app to preview," matching the Claude-style UX the product is going for.
6. `Markdown` is memoized (`markdown.tsx:45`), a real, verifiable perf guard for long threads with many historical messages re-rendering on unrelated state changes.
7. The debounce's cleanup correctly guards against stale updates (`let live = true; … return () => { live = false; }`, `code-block.tsx:21,29-31`) so a fast-changing streaming code block can't have an old highlight overwrite a newer one after the effect re-runs.
8. Download uses a proper `Blob`/object-URL/revoke cycle (`code-block.tsx:47-55`) rather than a data-URI, avoiding potential size limits on very large code blocks.

**Weaknesses:**
1. **`rehype-raw` is enabled with no sanitization step (`rehype-sanitize` or DOMPurify) anywhere in the pipeline** (`markdown.tsx:5-8,49-50`; confirmed absent from `package.json`). `rehype-raw` parses literal HTML embedded in markdown into real DOM nodes. Since the rendered `content` is model output — and model output can be influenced by web-search results, fetched page content, or PDF/document text the model is asked to summarize/quote (i.e., indirect prompt injection from a source outside the user's own typing) — a manipulated upstream source could cause the model to emit raw `<script>`/`<img onerror>`/`<iframe>`-style HTML in its answer, which `rehype-raw` would render as live markup with no sanitizer in between. This is the most significant concrete security gap found in this audit.
2. **Shiki output is injected via `dangerouslySetInnerHTML`** (`code-block.tsx:87`) — Shiki's own output is generally safe for well-formed input, but combined with finding #1's lack of any sanitization layer elsewhere in the render pipeline, this is a second `dangerouslySetInnerHTML` site with no shared sanitization utility between the two.
3. **No size/length guard before syntax highlighting** — `highlightCode(code, lang)` (`code-block.tsx:25`) is called on arbitrary-length code blocks with no truncation, so a pathologically large fenced block (e.g., from a runaway model response before the continuation loop catches it) could cause a slow/expensive highlight pass on the main thread.
4. **`isArtifactCode`'s heuristic for "substantial" code is opaque from this file** — the routing decision between inline `CodeBlock` and full `ArtifactCard` happens via an imported predicate (`lib/code/snippet.ts`, outside this audit's primary file list) with no visible fallback if the heuristic misclassifies a large-but-not-quite-artifact-worthy block, which would then hit Shiki's debounce path with no special handling for size.
5. **No test coverage in this directory for the markdown pipeline's security posture** — none of `tests/*.test.ts` assert that raw `<script>`/event-handler HTML embedded in a message is neutralized (there is no `markdown.test.ts`), despite `rehype-raw` being enabled.
6. **The `forge-skill`/`forge-agent` interception is purely by language-tag string match** (`markdown.tsx:21,25`) — any code block a user pastes or the model emits that happens to be tagged with those exact fence languages (even unintentionally, e.g. a user asking "show me a code block labeled forge-skill") would be rendered as a save-card UI component rather than code, a minor but real content-based UI-hijack surface.
7. **Copy/download actions have no size cap or confirmation for extremely large code blocks** (`code-block.tsx:37-55`) — a very large generated file downloaded via the in-browser Blob path has no user-facing size warning.
8. **`code` component override doesn't distinguish deliberately-malicious inline code from a legitimate inline snippet** for XSS purposes — inline (`isBlock` false) code renders via `<code className="inline">{children}</code>` (`markdown.tsx:32-36`), which is safe (React-escaped text), but this only reinforces that the *raw-HTML* path (finding #1) is the sole actual gap, since everything else in this component correctly relies on React's default escaping.

**Fixes:**
- Add `rehype-sanitize` (or an equivalent allow-listed schema) to the plugin chain in `markdown.tsx`, positioned after `rehype-raw`, so raw HTML is parsed but then constrained to a safe element/attribute allow-list before rendering. This is the single highest-priority fix in this entire audit.
- Add a regression test that renders `Markdown` with content containing `<script>alert(1)</script>` and an `<img onerror=...>` tag and asserts neither executes/renders as live markup.
- Add a reasonable max-length guard before invoking Shiki, falling back to plain `<pre>` text for pathologically large blocks.
- Consider gating the `forge-skill`/`forge-agent` card rendering on more than just the language tag (e.g., also validate the JSON payload shape before rendering the save card) so an incidental language-tag match can't hijack the UI.

---

## Branching / edit / regenerate & message tree

**What's included:**
- Messages form a parent-pointer tree (`ThreadNode`/`MessageDoc.parentId`), with `buildActivePath` (`lib/data/tree.ts:15-58`) resolving the currently-displayed linear path either by walking up from `activeLeafId` or by always following the most-recently-created child at each level.
- `leafOf` (`tree.ts:61-76`) and `siblingsOf` (`tree.ts:79-86`) support branch navigation (prev/next sibling switch) and "jump to the deepest latest reply" behavior.
- **Regenerate** (`use-chat-send.ts:733-776`) truncates the active path back to the parent user message and re-runs the stream with a *new* assistant node parented to the same user message (creating a sibling branch), using the composer's *current* model/effort/thinking/skills/agent, not the original turn's settings.
- **Edit** (`chat-view.tsx:189-203`, `use-chat-send.ts` via `send()`) re-sends from a prefix of the path ending before the edited message, similarly creating a new branch.
- **Branch switch** (`chat-view.tsx:205-212`) walks to sibling `N±1` and jumps to that branch's deepest leaf via `updateConversation({ activeLeafId })`.
- The UI shows a `1/3`-style branch switcher only when `node.siblings > 1` (`message.tsx:202-222`), with disabled prev/next at the ends.
- A "handoff" mechanism (`chat-view.tsx:52-57,267-269`) suppresses the entrance animation for the specific assistant message that just replaced a live stream, so persisted content doesn't visibly "pop" back in.

**Strengths:**
1. `buildActivePath`/`leafOf`/`siblingsOf` are pure functions with no I/O, each independently and thoroughly unit-tested against a realistic branched tree fixture (`tests/tree.test.ts:9-58`), including the "regenerated branch" scenario the feature exists for.
2. Sibling ordering is deterministic (`sort by createdAt`, `tree.ts:30,69,85`), so branch switching always presents branches in creation order rather than an unstable/undefined order.
3. The "most recent child at each level" default-path fallback (`tree.ts:39-47`) gives sensible behavior even when `activeLeafId` is missing or stale (e.g., points to a deleted/unsynced node), verified by its own test case (`tests/tree.test.ts:46-48`).
4. The streaming→persisted handoff (`chat-view.tsx:52-57`) is a genuinely subtle UX problem (avoiding a visible re-render "pop") solved with a minimal, well-reasoned mechanism (a single ref tracking the in-flight user-message id).
5. Regenerate correctly locates the parent user message via `activePath` index arithmetic with an explicit guard (`idx < 1` bail, `use-chat-send.ts:737`) rather than assuming a valid index.
6. Editing re-sends only images (not full attachment state) deliberately, with an explicit comment explaining the tradeoff (`use-chat-send.ts:763`: "document text isn't persisted") rather than silently doing the wrong thing with no explanation.
7. The branch-switch handler correctly resolves to the *leaf* of the target sibling (`leafOf`, `chat-view.tsx:210`), not just the sibling node itself, so switching branches deep into a multi-turn sub-conversation lands you back at the latest reply in that branch, not its root.

**Weaknesses:**
1. **Regenerate silently uses the composer's *current* model/effort/thinking/skills/agent** (`use-chat-send.ts:743-744`), not whatever was active when the original (now-superseded) assistant turn was generated. If a user changes model or effort for an unrelated reason and later clicks "Regenerate" on an older message, the regenerated branch is produced under different settings than either the original message *or* the user's expectation, with zero UI indication that this happened.
2. **Editing a message with attached documents/scanned-PDFs drops that context** (`chat-view.tsx:198`, `use-chat-send.ts:766-768`) with only a code comment explaining why — nothing in the UI tells the user their edited message will be answered without the PDF that was originally attached.
3. **No confirmation or undo for edit/regenerate creating a new branch** — since both actions create a *sibling* rather than mutating in place, the old branch still exists in the data model, but there is no visible "branch created" affordance beyond the small `1/3` counter appearing after the fact; a user who didn't know editing branches (rather than mutates) could be confused about where their "original" answer went.
4. **`buildActivePath` recomputes the entire children/parent index from scratch on every call** (`tree.ts:21-30`) with no memoization keyed on the message array's identity — for a very long, heavily-branched conversation this is an O(n log n) rebuild (due to per-parent sorts) on every relevant re-render, though `useMemo` at the call site (`chat-view.tsx:59-62`) mitigates most of the practical impact.
5. **Regenerate's `parentLeafId` handling assumes `parent.parentId` is the correct re-attachment point** (`use-chat-send.ts:749`) without re-validating that the parent user message still exists in the live tree at call time (e.g., if it was concurrently deleted by another client/tab) — no defensive check before proceeding.
6. **No keyboard-accessible way to switch branches** — the prev/next branch buttons (`message.tsx:204-219`) are mouse-oriented icon buttons with `aria-label`s (good), but there's no documented keyboard shortcut, and focus order/visibility for the small 13px icon buttons isn't verified for touch-target size (a11y minimum target size guidance is 24-44px).
7. **Editing truncates `activePath` using `findIndex`** (`chat-view.tsx:191`) with a fallback to the *entire* `activePath` if the node isn't found (`chat-view.tsx:192`: `idx >= 0 ? activePath.slice(0, idx) : activePath`) — silently treating "message not found in the currently displayed path" the same as "message is the first one," which could, in an edge case (a stale `node` reference from a just-changed branch), re-send from the wrong prefix with no warning.
8. **No test exercises the actual `regenerate`/edit/branch-switch flows in `use-chat-send.ts`/`chat-view.tsx`** — only the pure `tree.ts` helpers are tested (`tests/tree.test.ts`); the higher-level orchestration (correctly reconstructing `wire`, `parentLeafId`, attachment re-send) has no test coverage at all.

**Fixes:**
- Either preserve and reuse the original message's model/effort/thinking/skills/agent on Regenerate by default (with an explicit "regenerate with different settings" opt-in), or show a small inline label on the regenerated branch stating which settings produced it.
- Add a lightweight inline notice when editing/regenerating a message whose attachments included a document, so the context-loss is visible rather than silent.
- Add defensive re-validation in `regenerate()` that the resolved parent message still exists in the live `messages` array before proceeding.
- Add tests for `use-chat-send.ts`'s `regenerate`/`send` (edit path)/`resolveSuggestion` orchestration, mocking `runStream`'s network call.
- Increase the branch-switch button hit targets or add visible focus styling sized to accessibility touch-target guidance.

---

## Thinking / reasoning display & streaming state

**What's included:**
- `StreamingState` (`stream-store.ts:30-56`) tracks `content`, `reasoning`, `phase` (`reasoning|streaming|finalizing|error`), plus precise timing fields (`reasoningStart`, `reasoningFirstAt`, `reasoningMs`).
- `appendReasoning`/`appendContent` (`stream-store.ts:86-122`) implement the "thinking duration = first reasoning token → first answer token" rule: the phase flips from `reasoning`→`streaming` on the *first* content delta, and `reasoningMs` is captured at exactly that flip (`stream-store.ts:96-103`), not measured against the whole response.
- `ThinkingPanel` (`thinking-panel.tsx`) shows a live elapsed-seconds counter while active (updated every 250ms, `thinking-panel.tsx:31-35`), auto-collapses the instant thinking completes (`thinking-panel.tsx:39-42`), and — for a panel mounted on an *already-finished* message — starts collapsed rather than replaying the "thinking" animation.
- The reasoning body auto-scrolls to the latest token while active (`thinking-panel.tsx:45-49`) and is capped to a 360px scrollable region once expanded.
- A skill-suggestion "ask" flow (`streaming-message.tsx:34-46,122-128`) can be interleaved into the same message bubble as reasoning/content, with mutually-exclusive display logic (`showGenerating`, `showCaret`).
- The visible streaming caret is deliberately hidden during the `finalizing` phase (`streaming-message.tsx:38`) specifically so the caret-blink→persisted-message swap doesn't visibly pop.

**Strengths:**
1. The "duration = first reasoning token → first answer token" definition is precise, deliberately chosen (not just "total response time"), and directly unit-tested (`tests/streaming.test.ts:13-37`) including the exact assertion that reasoning text is *not* discarded once the answer begins (`tests/streaming.test.ts:34`).
2. The auto-collapse-on-completion + only-animate-if-born-mid-thinking logic (`thinking-panel.tsx:20,39-42`) is a genuinely careful piece of UI state design that avoids two common bugs: replaying an entrance animation on historical messages, and leaving a completed thinking panel stuck open.
3. `reasoningMs` computation guards against `reasoningFirstAt` being unset (falls back to `reasoningStart`, `stream-store.ts:102`), so a turn that transitions straight to content with no reasoning tokens at all still produces a sane (near-zero) duration rather than `NaN`/negative.
4. The `finalizing` phase (`streaming-message.tsx:38`, `use-chat-send.ts:424-426`) is a deliberate, well-commented intermediate state specifically to prevent a visible caret-then-pop artifact during the streaming→persisted swap.
5. `ThinkingPanel`'s live-scroll-to-bottom effect (`thinking-panel.tsx:45-49`) only fires while `active`, correctly not fighting a user who has manually scrolled up in a *persisted* (non-live) reasoning panel.
6. The reasoning text's `aria-live="polite"` on the active thinking-head button (`thinking-panel.tsx:66`) gives screen readers a non-intrusive update as the label changes from "Thinking…" to "Thought for N seconds."
7. Store updates are immutable/functional (`set((st) => ({...}))` throughout `stream-store.ts`), keeping Zustand's shallow-equality re-render optimization intact.

**Weaknesses:**
1. **No visible indication of *effort* or *why* thinking is taking long** — the panel shows only an elapsed-seconds counter (`thinking-panel.tsx:52-55`), with no connection to the selected effort level (e.g., a "Max effort" run vs a "Low effort" run look identical while thinking, aside from actual duration) and no progressive status (e.g., "still thinking" vs "almost done") since the underlying stream provides no such signal.
2. **The 250ms timer interval runs unconditionally whenever `active`** (`thinking-panel.tsx:31-35`) for every currently-thinking message on screen — for a hypothetical multi-conversation or multi-pane view this would be one `setInterval` per active thinking panel with no shared/batched timer, though in the current single-active-stream-per-conversation model this is low practical impact.
3. **`finalSecs` uses `Math.max(1, ...)`** (`thinking-panel.tsx:51`) which means a genuinely near-instant (sub-1-second) reasoning phase always displays as "Thought for 1 second," slightly misrepresenting very fast responses.
4. **No error/timeout state distinct from `active`/inactive for the thinking panel** — if the upstream reasoning stream stalls indefinitely without erroring the whole request, the counter would just climb forever with no "this is taking unusually long" affordance or cap.
5. **Reasoning content is rendered as plain text** (`thinking-panel.tsx:87`: `{reasoning}`), not through `Markdown` — any markdown-like formatting the model emits in its reasoning (headers, code fences, lists) renders as literal characters, an inconsistent experience versus the final answer's fully-rendered markdown.
6. **No test exists for `ThinkingPanel` itself** (component-level render/interaction test) — only the store's accumulation logic is tested (`tests/streaming.test.ts`); the auto-collapse-on-completion behavior, the `active`-vs-persisted initial-collapsed-state branching, and the click-to-toggle interaction are all unverified by any test.
7. **The skill-suggestion "ask" interleaving adds real branching complexity to `StreamingMessage`** (`streaming-message.tsx:34-46`) — five separate booleans (`reasoningActive`, `hasContent`, `isError`, `showSuggestionActions`, `showGenerating`) gate what renders, with no single source-of-truth "phase" enum for the *combined* stream+suggestion state, making the render logic harder to reason about than the underlying `StreamPhase` type alone would suggest.
8. **`hasPendingImage`/`showGenerating` interact in a way that's easy to get wrong on future edits** (`streaming-message.tsx:39-46,70-72`) — e.g. `SkillStatus`/`SearchStatus` are suppressed via `!showGenerating && !hasPendingImage`, a two-condition AND that isn't documented as to why both are needed versus a single combined flag.

**Fixes:**
- Render reasoning content through a lightweight subset of `Markdown` (or at least preserve line breaks/basic formatting) instead of raw text.
- Add a component-level test for `ThinkingPanel` covering: active→inactive auto-collapse, mount-while-active vs mount-while-persisted initial state, and click-to-expand/collapse toggling.
- Consider surfacing effort level subtly in the thinking label (e.g., "Thinking (Max)…") since users already associate cost/depth with effort tier.
- Replace the ad hoc boolean-combination gating in `StreamingMessage` with a single derived `displayPhase` enum computed once, to reduce the chance of a future edit desyncing two of the five flags.
- Add a soft "this is taking longer than usual" affordance after some generous threshold (e.g., 60s) rather than an unbounded climbing counter.

---

## Web search tool & status UI

**What's included:**
- `WEB_SEARCH_TOOL` (`tools.ts:17-47`) is an OpenAI-compatible function tool with `query`/`reason`/`count` (1-10, default 5) parameters, with an extensive description instructing the model to search proactively without asking permission.
- `executeWebSearch` (`tools.ts:111-145`) never throws — configuration-missing, empty-query, and zero-results cases all return a structured `{content, count, sources}` the model can read as an error message rather than crashing the turn.
- Route-level quota enforcement is turn-local *and* pre-existing-usage-aware (`route.ts:372-379`): checks the plan's `searches` limit and the running in-turn `searchCount` against `usageCtx.searches` before allowing each call.
- `SearchStatus` (`search-status.tsx`) renders a morphing chip ("Searching the web for…" → "Found N results for…") with an icon crossfade (spinner→check) and staggered "source pill" reveal, each pill fetching a favicon from `icons.duckduckgo.com` keyed off the result's hostname (`search-status.tsx:119-131`).
- The same `SearchStatus` component renders both live (`live` prop, staggered entrance) and persisted (`live` unset, no replay) search chips (`message.tsx:105-115` vs `streaming-message.tsx:72`).
- `WEB_SEARCH_ADDENDUM` (`prompts.ts:263-274`) gives the model detailed, concrete triggers for when to search (treat its own hesitation phrases as the cue) and when *not* to (stable/timeless knowledge).

**Strengths:**
1. `executeWebSearch` is structured to never throw (`tools.ts:111-145`), meaning a search-provider outage degrades to a model-visible error string rather than crashing the whole streaming turn.
2. Turn-local quota re-checking (`route.ts:372-379`) closes the gap where a single agentic turn issuing several searches could otherwise blow past the monthly cap before the next request's top-level check would catch it (this is called out as a strength in the Rate-Limiting section too, since it applies identically to both tools).
3. The result `count` is clamped server-side (`Math.min(MAX_COUNT, Math.max(1, ...))`, `tools.ts:126-129`) regardless of what the model requests, so a malformed/adversarial tool call can't request an absurd result count.
4. `SearchStatus`'s live-vs-persisted rendering distinction (`live` prop) correctly avoids replaying the staggered pill entrance animation for historical messages (`search-status.tsx:99-105`), consistent with the codebase's general "don't re-animate what's already settled" discipline seen elsewhere (branching handoff, thinking panel).
5. Favicon `<img>` `onError` hides the icon rather than showing a broken-image glyph (`search-status.tsx:127-129`), a small but real polish detail.
6. The search tool's description text is unusually explicit and actionable for the model ("the moment you're about to write 'I don't have up-to-date information'… stop and call web_search instead," `prompts.ts:268`), a genuinely well-engineered prompt for proactive tool use.
7. Sources are passed through end-to-end with a consistent shape (`{title, url}`) from `tools.ts:75-78` through `types.ts:102` to `search-status.tsx`, with no reshaping/renaming at any layer.

**Weaknesses:**
1. **The `reason` parameter is required by the tool schema and explicitly documented as "shown to the user"** (`tools.ts:33-34`: "One sentence explaining why you are searching — shown to the user") **but is never actually surfaced anywhere.** `route.ts`'s `tool_start` handler only extracts and stores `query` (`route.ts:443-444`: `const q = typeof ev.args.query === "string" ? ev.args.query : ""`), and `SearchState` (`stream-store.ts:11-18`) has no `reason` field at all. This is a direct, verifiable mismatch between the tool's own documented contract and its implementation — the model is required to produce a `reason` every single search call for a UI feature that doesn't exist.
2. **Every source pill leaks the visited-domain hostname to a third party (`icons.duckduckgo.com`)** (`search-status.tsx:120-122`) for favicon fetching — a minor but real privacy consideration: rendering search results causes the user's browser to make direct requests to DuckDuckGo's icon service for every distinct hostname in the results, with no first-party proxy/cache.
3. **No de-duplication of identical/near-identical queries within one turn** — if the model calls `web_search` multiple times with the same or very similar `query`, there is no client- or server-side coalescing; each call independently consumes quota (`route.ts:372-379`) and renders its own chip.
4. **No test exists for `executeWebSearch`, `WEB_SEARCH_TOOL`, or `SearchStatus`** — `tests/search.test.ts` exists in the repo but is outside this audit's direct file list and (per the file listing gathered) covers a different search subsystem; nothing in the audited scope directly unit-tests the tool's not-configured/empty-query/empty-results branches or the component's chip states.
5. **The "done" search status update (`route.ts:466-478`) re-sends `d: q` (the query) redundantly on every completion event** even though the client already has the query from the `tool_start` event — a minor payload-size inefficiency repeated on every search.
6. **No cap on the number of distinct searches per turn** beyond the monthly quota — a model that (within the `MAX_ROUNDS` budget) decides to search many times in one turn could burn through a meaningful fraction of a low-tier plan's *entire monthly* search allotment in a single user message, with no per-turn ceiling independent of the monthly one.
7. **Source pills' `title` attribute falls back to the bare hostname when `src.title` is empty** (`search-status.tsx:116`) but there's no truncation for extremely long titles, risking layout overflow in the pill (mitigated only by CSS, not verified here).

**Fixes:**
- Either wire `reason` through to a real UI affordance (e.g., a subtitle under the query in the chip) or remove it from the tool schema/description so the model isn't asked to produce user-facing text that's silently discarded.
- Proxy favicon fetching through a first-party endpoint (or drop favicons) to avoid leaking visited-domain hostnames to DuckDuckGo on every rendered search result.
- Add basic de-duplication of identical queries within a single turn before charging quota for each.
- Add unit tests for `executeWebSearch`'s not-configured/empty-query/no-results branches and a render test for `SearchStatus`'s live vs. persisted, searching vs. done states.
- Consider a per-turn search-count ceiling independent of the monthly quota, to bound single-message cost spikes.

---

## Image generation & vision / document understanding

**What's included:**
- `GENERATE_IMAGE_TOOL` (`tools.ts:49-72`) lets the model generate-from-text or, when the user attaches exactly one image with edit-intent language, edit that image (`hasImageEditIntent`, `route.ts:54-58`, `imageEditRequested`, `route.ts:132-133`).
- `executeGenerateImage` (`tools.ts:147-208`) never throws; re-hosts the provider's temporary URL to permanent Supabase Storage (`storeImageFromUrl`, `tools.ts:187-188`), falling back to the temp URL if re-hosting fails; produces a provider-name-free "notice" string when a premium-model fallback occurred, explicitly counting that result as half a unit (`tools.ts:190-197`).
- Vision (multi-image "what is this" analysis) and Document analysis (scanned PDFs) both route through Gemini (`analyzeImages`, `route.ts:259,290`), each independently plan-gated and quota-checked *before* the call (`route.ts:246-257,276-287`).
- `GeneratedImage`/`GeneratedImageCard` (`generated-image-card.tsx`) implement a shared shimmer→fade reveal for both the live-streaming and persisted-message cases, keyed so the frame persists seamlessly across the loading→done transition (`generated-image-card.tsx:56-60`).
- `AnalyzingImage` (`analyzing-image.tsx`) shows a spinning-arc indicator specifically while an attached image is being vision-analyzed (distinct from the generic "Generating" typing-dots state).
- `GeneratedImageErrorCard` (`generated-image-card.tsx:29-41`) special-cases plan-gate/limit-reached error text into an inline "Upgrade" card by regex-matching the error string.

**Strengths:**
1. `executeGenerateImage` never throws (`tools.ts:147-208`) and always returns a structured result the model and UI can both consume, even on total failure — consistent with `executeWebSearch`'s design.
2. The fallback-to-standard-model notice (`tools.ts:190-193`) is carefully worded to stay entirely within the provider-secrecy invariant ("Forge Image Pro… the standard Forge Image model") while still being honest with the user about a quality/tier downgrade.
3. Re-hosting generated images to permanent storage (`storeImageFromUrl`, `tools.ts:187-188`) with a graceful fallback to the temp URL (`tools.ts:188`: `storedUrl ?? tempUrl`) protects against the common failure mode of provider-hosted images expiring and breaking historical chat messages.
4. Fractional billing for a degraded-fallback image (`count: fellBack ? 0.5 : 1`, `tools.ts:197`) is fair to the user and is consistently reflected in the actual `imageCount` accounting in `route.ts:404`.
5. The vision/document/image-generation quota checks each independently verify plan, feature-specific limit, and current usage *before* doing any expensive work (`route.ts:232-257,276-287`), avoiding wasted Gemini/SiliconFlow calls for requests that would be rejected anyway.
6. The cached-image `complete`/`naturalWidth` ref check (`generated-image-card.tsx:95-97`) is a specific, correct fix for a real browser race (image loading from cache before React attaches the `onLoad` handler).
7. `AnalyzingImage` vs. generic `TypingDots` (`streaming-message.tsx:112-119`) gives the user an accurate signal for *what kind* of work is happening (vision analysis vs. plain text generation), rather than one generic spinner for everything.
8. Image editing correctly requires *exactly one* attached image before treating the request as an edit (`imageEditRequested = images.length === 1 && hasImageEditIntent(...)`, `route.ts:132`), avoiding ambiguity when multiple images are attached.

**Weaknesses:**
1. **`hasImageEditIntent`'s keyword regex is broad and easily false-positive/false-negative.** It matches on common words like `add`, `fix`, `style`, `crop`, `filter` (`route.ts:54-58`) — a message like "add a caption explaining what's happening in this photo" (a vision/description request, not an edit) would be misclassified as edit-intent, silently routing the request to the image-*editing* tool/quota instead of vision analysis, with no way for the user to override the classification.
2. **Scanned-PDF quota is counted per document, not per page** (see also the Rate-Limiting section) — `scannedPdfSchema.pages` has no max length (`types.ts:42-46`) and `documentCount += 1` (`route.ts:292`) counts one unit regardless of how many page-images are sent to `analyzeImages` in that single call, allowing significant quota-amplification for scanned-PDF vision analysis specifically.
3. **`GeneratedImageErrorCard`'s special-case UI is driven by regex-matching the error message string** (`/is available on|limit reached/i`, `generated-image-card.tsx:31`) rather than a structured error code — this couples client presentation logic to exact server-generated wording (`getUpgradeMessage`, `lib/plans/gates.ts:110-113`, and the hardcoded "Monthly image generation limit reached." string, `tools.ts` / `route.ts:391`); a future wording change on either side silently degrades the upgrade-card UI to a plain error div with no compile-time or test-time warning.
4. **No test exists for `executeGenerateImage`'s branches** (not-configured, empty-prompt, fallback-notice, re-hosting failure) — only generic image-public/vision-attachment contract tests exist in the broader suite, none targeting this function's actual logic.
5. **The vision-analysis path re-analyzes every attached image on every message that includes it, with no caching** — if a user attaches the same image across multiple turns (e.g., re-referencing it), each turn re-runs the full Gemini analysis and re-counts against the `vision` quota (`route.ts:246-257`), rather than caching the analysis result per image.
6. **Image-edit mode silently ignores the `prompt`'s relationship to the *actual* uploaded image content** — `executeGenerateImage` passes `inputImageBase64`/`inputMimeType` straight through (`tools.ts:180-183`) with no validation that the "edit" the model describes is coherent with what's actually in the image (impossible to validate generically, but worth noting there is zero sanity-check layer here, only trust in the model's own tool-call args).
7. **`GeneratedImageErrorCard`'s CTA links directly to `/settings#billing`** (`generated-image-card.tsx:33`) with no return/deep-link back to the conversation the user was in — a small UX rough edge for an otherwise polished upgrade flow.
8. **No explicit user-facing indication of how many images/searches/vision calls remain this month** anywhere in the chat surface (only the aggregate token-usage indicator, `usage-indicator.tsx`, exists) — a user only discovers they've hit, e.g., the image-generation cap when a request is actively rejected mid-turn.
9. **Download button for generated images (`generated-image-card.tsx:11-27`) has a bare `window.open` fallback** on fetch failure, which for a cross-origin image URL without appropriate headers may simply open the image in a new tab rather than actually downloading it, with no user-facing message explaining the fallback occurred.

**Fixes:**
- Tighten or replace `hasImageEditIntent`'s keyword regex with a more precise classifier (or require an explicit "Edit" affordance in the UI when an image is attached, rather than inferring intent purely from message text).
- Count scanned-PDF/vision quota by total page/image count actually sent to Gemini, not by request-object count.
- Replace regex-based error-message classification in `GeneratedImageErrorCard` with a structured `{code: "plan_gate" | "limit_reached" | "error"}` field threaded through from the server, matching the pattern already used for the chat route's `plan_gate`/`usage_limit` responses.
- Add unit tests for `executeGenerateImage`'s not-configured/empty-prompt/fallback/re-host-failure branches.
- Cache per-image vision-analysis results (keyed by a hash of the image bytes) within a conversation to avoid re-billing/re-analyzing an image attached across multiple turns.

---

## Skill & agent activation, suggestion flow, and management

**What's included:**
- Skills/agents are activated either explicitly (slash-command picker, `composer.tsx:184-194`; `AgentMenu`, `agent-menu.tsx`) or automatically via two independent heuristics: `detectCreatorIntent` (`intent.ts`) for "create/edit a skill or agent" requests, and a server-classified suggestion pass (`fetchSuggestion` → `/api/suggest-skill`) for "this existing skill would help" cases.
- `detectCreatorIntent` (`intent.ts:23-28`) auto-activates the built-in skill/agent-creator skill with no user confirmation (`use-chat-send.ts:545-554`) — explicitly documented as "automatic, never a suggestion prompt."
- The suggestion pass (`use-chat-send.ts:646-697`) only runs when there's no creator intent, the message is ≥12 chars, and there are eligible, not-yet-declined, not-already-active skills (`use-chat-send.ts:648-657`); it shows a "checking" caret, then either silently proceeds (no suggestion) or types out an "ask" prompt character-by-character (`typeSuggestionAsk`, `use-chat-send.ts:512-523`) and waits for the user's Use/Decline choice.
- Declined suggestions are remembered per-conversation-per-skill (`useSuggestionStore.decline`/`hasDeclined`, `suggestion-store.ts:53-61`) so the same skill isn't re-suggested repeatedly in one conversation.
- `buildActiveSkillTurnInstruction`/`withActiveSkillTurnInstruction` (`skill-execution.ts`) inject an extra, per-turn instruction only when 2+ skills are simultaneously active, explicitly requiring every active skill's deliverable to appear in the answer.
- `useAgentActions.toggleAgent` (`use-agent-actions.ts:21-34`) adopts an agent's default model/effort/thinking/skills as a side effect of activation, and toggling the already-active agent off clears it.
- `SKILL_MANAGEMENT`/`AGENT_MANAGEMENT` (`prompts.ts:282-299`) are injected unconditionally on every turn, making skill/agent creation and editing available regardless of mode or tool availability.

**Strengths:**
1. `detectCreatorIntent`'s regex-based intent detection is thoroughly unit-tested against both true positives and specific false-positive traps ("skill tree," "skill set," `tests/intent.test.ts:31-34`) that a naive regex would otherwise mis-fire on.
2. Agent detection deliberately wins over skill detection when both nouns appear in one sentence (`intent.ts:23-26`, verified by `tests/intent.test.ts:20-22`), a sensible tie-break for the actually-ambiguous "create an agent that bundles my writing skills" case.
3. The suggestion flow's "never re-ask a declined skill in this conversation" behavior (`suggestion-store.ts`, `use-chat-send.ts:656,679`) avoids a real annoyance pattern (repeatedly nagging about the same skill).
4. `pendingRuns` staleness checks (`use-chat-send.ts:516,520,682`: `pendingRuns.get(cid)?.args !== args`) correctly bail out of an in-flight suggestion-typing/checking sequence if a newer `send()` call superseded it — a real race the code explicitly guards against.
5. The multi-skill turn instruction (`skill-execution.ts:14-24`) only activates above a `MIN_MULTI_SKILLS = 2` threshold (`skill-execution.ts:4,8`), correctly avoiding unnecessary prompt overhead for the common single-active-skill case.
6. `parseSuggestedSkillsOutput` (`skill-suggestions.ts:41-89`) is defensively written against malformed model output: it extracts the first `{...}` JSON object from surrounding prose (`extractJsonObject`, `skill-suggestions.ts:24-32`), de-duplicates slugs, validates each slug against the real candidate list (never trusting an invented slug), and caps the reason string length (`cleanReason`, `skill-suggestions.ts:34-39`) — all independently unit-tested (`tests/skill-suggestions.test.ts`).
7. `resolveSkills`/`resolveSkillMeta` (`use-chat-send.ts:146-159`) both filter to `enabled` skills only, so a since-disabled skill can't accidentally remain "active" via a stale slug reference.
8. Activating an agent adopts its full default configuration (model/effort/thinking/skills) as one atomic UI action (`use-agent-actions.ts:26-33`), with a toast confirming exactly what happened, rather than requiring several separate manual settings changes.
9. Marking skills "recently used" (`touchSkillUsed`, `use-chat-send.ts:616`) happens fire-and-forget after send, not blocking the actual chat request.

**Weaknesses:**
1. **The suggestion pass makes a real, separate provider call (`/api/suggest-skill` → `generateText`) on every eligible message**, even short, everyday ones (any message ≥12 characters with any eligible skill present, `use-chat-send.ts:648-657`) — this is an extra network round-trip and provider cost layered in front of *every* qualifying send, before the user even sees their message start streaming, with no caching or client-side heuristic pre-filter beyond the length check.
2. **The suggestion "ask" flow blocks sending entirely until the user responds** (`use-chat-send.ts:690-691`: `return; // wait for the user's choice before generating`) — if the user simply ignores the ask prompt and does nothing, that message effectively never gets answered until they explicitly click Use or Decline; there's no timeout/auto-proceed, and no way to just "send anyway without deciding."
3. **The character-by-character typing animation for the suggestion ask (`typeSuggestionAsk`, `use-chat-send.ts:512-523`) adds `14ms * ceil(length/3)` of pure artificial latency** to every suggestion prompt, purely for visual effect, delaying the moment the user can actually act on it.
4. **`detectCreatorIntent`'s auto-activation has no undo/confirmation** (`use-chat-send.ts:546-554`) — if the regex false-positive-fires (plausible given the broad verb list in `intent.ts:5`, e.g. "let's update this skill set for my character build" in a gaming context could plausibly match depending on exact phrasing) the skill/agent-creator skill is silently activated and shown as a chip with no explanation of *why* it appeared.
5. **Two independent, differently-behaved auto-skill mechanisms coexist** (creator-intent auto-activation with zero confirmation vs. suggestion-pass with an explicit ask) with only a implicit precedence rule (creator intent is checked first and, if it fires, the suggestion pass is skipped entirely for that turn, `use-chat-send.ts:648`) — a maintenance hazard, since a future change to one flow's threshold/candidates could unexpectedly change which path a given message takes.
6. **The active-skill "turn instruction" (`skill-execution.ts:14-24`) is appended to the *last user message's content*** (`skill-execution.ts:37-41`) rather than as a separate system-level instruction — this means the instruction text is visible as part of the persisted user message's wire content sent to the provider on every subsequent turn's resent history (via `toWire`), permanently inflating that one turn's token footprint for the rest of the conversation's lifetime, not just the turn it was generated for.
7. **No test covers the actual suggestion-flow orchestration in `use-chat-send.ts`** (`typeSuggestionAsk`, the `pendingRuns` staleness guards, `resolveSuggestion`) — only the pure parsing/formatting helpers in `skill-suggestions.ts` are tested.
8. **Agent activation via `toggleAgent` silently overwrites the user's current model/effort/thinking** (`use-agent-actions.ts:30-32`) with no confirmation — a user who had deliberately set, say, Max effort, then activates an agent whose `defaultEffort` is Low, loses their setting with only a generic "Using agent: {name}" toast and no indication that model/effort also changed.
9. **`SKILL_MANAGEMENT`/`AGENT_MANAGEMENT` addenda are injected on literally every request regardless of relevance** (`prompts.ts:452-453`), unconditionally adding their full text to every system prompt even for users who never create skills/agents — a smaller, but real, contributor to the unconditional prompt-size tax discussed in the System-Prompt-Assembly section.
10. **The skill/agent "declined" state lives only in client-side Zustand state** (`suggestion-store.ts:17-20`, no persistence), so it resets on page reload — a user who declined a suggestion, then refreshes the page mid-conversation, will be re-asked the identical suggestion again.

**Fixes:**
- Add a lightweight client-side pre-filter (e.g., simple keyword/embedding similarity against skill descriptions) before spending a full provider call on `/api/suggest-skill` for every eligible message.
- Add a timeout or an explicit "Send without a skill" affordance so an ignored suggestion-ask doesn't indefinitely block that message from ever being answered.
- Make the typing-animation delay configurable/skippable (e.g., skip entirely if the user starts typing a new message while it's animating).
- Add a brief, dismissible confirmation ("Detected you want to edit a skill — using the Skill Creator") when creator-intent auto-activates a skill/agent, so the chip's appearance isn't unexplained.
- Move the multi-skill "turn instruction" to a per-request context block (like the collapse summary) instead of appending it to the persisted user message content, so it doesn't permanently inflate that message's resent-history footprint.
- Persist declined-suggestion state (e.g., to the conversation document) instead of only in-memory Zustand, so a page reload doesn't lose it.
- Show a brief diff/confirmation when activating an agent changes the user's current model/effort/thinking, not just a generic "Using agent" toast.

---

## Voice input & text-to-speech

**What's included:**
- Recording: `MediaRecorder` captures audio in 100ms slices (`composer.tsx:513`), capped at 60 seconds (`MAX_RECORDING_SECONDS`, `composer.tsx:27`), auto-stopping via `queueMicrotask` when the cap is hit (`composer.tsx:519`).
- On stop, audio chunks are combined into a `Blob` and POSTed to `/api/voice/transcribe` with a Firebase ID token (`composer.tsx:425-455`), inserted at the textarea caret with smart spacing (`insertTranscript`, `composer.tsx:403-423`).
- Playback: `useTts` (`hooks/use-tts.ts`) fetches MP3 audio from `/api/voice/speak`, plays it via a plain `HTMLAudioElement`, and enforces a **single global active player** — starting a new message's playback stops whatever else was playing (`activePlayer`, `use-tts.ts:18,74-76`).
- Both recording and playback are plan-gated (`voiceInputLocked`/`voiceOutputLocked`, `composer.tsx:85`, `message.tsx:59`) via `getFeatureLimit(plan, "voice_input_minutes"/"voice_output_chars")`.
- `useTts` cleans up its object URL, aborts in-flight requests, and resets state on unmount (`use-tts.ts:125`) and on any playback error (`use-tts.ts:102-105`).

**Strengths:**
1. The single-global-active-player invariant (`use-tts.ts:18,74-76`) correctly prevents two messages' audio from overlapping — a real, easy-to-get-wrong UX bug in any per-message TTS implementation, solved with a simple module-level reference.
2. Recording cleanup on unmount (`composer.tsx:540-553`) explicitly stops the recorder and releases all media tracks, avoiding an orphaned "recording" browser indicator after navigating away mid-recording.
3. `useTts`'s `stop()` correctly detaches `onended`/`onerror` handlers before pausing (`use-tts.ts:40-41`) to avoid a stale-closure callback firing after a deliberate stop.
4. The cached-audio-completes-before-onLoad-style race is handled analogously to the generated-image case: `finish()` and `stop()` both correctly null out `activePlayer` only if it's still `self` (`use-tts.ts:54,68`), avoiding a newer player's state being clobbered by an older one's delayed cleanup.
5. AbortError handling is explicit and deliberately silent (`use-tts.ts:110-113`) for intentional stop/replacement, distinguishing "the user meant to stop this" from "something actually broke" (which does show a toast, `use-tts.ts:104,115`).
6. Recording's 60-second hard cap is enforced by actually stopping the recorder (`composer.tsx:519`), not just freezing a UI counter, so audio capture genuinely can't exceed the intended limit.
7. Both features are gated with the same `openGate`/upgrade-modal pattern used everywhere else in the app (`composer.tsx:526-531`, `message.tsx:245-251`), keeping the upgrade UX consistent.

**Weaknesses:**
1. **No remaining-quota indicator for voice input or output** — both gates (`voiceInputLocked`/`voiceOutputLocked`) are simple booleans ("is this feature available at all"), with no display of remaining minutes/characters before or during use, unlike the token-usage indicator which shows a percentage.
2. **`useTts` has no true stop/interrupt safety for the *fetch* phase** beyond `AbortController` — if `getFirebaseAuth()?.currentUser?.getIdToken()` (`use-tts.ts:81`) hangs (e.g., a slow/misbehaving auth SDK), `play()` has no explicit timeout, only whatever the browser's own fetch timeout behavior provides once the actual request starts.
3. **Voice recording error handling collapses distinct failure modes into one message** — both "no `getUserMedia` support" and permission-denied are reported with different but still-generic copy (`composer.tsx:472-473,479-482`), and there's no distinction for "no microphone hardware present" (`NotFoundError`) vs. "permission denied" (`NotAllowedError`), despite the two needing different user remediation.
4. **The recording timer UI (`rec-timer`, `composer.tsx:777-782`) has no `prefers-reduced-motion` consideration** for its pulsing `rec-dot`, consistent with the broader composer's lack of reduced-motion handling.
5. **No retry affordance for a failed transcription** beyond re-recording from scratch (`composer.tsx:429-432,451-455`) — a transient network blip during `/api/voice/transcribe` requires the user to redo the entire recording rather than just re-submitting the already-captured audio blob.
6. **No test coverage at all for `useTts` or the composer's recording logic** — nothing in `tests/` exercises the single-active-player invariant, the abort/cleanup paths, or the 60-second auto-stop.
7. **`insertTranscript`'s caret-restoration relies on `requestAnimationFrame`** (`composer.tsx:416-420`) with no fallback if the textarea has been unmounted/replaced between the transcription completing and the animation frame firing (low likelihood given the flow, but no defensive `taRef.current` re-check inside the callback beyond the initial capture).
8. **Voice playback audio format/quality has no user control** — no speed/voice selection is exposed in this component (may be a deliberate product scope decision, but there is no user-facing control surface for it in the reviewed files).

**Fixes:**
- Surface remaining voice-input minutes / voice-output characters somewhere in the composer/message action bar, mirroring `UsageIndicator`'s percentage display.
- Distinguish `NotFoundError` (no microphone) from `NotAllowedError` (permission denied) in `startRecording`'s catch block with tailored copy.
- Add a bounded timeout around the `getIdToken()`/fetch sequence in both `useTts.play()` and `transcribeRecording`, with a clear "timed out, try again" message distinct from a generic failure toast.
- Cache the last recorded audio blob briefly so a failed transcription can be retried without re-recording.
- Add tests for `useTts`'s single-active-player invariant and cleanup-on-unmount behavior, and for the composer's 60-second auto-stop.
- Respect `prefers-reduced-motion` for the recording indicator's pulse animation.

---

## Cross-cutting observations (not tied to one feature)

- **Provider secrecy is well-enforced structurally and is backed by tests at multiple layers** (`tests/models.test.ts`, `tests/message-assembly.test.ts`, `tests/prompt-state.test.ts`) — this is the single best-defended invariant in the whole codebase, and no leak of `deepseek`/provider names into any client-visible surface was found in the files read for this audit.
- **The single largest concrete security gap is the missing HTML-sanitization step in the markdown pipeline** (`components/chat/markdown.tsx`, `rehype-raw` with no `rehype-sanitize`/DOMPurify) — see the dedicated section above. This should be treated as the top-priority fix from this entire audit.
- **A recurring theme across features is "no server-side size/count caps on request payloads"** — attachments (images/documents/scanned-PDF pages), skill catalogs, and system-prompt-contributing context blocks are all bounded only by client-side conventions or not at all, never by the zod schemas that actually gate the API. This shows up independently in the Composer, Rate-Limiting, System-Prompt-Assembly, and Image/Vision sections and should be fixed holistically (a shared "request payload budget" validation layer) rather than patched per-endpoint.
- **A recurring cost-accounting gap**: real provider spend (full `prompt_tokens`, hidden collapse-summary calls, hidden skill-suggestion calls) is structurally decoupled from what's billed to the user's quota (`route.ts:488-493`), which is a deliberate design choice documented in comments but worth a holistic cost-model review given how many separate hidden provider calls this audit found (collapse summarization, skill suggestion classification, title generation) on top of the main chat completion.
- **Test coverage is strong for pure/pathologically-testable logic** (tree math, effort ordering, title cleaning, skill-suggestion parsing, prompt-state assembly) **and near-absent for orchestration/integration logic** (the actual route handlers' end-to-end behavior, `use-chat-send.ts`'s send/regenerate/edit/suggestion flows, the provider fallback ladder, `useTts`/recording). The codebase's testing philosophy currently favors unit-testable pure functions over the stateful glue code that most often breaks in production.
