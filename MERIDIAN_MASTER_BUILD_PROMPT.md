# MASTER BUILD PROMPT — "Meridian" AI Chat + Code Platform

**Read this entire document before writing a single line of code.** This is a complete, standalone product specification. Treat every section as a hard requirement unless it says "recommended" or "suggested." Where this document is silent on a detail, resolve it the way the reference materials below resolve it — do not invent behavior that contradicts them.

You are building a production-grade, two-mode AI web platform called **Meridian**:
- **Meridian Chat** — a polished, Claude/ChatGPT-style conversational assistant.
- **Meridian Code** — a Base44/Lovable/Replit-style AI coding workspace (project gallery + IDE + live preview + AI build pipeline) living in the same account, same file system, same design language, reachable via a mode switch in the sidebar.

This is not a prototype. Every screen must be real, working functionality connected to a real backend, with polished empty/loading/error states — no seeded demo data, no fake numbers, no placeholder screens shipped as "TODO." The interactive HTML mockup referenced below is a **chrome/interaction/visual reference**, not the full product — it demonstrates shell behavior and motion with a scripted fake conversation; you must build the real thing behind that shell.

---

## 0. Execution model — how you run this build (Claude, Fable 5 / Sonnet 5 manager-worker split)

This build is executed with **Claude**, using a two-model manager/worker pipeline, not one model doing everything undifferentiated. This is a hard requirement on **how you execute this entire document**, separate from anything about Meridian's own user-facing models (Spark 2.5 / Magnum 2.8, which are a completely different, product-facing concern described in Section 2 — do not conflate the two). In practice this means: the composer/orchestrator role below runs on **Fable 5**, and every delegated implementation task runs on **Sonnet 5** (e.g. as a Claude Code subagent, a separate Claude Code session, or an explicit model-per-role assignment in whatever orchestration tooling you're using) — never the reverse, and never one model doing both roles itself.

- **Fable 5 is the front model — the composer and head manager.** Fable 5 is the only model that reads this entire document, holds the full plan, tracks phase gates (Section 10) and the Definition of Done (Section 11), and makes every judgment call this document leaves open. Fable 5 never writes large batches of implementation code itself. Fable 5's job is: break each phase into small, precise, self-contained units of work; hand each unit to Sonnet 5 as an unambiguous instruction; receive Sonnet 5's completed work back; **actually inspect what Sonnet 5 produced** (read the real diffs/files/output, not just Sonnet 5's self-reported summary of what it did); judge it against the exact spec (the relevant Section 5/6/7/8 requirements, the mockup, and the two reference repos); and either accept it or send Sonnet 5 a precise, scoped correction.
- **Sonnet 5 is the worker model that reports back to Fable 5.** Sonnet 5 receives one task at a time from Fable 5, does the actual implementation (writing files, wiring components, running builds/tests, reading the specific reference-file excerpts Fable 5 points it to), and reports back concisely: what it changed, where, and any open questions or blockers it hit. Sonnet 5 does not reinterpret the master spec on its own initiative and does not decide a task is "close enough" — it executes exactly what Fable 5 asked for and returns control to Fable 5.
- **The fix loop is always Fable 5 → Sonnet 5, never Sonnet 5 self-correcting in isolation.** If Fable 5 finds anything wrong, missing, inconsistent with the mockup/reference repos, or in violation of any invariant in Section 6 — Sonnet 5 did not sanitize the markdown pipeline, an animation was skipped, a path-safety check was only added client-side, a Stripe route was left unauthenticated, whatever it is — Fable 5 is the one that diagnoses the gap and writes the next instruction to Sonnet 5. Sonnet 5 fixes exactly that and reports back. Repeat until Fable 5 confirms the task fully satisfies its slice of Sections 5–8 and Section 11.
- **Why this split exists: it saves usage.** Keep the expensive, full-context, whole-document reasoning concentrated in Fable 5. Sonnet 5 should be handed the smallest slice of context it needs to do one job correctly — the specific subsection number(s), the specific file path(s), the specific reference-file excerpt(s) it needs to match (a named animation from Section 5's table, a token block from Section 3, a specific audit-derived fix from Section 8) — not the entire 900-plus-line master document re-read on every task. Fable 5 is responsible for extracting exactly the relevant slice for each task so Sonnet 5 never has to re-derive context Fable 5 already holds.
- **Practical task-handoff discipline Fable 5 must follow every time:** never hand Sonnet 5 a vague instruction like "build the composer" or "add the animations." Every instruction Fable 5 sends to Sonnet 5 must include: (1) the exact section number(s) of this document it implements, (2) the exact file(s) it touches or creates, (3) the exact acceptance criteria Fable 5 will check against (quote the relevant checklist row(s) from Section 5, invariant(s) from Section 6, or feature requirement(s) from Section 8 verbatim), and (4) which reference file(s)/path(s) Sonnet 5 should read for that specific task (a specific CSS block in the mockup, a specific component in ForgeOS, a specific keyframe in DeepCode) rather than pointing Sonnet 5 at an entire reference repository to explore unguided.
- **Fable 5 owns phase-gate approval.** Per Section 10, Fable 5 does not advance to the next phase until Fable 5 has personally verified — by reading the actual output, running the app, checking both themes — that every Sonnet-5-completed task in the current phase satisfies Section 11's Definition of Done. Sonnet 5 completing a task and reporting success is not sufficient on its own; Fable 5's independent verification is what actually closes a task.
- **Parallelize where safe, serialize where not.** Fable 5 should identify which of a phase's tasks are independent (e.g., two unrelated components, or a backend route and an unrelated UI screen) and can be handed to Sonnet 5 in parallel (e.g. multiple concurrent Sonnet 5 subagents/sessions) to save wall-clock time, versus which tasks have real dependencies (e.g., the token system in Section 3 must exist before any component styled against it) and must be sequenced.

---

## 1. Required reading — do this first, in this order

You have four source materials. Read all of them before starting. Do not skim — the whole point of this exercise is that the previous iteration of this product (ForgeOS) was already built and exhaustively audited, and you are building the next, corrected, better-designed generation of it. Ignoring the audit means repeating its bugs.

1. **`C:\Users\jbrk1\AppData\Local\Temp\claude\C--Users-jbrk1-Desktop-ForgeOS\c9a2807a-2499-4a7f-97f3-21ab23f9912c\scratchpad\meridian-ui-mockup.html`**
   This is the authoritative **visual and interaction design reference**. It is a single self-contained HTML/CSS/JS file implementing the app shell (sidebar, mode switch, thread list, topbar, composer, effort/model menus, theme toggle) with a scripted demo of a full conversation turn. Open it, read every CSS custom property, every class, every `@keyframes` block, and every line of the `<script>` at the bottom. This defines:
   - The exact color system (light + dark, via `prefers-color-scheme` and `[data-theme]` attribute override) — do not deviate from these hex values and roles.
   - The exact typography stack (`--font-display` serif for hero/headings, `--font-body` system sans for everything else).
   - The exact spacing, radius, and shadow scale.
   - The exact shell layout (272px sidebar, collapsible to 0, grid-based main content).
   - The exact composer anatomy (glass, blurred, floating pill with attach/thinking/web-search/effort controls on the left, dictate/model/send on the right).
   - The exact motion vocabulary used throughout (enumerated fully in Section 5).
   - The exact micro-interaction choreography for: sending a message, streaming a response, showing a "thinking" reasoning trace, attaching a file, switching effort level, switching model, dictating by voice, deleting a thread, collapsing the sidebar, opening the user menu, toggling light/dark theme, and showing a toast.

   **Everything in this mockup must exist in the real product**, wired to real state and a real backend, not a scripted timer. Where the mockup's script fakes something (e.g. transcribing dictation to a hardcoded string, a canned assistant response, a `setTimeout` demo loop that replays forever), replace it with the real, working feature — the animation and timing feel is what you're keeping, not the fakery.

2. **`C:\Users\jbrk1\Desktop\ForgeOS`**
   This is the **previous-generation implementation** of this exact product (it was called "Forge OS" before this rebrand to "Meridian"). It is a working Next.js codebase. Use it as your **animation and interaction-completeness reference**: its `app/globals.css` and component files contain a large, mature vocabulary of micro-interactions (toast slide-in/out, confirm-dialog rise, message stream-in, code-block copy/download affordances, thinking-panel shimmer and auto-collapse, effort-dot pop, model-menu swap, mic recording pulse and spinner, sidebar active-item indicator, drag handles, skeleton loaders, build-dock progress states, checkpoint restore confirmations, command palette open/close, etc.). Read `app/globals.css` in full (it is ~5,400 lines — read it in chunks) plus the component files under `components/` to build a complete inventory of every animated interaction the previous product had. Use this inventory as your checklist of animations that must exist somewhere in the new build, so that nothing from the mature prior implementation is regressed or forgotten.
   Also read `FEATURE_AUDIT.md` and `FullAuditReport.md` at the root of this repo (identical content) — this is the exhaustive, code-cited audit of that prior implementation covering all 34 features, their strengths, and their concrete, evidenced bugs/security gaps. **This audit is Section 8 and Section 9 of this document, effectively — every weakness it documents is a requirement in this build to fix, not repeat.**

3. **`C:\Users\jbrk1\Desktop\DeepCode`**
   This is your **"Liquid Glass" visual/motion style reference**. It is a separate Electron-based AI workbench product sharing the same design lineage (warm monochrome surfaces, DeepSeek-blue accent, hairline borders) but with a more developed **glass/translucency motion system**. Read `src/renderer/styles/tokens.css`, `src/renderer/styles/global.css`, and `src/renderer/styles/chrome.css` in full. Its `@keyframes` vocabulary (`glass-sweep`, `surface-rise`, `popover-in`, `modal-in`, `scrim-in`, `search-reveal`, `shimmer`, `count-pop`, `scan-x`, `icon-halo`, `pulse-dot`) and its liquid-glass token block (`--glass-bg`, `--glass-border`, `--glass-blur: 18px`, translucent panel backgrounds with `backdrop-filter: blur(...) saturate(...)`, soft layered shadows, spring-eased reveals) define **how everything in the new product should move and feel materially** — glassy, translucent, softly blurred surfaces that sweep/rise/reveal into place rather than snapping or hard-cutting.

### 1a. The animation sourcing rule (read carefully, this governs every motion decision in the build)

For **every** interactive animation/transition the product needs (anything in the mockup's motion vocabulary, anything in ForgeOS's animation inventory, and any other micro-interaction natural to a chat/code product):

1. **Check DeepCode first.** If DeepCode already implements an equivalent animation or motion pattern (e.g. a menu/popover opening, a modal appearing, a panel sliding in, a scrim fading, a shimmer/loading effect, a count-up, a sweep reveal) — **use DeepCode's version as the authoritative implementation**: its easing curves, durations, blur/translucency treatment, and keyframe structure. Port it directly into the new codebase's design system, adapted to this project's component structure.
2. **If DeepCode has no equivalent** for an animation that exists in the mockup or in ForgeOS's inventory (e.g. the mockup's send-button "fly" micro-animation, the effort-dot color-coded pop, the mode-switch sliding thumb, the mic recording pulse ring, the thread-list active-item accent bar, the model-pill flash-on-change, the theme-toggle radial sweep, the skill/agent chip pop-in, the build-dock pipeline stage rail, the checkpoint restore confirmation) — **take the animation's behavior/timing/trigger from ForgeOS (or the mockup, whichever actually defines it)**, but **re-skin its visual treatment into DeepCode's Liquid Glass material language**: translucent/blurred backgrounds instead of flat opaque ones, DeepCode's softer layered shadow stack (`--shadow-pop`, `--shadow-composer`, `--shadow-pop-soft`), DeepCode's spring/ease-out curves, and glass-sweep-style reveals instead of hard fades where a surface is appearing/disappearing.
3. **Never regress a working animation.** If both source repos define the same interaction with different quality bars, take the more polished, more physically-plausible one and give it DeepCode's material finish.
4. Build a literal checklist (see Section 5) as your own internal tracking artifact before starting UI work, and do not consider a component "done" until every row in that checklist that applies to it is implemented and visibly correct in both light and dark themes.

---

## 2. Product identity

- Product name: **Meridian**. Two modes: **Meridian Chat** and **Meridian Code**, switched via the sidebar segmented control exactly as shown in the mockup (sliding thumb, icon "pop" animation on activation).
- Logo mark: the compass/orbit glyph from the mockup (`<svg>` circle + arc + center dot, drawn in `--accent`) — used at 26px in the sidebar header and 46px (floating, slow vertical bob animation `esFloat`) in the empty-thread hero state.
- Two user-facing model names, **never** the real underlying provider:
  - **Spark 2.5** — fast, efficient, default for everyday work.
  - **Magnum 2.8** — slower, deeper reasoning, for hard problems and all Code-mode builds.
  - These are the ONLY model names a user, a network payload, an error message, a log line, or a prompt ever contains. See the provider-secrecy invariant in Section 7 — this is the single most important rule in the entire build and the prior implementation both got very right (a clean two-file split) and got subtly wrong (leaking real provider names in Gemini/SiliconFlow/E2B error strings). Do not repeat that mistake anywhere, including in adjacent subsystems (vision, image generation, voice, code execution) that use different underlying vendors than chat does.
- Brand voice: calm, quiet, "document-grade" typography (serif display face for hero moments and section headers, system sans everywhere else), warm off-white/near-black neutrals, a single blue accent, muted secondary tones for status. No loud gradients, no neon, no generic "AI product" purple/violet clichés.

---

## 3. Design system — extracted from the mockup, hardened into a real token system

Implement this as a real CSS custom-property design system (Tailwind v4 CSS-first `@theme` bridge, or an equivalent token layer), themed via a `[data-theme="light"|"dark"]` attribute on `<html>`, cookie-driven, resolved server-side for SSR with **no flash** — and, unlike the prior implementation's confirmed bug, made to **actually honor `system` preference at the SSR layer** (render a `prefers-color-scheme` CSS fallback block scoped to "no explicit `data-theme` attribute yet" so that a `system`-preference user never sees a false light flash before the client script corrects it, and so that no-JS/CSP-blocked visitors still get the right theme from CSS alone).

### 3.1 Color tokens (light theme — from the mockup, use verbatim as your light palette)

```
--bg-0: #F4F1F5;            /* app base */
--bg-sidebar: #F8EEED;      /* sidebar surface, warmer than base */
--bg-1: #FFFFFF;            /* cards, panels, popovers */
--bg-2: #EEEEEC;            /* hover / secondary surface */
--bg-3: #E1E0DD;            /* pressed / tertiary surface */
--border: #E9E8E5;
--border-soft: #ECEAE7;
--border-strong: #DEDEDE;
--text-0: #262420;          /* primary text */
--text-1: #373633;          /* secondary text */
--text-muted: #9C9B97;
--text-faint: #C8C6C1;
--accent: #4D6BFE;          /* single accent, "DeepSeek blue" lineage — keep this exact hue */
--accent-ink: #FFFFFF;      /* text on accent */
--accent-glow: rgba(77, 107, 254, 0.16);
--danger: #D2554F;
--ok: #2E9B5B;
--focus-outline: #1683FF;

--glass-bg: rgba(255, 255, 255, 0.72);
--glass-blur: 18px;
--pop-bg: rgba(255, 255, 255, 0.95);
--pop-border: #E1E0DC;
--sheen-top: rgba(255, 255, 255, 0.75);
--sheen-edge: rgba(255, 255, 255, 0.8);
--input-bg: rgba(255, 255, 255, 0.84);

/* effort scale — cool to warm, one hue per intensity stop */
--e1: #4D6BFE;   /* Low */
--e2: #1F9D8C;   /* Medium */
--e3: #D99A2B;   /* High */
--e4: #D97A2B;   /* xHigh */
--e5: #D2554F;   /* Max */
```

### 3.2 Color tokens (dark theme — from the mockup, use verbatim as your dark palette)

```
--bg-0: #17151A; --bg-sidebar: #1C1719; --bg-1: #211D22; --bg-2: #2A262B; --bg-3: #332E34;
--border: #322D33; --border-soft: #2B262B; --border-strong: #3D353C;
--text-0: #F1ECEE; --text-1: #CDC6C9; --text-muted: #948D92; --text-faint: #625B60;
--accent: #7F96FF; --accent-ink: #10142B; --accent-glow: rgba(127,150,255,0.22);
--danger: #E5665C; --ok: #3FBE79;
--glass-bg: rgba(26, 22, 28, 0.62); --pop-bg: rgba(28, 24, 30, 0.92); --pop-border: rgba(255,255,255,0.09);
--sheen-top: rgba(255,255,255,0.06); --sheen-edge: rgba(255,255,255,0.05); --input-bg: rgba(255,255,255,0.05);
--e1: #7F96FF; --e2: #3FC4B2; --e3: #E8B158; --e4: #E8925A; --e5: #E5665C;
```

Cross-check every token above against **DeepCode's `tokens.css`** as well — the two systems are close cousins (same warm-neutral + single-blue-accent lineage, same glass tokens, same shadow-scale naming). Where DeepCode's dark-mode or elevated-surface handling is more refined (e.g. its distinct `--bg-hover`, `--hover-strong`, `--pill-border`, or its `--shadow-focus` ring using `color-mix`), prefer DeepCode's refinement layered on top of the mockup's base palette — do not simply pick one file and ignore the other; merge them, mockup values winning on anything the mockup defines explicitly, DeepCode filling gaps and supplying the glass motion layer.

### 3.3 Typography

- `--font-display`: `ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif` — used only for the empty-state hero headline and major section titles.
- `--font-body`: `-apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` — used everywhere else, including all UI chrome, chat bubbles, and composer text.
- Add a `--font-mono` (`'Cascadia Code', 'JetBrains Mono', 'SF Mono', 'Consolas', ui-monospace, monospace` — from DeepCode) for all code blocks, diffs, and the Code-mode editor.
- System-font-only stacks by design (no remote font loading) — this avoids CSP/webfont-blocking issues DeepCode's own token comment explicitly calls out; keep this constraint.

### 3.4 Radii, shadows, easing

```
--radius: 12px; --radius-sm: 9px; --radius-lg: 22px; --radius-pill: 999px; --radius-composer: 20px;
--shadow-card: 0 1px 3px rgba(20,20,25,.06), 0 0 0 1px var(--border);
--shadow-pop-soft: 0 20px 58px rgba(20,20,25,.13), 0 4px 14px rgba(20,20,25,.06);
--shadow-composer: 0 10px 30px rgba(20,20,25,.08), 0 1px 2px rgba(20,20,25,.04);
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-smooth: cubic-bezier(0.2, 0.8, 0.2, 1);
--motion-fast: 140ms; --motion-med: 200ms; --motion-slow: 260ms;
```
Respect `@media (prefers-reduced-motion: reduce)` globally by collapsing all animation/transition durations to effectively zero, exactly as the mockup does (`* { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }`) — this must apply to every animation added from any of the three sources, with no exceptions.

---

## 4. Site map / information architecture

```
/                       — Chat (mode: chat), empty-state hero or active thread, redirects to last/new thread
/c/[id]                 — a specific chat thread
/code                   — Code mode gallery (project grid, new-project modal)
/code/[id]              — a specific project's IDE (file tree + editor + preview + build dock)
/agents                 — Agents management (create/edit/duplicate/import/export)
/skills                 — Skills management (create/edit/duplicate/import/export)
/settings               — Appearance, Usage, Plan & Billing, Defaults, Personalization, Memory, Data & Account
/sign-in                — Auth entry point
/p/[id]                 — Public, unauthenticated rendering of a published artifact (sandboxed)
/api/**                 — All server route handlers (see Section 9)
```
Sidebar, topbar, composer, command palette (⌘/Ctrl+K), and theme toggle are global chrome present on every authenticated route, per the mockup and per ForgeOS's `app-shell`/`sidebar`/`topbar`/`mode-switcher`/`command-palette` components.

---

## 5. Full animation & micro-interaction checklist

Build every row below. Column "Source" tells you where the authoritative behavior/timing comes from per the rule in Section 1a; "Material" tells you what finish to apply per that same rule.

| # | Interaction | Source (behavior/timing) | Material (visual finish) |
|---|---|---|---|
| 1 | Mode-switch sliding thumb + icon "pop" on activation (`segIconPop`) | Mockup | DeepCode glass surface under the thumb |
| 2 | Sidebar collapse/expand (grid-template-columns transition) | Mockup + ForgeOS (mobile off-canvas drawer + scrim) | DeepCode `scrim-in` for the mobile scrim |
| 3 | New-thread button hover lift (icon translateY) | Mockup | as-is |
| 4 | Thread-list active-item accent bar slide-in (`navDotIn`) | Mockup | as-is |
| 5 | Thread delete: item scale/fade out before removal | Mockup | as-is |
| 6 | Thread rename / hover reveal of delete button (opacity+translateX) | Mockup | as-is |
| 7 | User menu / account popover open (`fadeRise`) | Mockup | **Replace with DeepCode `popover-in`/`surface-rise`** — glassy blurred panel, spring rise |
| 8 | Command palette open/close, list filtering | ForgeOS (real fuzzy-ranked results, see Section 8.22) | DeepCode `modal-in` + `scrim-in` |
| 9 | Model pill "flash" on model change (`pillFlash`) | Mockup | as-is, but panel it opens from should use DeepCode popover treatment |
| 10 | Text swap-in on model/effort label change (`swapIn`, blur+translateY) | Mockup | as-is |
| 11 | Effort menu open, per-effort color dot, checkmark "pop" on selection (`checkPop`) | Mockup | DeepCode `popover-in` panel |
| 12 | Model menu open, option highlight, checkmark pop | Mockup | DeepCode `popover-in` panel |
| 13 | Hero empty-state logo slow float (`esFloat`) | Mockup | as-is |
| 14 | Suggestion chip hover (border/color transition) | Mockup | as-is |
| 15 | User/assistant message entrance (`msgIn`, rise + fade) | Mockup + ForgeOS message-in | as-is |
| 16 | Streaming text caret blink (`blink`) | Mockup | as-is |
| 17 | Token-by-token / chunked streaming reveal | ForgeOS (real NDJSON stream → store → render, not a demo `setInterval`) | n/a (functional, not purely visual) |
| 18 | "Thinking" reasoning line: spinner (`spin`), shimmering label text while live (`shimmerText`), collapse/expand chevron rotation, auto-collapse on completion, elapsed-seconds counter live then final duration | Mockup + ForgeOS `thinking-panel` | as-is |
| 19 | Typing/generating dots (`typingDot`) before first token arrives | Mockup | as-is |
| 20 | Copy button on completed assistant message, with pop-in checkmark confirmation (`copyPop`) reverting after ~1.3s | Mockup | as-is |
| 21 | Attachment thumbnail card hover lift/shadow | Mockup | as-is |
| 22 | Attachment chip pop-in (`chipIn`) and remove | Mockup | as-is |
| 23 | Composer glass panel focus ring + border color change | Mockup | DeepCode blur/saturate treatment on the glass background |
| 24 | "Add" (+) menu open, icon 90° rotation on hover | Mockup | DeepCode `popover-in` |
| 25 | Tooltip reveal (`data-tip`) with delayed appearance | Mockup | as-is |
| 26 | Send button: idle → "flying" paper-plane micro-animation on send (`sendFly`), morphs to stop/red square while streaming (`stopPop`), reverts on completion | Mockup | as-is |
| 27 | Dictation mic button: idle → recording (pulsing red ring `micPulse`, live blinking rec-dot `recDotBlink`, live mm:ss timer) → transcribing (spinner `micSpin`) → idle with transcript inserted at caret | Mockup, wired to a **real** MediaRecorder + real transcription API (see Section 8.11), not the mockup's hardcoded "Looks great, thanks!" string | as-is |
| 28 | Theme toggle: radial "sweep" transition from the FAB's screen position, cross-fading the whole page color scheme (`themeSweep`, using `--sx`/`--sy` CSS vars set from click coordinates) | Mockup | as-is — this is already glass/blur-flavored and matches DeepCode's material language well |
| 29 | Toast notifications: slide/scale in from the bottom-right (`toastIn`), auto-dismiss with fade/slide out | Mockup | DeepCode's shadow-pop-soft + glass background |
| 30 | Skeleton/shimmer loading states for thread list, project gallery, and any first-load list | ForgeOS (skeleton placeholders) | DeepCode `shimmer` keyframe |
| 31 | Toast/confirm-dialog modal rise on destructive actions (delete chat, delete project, restore checkpoint) | ForgeOS `confirm-dialog` | DeepCode `modal-in` + `scrim-in` |
| 32 | Build-dock pipeline stage rail (Analyze → Retrieve → Plan → Execute → Verify → Fix → Finalize) with active/complete/error state per stage | ForgeOS `build-dock` | DeepCode glass panel chrome |
| 33 | Live diff/file-list rows during a build (+/- counts, NEW tag, per-file writing/done spinner) | ForgeOS `build-dock` | DeepCode `pulse-dot`/`scan-x` for "in progress" rows |
| 34 | Checkpoint save/restore confirmation and success state | ForgeOS `checkpoints-modal` | DeepCode `modal-in` |
| 35 | Code-runner output panel reveal and streaming stdout | ForgeOS `script-runner-pane` | DeepCode `surface-rise` |
| 36 | File-tree drag-to-move, context menu, rename-in-place | ForgeOS `file-tree` | DeepCode popover/context-menu chrome |
| 37 | Skill/agent "save card" appearing inline in chat when the model proposes one, with pop-in | ForgeOS `skill-save-card`/`agent-save-card` | DeepCode `surface-rise` |
| 38 | Usage indicator bar: color escalation (hidden <80%, amber 80–94%, orange 95–99%, pulsing red at 100%) | ForgeOS `usage-indicator` | as-is |
| 39 | Count-up animation for any numeric stat (usage numbers, file counts) | ForgeOS `count-up` | DeepCode `count-pop` |
| 40 | Success checkmark draw-in for completed async actions | ForgeOS `success-check` | as-is |
| 41 | Connection-status indicator (online/offline) appearing/disappearing | ForgeOS `connection-status` | DeepCode `surface-rise` |
| 42 | Artifact card / preview panel: Preview↔Code tab switch, expand to modal, "creating file" streaming shimmer while an artifact is being generated | ForgeOS `artifact-card`/`artifact-panel`/`artifact-modal` | DeepCode `surface-rise` + `shimmer` |
| 43 | Search-status chip: "Searching the web for…" → "Found N results", animated in with source favicon pills | ForgeOS `search-status` | DeepCode `search-reveal` (use directly, this is a near-literal match) |
| 44 | Voice generation ("read aloud") button loading/playing state | ForgeOS message read-aloud | as-is |
| 45 | Generated-image card: shimmer skeleton → fade/scale reveal | ForgeOS `generated-image-card` | DeepCode `shimmer` |
| 46 | "Analyzing image" chip: spinning arc + scan icon | ForgeOS `analyzing-image` | DeepCode `scan-x` |
| 47 | Plan-gate / upgrade modals and pills (locked feature affordances) | ForgeOS `plan-gate-modal`/`usage-limit-modal` | DeepCode `modal-in` |

This table is a floor, not a ceiling — where a screen needs a transition not listed above (e.g. project-gallery card hover, settings-section save-button loading spinner, agent/skill editor field focus states), apply the same sourcing rule: real interaction behavior from ForgeOS if it already has an equivalent, Liquid Glass material finish from DeepCode, spring/ease curves from the token set in Section 3.4.

---

## 6. Non-negotiable invariants

These are absolute. Every one of them maps to a specific, evidenced failure found in the prior implementation's audit — do not treat any of these as optional polish.

1. **Provider secrecy, enforced everywhere, not just chat.** The real backing model/vendor for chat (whatever you choose — DeepSeek, or any other provider) must be knowable to exactly one server-only module in the whole codebase, imported by exactly one other server-only module (the streaming client), and never referenced — not in code comments, not in log lines, not in error messages, not in test fixtures beyond that one module's own tests. This same rule applies to **every other AI-adjacent vendor you integrate**: vision/image-understanding, image generation, text-to-speech, speech-to-text, web search, and sandboxed code execution. **Every error path from every one of these vendors must be caught and rewritten into a generic, branded, provider-free message before it can reach a client response, a client-rendered error card, or a browser console.** Write an automated test (grep-based or otherwise) that fails CI if any of your provider/vendor identifier strings ever appear in `app/`, `components/`, or any client bundle output. This exact class of bug (a real vendor name naming itself in a user-visible error string) was found independently in three different subsystems of the prior product — treat it as the single highest-value thing to get right structurally, with an enforced boundary, not just a code-review habit.
2. **No placeholder, demo, or seeded data, anywhere, ever.** Every list, every stat, every empty state must reflect real backend state. Empty states must be genuinely polished (real copy, real call-to-action, no "Lorem ipsum," no fake example rows).
3. **Markdown/rich-text rendering must be sanitized.** If you allow raw HTML in rendered markdown (for tables, custom formatting, etc.), you must run it through an HTML sanitizer (e.g. `rehype-sanitize` with an explicit allowlist, applied after any raw-HTML parsing step) before it ever reaches the DOM. This is a mandatory pipeline stage, not optional — the prior implementation shipped `rehype-raw` with zero sanitization, a live stored-XSS surface from any model output or pasted user content.
4. **Never write AI-generated/user-generated HTML/JS into a same-origin context.** Any live preview or "artifact" rendering of generated code must render inside a sandboxed `<iframe sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock">` with **`allow-same-origin` always omitted**, so the framed document gets a genuinely opaque origin and can never read the host app's cookies, auth tokens, or `localStorage`. Provide a storage shim (polyfilled `localStorage`/`sessionStorage`) injected into the framed document so this doesn't break apps that touch storage — do not "fix" the resulting `SecurityError` by re-adding `allow-same-origin`. **Any "open in new tab" or "open in new window" action for previewed/generated content must preserve this sandboxing** — do not `window.open("", "_blank")` and `document.write()` the content into a popup, since a same-origin popup opened that way inherits the opener's origin and can reach back into `window.opener`, fully defeating the iframe sandbox. Instead, either (a) route "open in new tab" through your own public, sandboxed `/p/[id]`-style rendering page loaded via `<a target="_blank" rel="noopener noreferrer">` to a real URL (not `document.write`), or (b) omit the feature entirely for untrusted content.
5. **Any publicly-shareable resource (a published artifact, a public page) must check ownership before allowing overwrite**, not just on creation. If a resource is addressed by an ID that appears in a public URL, generate that ID with a cryptographically strong random generator (not `Math.random()`), and require the authenticated caller to already own the existing row before permitting an update/overwrite of it.
6. **Rate limiting must be real and durable**, backed by a shared store (Redis/Upstash, or an atomic database counter) that works correctly across multiple server instances/serverless invocations — not an in-memory `Map` that silently resets per instance and silently no-ops if a config env var is unset. Any rate limit must fail *closed* enough to matter (a sane hardcoded default if config is missing) rather than fail open to "unlimited."
7. **Usage-quota and any consumption-metered feature (chat tokens, code executions, image generations, voice minutes) must be enforced with a reserve-then-commit pattern**, not check-then-act. Reserve/hold the estimated cost atomically before starting expensive work; commit or release the reservation when the work finishes or fails. This closes the exact concurrent-request quota-bypass race found in the prior implementation, where quota was only checked (not reserved) before a long-running streamed response, letting several simultaneous requests all pass the same pre-request check and all overspend afterward.
8. **Any admin/debug/introspection endpoint is either deleted before shipping, or gated behind a real authorization check** (an explicit admin role/claim on the verified user, checked server-side) plus environment gating (never enabled outside a genuinely non-production environment). A "temporary" debug route that leaks configuration, billing, or pricing data with no auth check at all is not acceptable in a reviewed build — if you build one during development for your own use, delete it or gate it before calling any phase "done."
9. **Any tool that shows a user their own live, fully-assembled system prompt (an "instruction inspector"/"active instructions" transparency feature) is fine to build, but must (a) only ever assemble and return the requesting user's own real context, (b) strip/redact any internal-only directive blocks not meant for end-user eyes before returning the string, and (c) not be silently promoted into a global, unauthenticated-by-role command-palette entry available to every signed-in user without at least being a deliberate, documented product decision — do not ship a debug tool that quietly became a production feature with no access control simply because "the auth check passes for any signed-in user."
10. **Arbitrary code execution (a "run this code" sandbox feature) must have per-user/per-minute rate limiting in addition to any monthly quota**, an output size cap on returned stdout/stderr, and an atomic quota-check-and-increment (not check-then-increment) so concurrent requests can't exceed a monthly cap. Sandbox execution must happen in a genuinely isolated remote execution environment (not local `eval`/`vm`/`child_process` in your own server process), always torn down deterministically even on error.
11. **Any writable file-path input (project files, uploads, imports) must be validated server-side, at the point of every write, not just client-side or from a single caller in the pipeline.** Reject empty/absolute/drive-letter/UNC/URL-scheme/home-relative/`..`/control-character/over-long/over-deep paths at the actual persistence layer, not only from one UI entry point that happens to call a validator today. Every server route that accepts a path or project ID must re-verify the resource belongs to the authenticated caller — never trust a client-supplied project/file ID without a server-side ownership check on every single route, including bulk/import routes.
12. **Pick one primary application database/auth stack and keep your own documentation in sync with it for the life of the project.** Do not let a product-spec document describe one persistence model (e.g. a document database with a specific per-user tree structure) while the actual code silently migrates to a completely different one (e.g. a relational database with different security semantics) without updating that documentation and removing any now-dead configuration (e.g. security rules files for a database engine you no longer use for that data). If you keep an auxiliary storage system for one specific purpose (e.g. binary blob storage) that's fine — just document exactly what lives where, and don't let stale comments/types describe an architecture that no longer exists.
13. **Test the code paths that actually carry risk.** Every payment/webhook handler, every quota check/deduct path, every path-safety validator, every access-control boundary (ownership checks, admin gates) must have real automated test coverage — not just the pure utility functions that happen to be easy to test. If you find yourself with thorough tests for string-formatting helpers and zero tests for "can user A overwrite user B's billing state," that imbalance is itself a defect to fix before shipping.
14. **A verification/review pipeline you build must actually run.** If you build a secondary "strict reviewer" pass (an LLM-based verifier that checks a build/response before presenting it as done, for example), do not gate it behind a hardcoded feature flag left permanently off in the shipped build. If a feature is disabled for a real reason (cost, latency, reliability), make that a real, documented, configurable decision — not a forgotten `const enabled = false`.

---

## 7. Non-negotiable product principles (carried over verbatim, they were correct)

- Build in clear, sequential phases; each phase should ship fully working and visually finished in **both themes** before the next phase starts. Do not leave a phase half-wired ("the button exists but does nothing") and move on.
- Prefer a small number of well-tested, purpose-built components over a wrapped-third-party design system if you want exact visual control — this is a legitimate, deliberate choice (the prior implementation called this out explicitly as a documented deviation from an original "restyled shadcn/ui" spec, and it was the right call). If you do this, budget real time for accessibility hardening (focus traps, `aria-live` regions, keyboard navigation, return-focus-on-close) as an explicit, tracked phase — don't let "ship the visual system first" quietly become "never do the accessibility pass."
- Keep your design tokens in one well-organized, namespaced place. A single, giant, unstructured CSS file is an anti-pattern that produces real bugs (the prior implementation had a genuine duplicate-class-name collision bug and an undefined-variable bug hiding in a 5,400-line unstructured file) — split by feature/section, or at minimum keep rigorous section banners and periodically grep for accidental duplicate selectors as part of your own QA.

---

## 8. Full feature specification

Build every feature below. Each entry states the real requirement, folding in the corresponding fix for whatever the audit found wrong with the prior version. Organize your own codebase however makes sense, but nothing on this list is optional, and none of the audit-derived fixes are optional either.

### Meridian Chat

**8.1 Authentication & account gate**
Real email/OAuth sign-in (Google at minimum, matching the mockup's account surface). Server-side session/token verification on every authenticated request — never trust a client-supplied user ID. Graceful, real (not blank-screen) UI for "not configured yet" and "not signed in" states. Idempotent profile provisioning on first sign-in. Specific, actionable error copy for popup-blocked/unsupported-storage/unauthorized-domain failure modes. Surface a real error state (with retry) if profile provisioning fails after a successful sign-in — never leave a signed-in user with a silently-null profile and no feedback.

**8.2 Model selection & provider secrecy**
Exactly two user-facing models (Spark 2.5 / Magnum 2.8) per Section 2. Enforce the full Section 6.1 invariant. No dead exports that bundle a public label together with the private provider string in one object (the kind of "attractive nuisance" that invites an accidental future leak) — keep the public metadata module and the private provider-resolution module structurally incapable of being conflated.

**8.3 Streaming chat engine**
A real, custom streaming client with: chunked token streaming to the client over a provider-agnostic wire protocol (no provider metadata in the stream shape, ever); a robust continuation loop that detects truncation (hit a token/length ceiling) and automatically continues generation with an anti-repetition instruction, bounded by a sane hard cap on total rounds, with a clear "response was cut short" signal surfaced to the user if that cap is hit rather than silently truncating; graceful tiered fallback if the provider rejects a request shape (e.g., steps down max-token ceilings progressively) before giving up; real retry-with-backoff for transient upstream 5xx/429 errors (this was missing in the prior build — a single transient error should not immediately fail a user's message); a real abort/stop control wired end-to-end (client abort → server abort of the upstream request) that preserves the partial answer as an editable, regenerable message rather than discarding it; streaming state that survives client-side navigation via shared/global state (not per-component state) and, ideally, a lightweight persistence layer so a hard refresh doesn't lose an in-flight response entirely.

**8.4 Thinking / reasoning replay + effort levels**
Exactly 5 effort levels (Low/Medium/High/xHigh/Max) matching the mockup's color-coded dots (`--e1`..`--e5`). Each level must produce **genuinely distinct behavior** at every layer you control (token ceiling, temperature, system-prompt directive) — if the underlying provider's own reasoning-effort parameter only exposes fewer distinct buckets than 5, that's fine, but don't let two "distinct" UI levels collapse to true no-op equivalence anywhere in the pipeline; if a collapse is unavoidable, document it honestly rather than presenting 5 buttons that quietly do the same thing at the model layer. Real reasoning-token streaming into a collapsible "thinking" panel with live shimmer while streaming, then a final "Thought for N seconds" summary, matching the mockup's `think-line`/`think-detail` behavior exactly. Test that reasoning deltas actually populate the panel end-to-end (not just that the static effort config table has 5 entries) — this exact gap (thorough config tests, zero pipeline test) was a real hole in the prior build.

**8.5 Composer**
Full parity with the mockup's composer anatomy and behavior (Section 5, rows 20–27), plus: a hard guard so the Enter-to-send path enforces the exact same usage-quota/plan-gate check as the visible Send button's disabled state (the prior build let Enter bypass a disabled Send button entirely — do not repeat this); resetting all per-conversation composer state (active skill, active agent, attachments) when navigating to a different conversation or starting a new one (the prior build leaked an active skill/agent across conversation switches); a reasonable cap on attachment count and total pasted-text size with clear user feedback before hitting a downstream payload limit; full keyboard accessibility on every custom control (skill picker, chip "remove" buttons) — real `role`/`aria-selected`/`tabIndex`/`onKeyDown` wiring, not purely mouse-driven custom widgets.

**8.6 Message persistence, branching, edit, regenerate**
A real message tree (parent-pointer based) supporting: switching between sibling branches, editing a past user message (creates a new sibling branch rather than mutating history), and regenerating an assistant response (creates a new sibling assistant branch) — full round trip from UI to persisted state, with an `active-leaf` pointer per conversation tracking which branch is currently displayed. Real optimistic local UI updates with server reconciliation. Real automated tests for the branch-selection/leaf-resolution logic against a realistic multi-branch fixture (the prior build's test suite here was genuinely good — match that bar). Persist message feedback (thumbs up/down) to the backend if you build it — don't let it live in component state only, evaporating on reload.

**8.7 Markdown & code rendering**
GFM tables/task-lists/strikethrough, math via KaTeX, syntax-highlighted code blocks with language auto-detection, copy-to-clipboard and download-as-file affordances on every code block, a debounced highlighting pass so streaming text doesn't re-highlight on every character. **Mandatory sanitization per Section 6.3** — do not ship raw-HTML passthrough without a sanitizer stage. If you support inline artifact/preview rendering triggered by fenced code blocks, gate that detection logic clearly and route it through the sandboxed rendering path in 6.4, never through `dangerouslySetInnerHTML` of unsanitized content directly in the main chat DOM.

**8.8 Artifacts + publish**
Inline "artifact" cards for previewable HTML/SVG/code with Preview/Code toggle, copy, download, and "open in new tab" — all sandboxed per Section 6.4. A "publish to a public URL" flow: authenticated creation, unauthenticated public read (this asymmetry is correct and intentional — the public page needs no login), but **enforce the ownership-before-overwrite and crypto-random-ID rules from Section 6.5 without exception.** Style the public rendering page fully theme-correct (the prior build had a literal hardcoded white background behind a themed header bar on this exact page — don't let any single hardcoded color slip through your token system).

**8.9 Image generation & vision (image understanding)**
Real image generation (a real backing image model, hidden behind a public model-tier label, never a raw model/vendor name) with plan-tiered model routing, dual-endpoint failover, and a graceful downgrade path (with honest partial-credit usage accounting) if a premium tier is unavailable — never silently regenerate from scratch with a downgraded model for an *edit* request that specifically needed the original input image; fail clearly instead. Real image understanding/vision analysis of user-attached images. **Every single error path out of both subsystems must be rewritten into a generic, vendor-free message before reaching the client** — this is where the prior build's provider-secrecy invariant actually broke in practice; write the test that would have caught it (assert no raw vendor name appears in the returned message text for every distinct error branch, not just the one "happy path" fallback string).

**8.10 Voice — text-to-speech and speech-to-text**
Real mic capture with the full recording/transcribing state machine from the mockup (Section 5, row 27), a sane max recording duration, a real transcription call, and transcript insertion at the caret. Real "read this message aloud" playback with a single-active-player model (starting a new playback stops any other) and full cleanup of object URLs/in-flight requests on unmount or replacement. Handle mismatched audio container/codec defensively — don't hardcode a file extension/MIME type that may not match what the browser's recorder actually produced; detect and pass through the real captured type. Distinguish, in user-facing error copy, between "permission denied," "unsupported browser," "network failure," and "playback/decoding failure" rather than one generic catch-all message for everything.

**8.11 Web search**
Real search-provider integration with a genuine primary→fallback chain (not a single provider with a dead fallback stub), a shared provider-agnostic result shape, generic vendor-free UI copy and error strings, and a live "Searching the web for…" → "Found N results" status chip with source pills (favicons included), matching Section 5 row 43. Add basic caching/de-duplication of identical queries within a turn, and real rate-limit/backoff handling for provider throttling — both were explicit gaps in the prior build.

**8.12 PDF parsing & attachments**
Client-side text extraction for genuine text-layer PDFs, with a real heuristic (not too blunt) for detecting scanned/image-only PDFs and routing those to the vision pipeline for OCR/analysis instead, bounded (max pages rasterized, max rendered dimensions) to prevent memory abuse from a pathological file. Enforce real size caps for both images and PDFs before doing any expensive parsing work. Cap extracted text length before it's forwarded into a model payload. Don't persist extracted document text permanently if you don't need to (re-parse or re-send per turn, matching the prior build's sound design choice there) — but do persist enough attachment metadata that a user can see what was attached.

**8.13 Skills system**
Full CRUD (create/edit/duplicate/export/import/enable/favorite/delete) for user-authored "skills" (reusable instruction packages injected into the system prompt when active). A model-driven creation path: the assistant can propose a new skill as a structured block in its own response, rendered as a one-click "Create/Update skill" card — but match on a **stable ID, not a fuzzy case-insensitive name match**, so two differently-configured skills that happen to share a display name can never silently clobber each other. Real, working suggestion engine (given a user's message, suggest 0–3 relevant existing skills to activate) that fails closed (suggests nothing) on any error and validates every suggested skill against the real candidate list before showing it — never let an invented/mismatched identifier reach the UI. Server-side validation of skill content on every write (length caps, slug format/uniqueness enforced in the database layer or the API handler, not only in client code) — a direct API call must not be able to create malformed or unbounded-length skills. If you build any internal/hidden first-party "skill" (e.g. one that injects live pricing/billing knowledge only when relevant), keep the instruction to the model to stay silent about its existence as a soft UX nicety only — do not rely on it as an actual security boundary, and do not let it leak provider/vendor identifiers either.

**8.14 Agents system**
Full CRUD for user-authored "agents" (name, avatar, description, system prompt, default model/effort/thinking toggle, attached skills). If your schema includes fields like "allowed tools" or "default project," either build the UI to actually set them or don't ship the fields at all — don't persist configuration a user can never actually set through any UI, which is confusing dead schema. Real server-side injection of the active agent's system prompt into the assembled chat prompt, with a clear, visible failure mode (not silent) if agent-loading fails mid-conversation. Runtime-validate any imported/updated agent JSON against your real enum of valid model/effort IDs — don't let bad imported data silently persist an invalid value.

**8.15 Memory**
Session-boundary "memory distillation": after a conversation with enough substance, distill durable facts about the user (preferences, standing instructions, ongoing projects) into a persistent per-user memory profile, injected back into future system prompts when enabled. Real authorization scoping (a user's memory operations must only ever touch that user's own rows, verified server-side, not just filtered by a client-supplied conversation ID with no independent ownership check). If you market tiered memory capability (e.g. "full memory with per-fact edit/delete" as a paid-plan feature), actually build the per-fact structure and enforcement to back that claim — don't ship a single opaque free-text blob and call it "editable/deletable" while gating nothing server-side by plan tier.

**8.16 Usage tracking & plan gates**
Multiple plan tiers with real, distinct limits (message/token windows, feature-specific monthly counters for images/vision/search/documents/voice/code-execution, model/effort/feature access gates). Enforce the **reserve-then-commit** pattern from Section 6.7 for every metered resource, not check-then-act. A real, live usage indicator with sensible escalating visual states (hidden well under the limit, increasingly urgent as it's approached, clearly maxed-out at the limit). A real, live, per-feature usage breakdown in Settings. Automated tests for the actual check/reserve/commit control flow under concurrency — not just for the pure math/formatting helpers around it, which was the prior build's actual test-coverage gap.

**8.17 Billing (Stripe or equivalent)**
Real checkout, portal, and webhook integration with correct raw-body signature verification. A reconciliation path (post-checkout sync, and ideally a scheduled job, not only a client-triggered one-shot) so a missed/delayed webhook doesn't leave a user's entitlement permanently stale. Entitlement derived from a small, well-tested single source of truth mapping subscription status → plan. **No unauthenticated debug/introspection endpoint of any kind reaches a shipped build — delete it, or gate it behind a real admin check and a real non-production environment check, per Section 6.8.** Real automated tests specifically for the webhook handler's signature verification and event-type branching, and for the checkout/portal/sync routes' auth enforcement — this exact code path had zero test coverage in the prior build despite being the literal money-and-auth surface of the product.

**8.18 Settings**
Appearance (light/dark/system), Usage breakdown, Plan & Billing, model/effort/thinking/tools defaults, Code-mode build-autonomy preference, personalization (custom "about me"/"how to respond" instructions), memory toggle + editable memory profile, and a real "download all my data" export plus a real destructive "clear all chats" action gated behind a confirmation dialog that accurately reports partial failures (don't show a blanket success toast if some deletions actually failed silently). Every toggle/select persists immediately with a visible saved/error state — no toggle that can visually flip on/off while silently failing to persist server-side.

### Shared platform / design system

**8.19 Design system implementation**
A real, namespaced token architecture per Sections 3 and 7 — light and dark themes fully parallel (every token defined in both, no orphaned/undefined custom properties reachable in either theme), no duplicate class-name collisions, an accessibility pass on every custom interactive primitive (menus, dialogs, toasts, popovers): real focus traps, return-focus-to-trigger on close, `aria-live` regions for toasts, `role`/`aria-modal`/`aria-expanded` used correctly and consistently, body-scroll lock behind modals.

**8.20 Theme system**
Cookie-driven, SSR-resolved, no-flash for explicit light/dark preference, **and** a genuine CSS-only fallback (a `prefers-color-scheme` media query scoped to "no `data-theme` attribute is present yet") so a `system`-preference user on a dark OS never sees a false light flash even before any client script runs, and so a no-JS/CSP-blocked visitor still gets a correct theme. Automated tests for the theme-resolution logic (not purely manual/visual QA, which was the prior build's only coverage here).

**8.21 App shell — sidebar, mode switch, topbar**
Exact behavior parity with the mockup (Section 5, rows 1–6) plus ForgeOS's mobile off-canvas drawer + scrim pattern, keyboard shortcut for sidebar toggle that adapts to viewport width, and a single shared "current mode/active thread/active project" derivation used by every chrome component (not three independently-reimplemented `pathname`-parsing functions that can drift from each other, which was a real minor bug in the prior build). Persist sidebar-collapsed state in a way that avoids a first-paint flash (a cookie, resolved server-side, exactly like the theme system — the prior build only used `localStorage` for this and got an avoidable flash as a result).

**8.22 Command palette + keyboard shortcuts**
Every command a real, working handler — no decorative/no-op entries. **Real fuzzy matching with relevance ranking** (a proper subsequence/typo-tolerant scoring algorithm — e.g. a small fuzzy-match scorer weighting prefix matches, contiguous runs, and word-boundary hits — not a naive case-insensitive substring test, which was a concrete, named gap in the prior build). Full ARIA combobox/listbox semantics (`role="combobox"`, `aria-expanded`, `aria-controls`, `role="listbox"`/`option"`, `aria-activedescendant`) so keyboard/screen-reader users get the same experience as mouse users, plus a real focus trap. Keep the on-screen keyboard-shortcut reference sheet, but derive it from (or at minimum keep it under a test that cross-checks it against) the actual registered keybindings, so the two can never silently drift apart the way they could in the prior build's hand-maintained, unlinked list.

**8.23 Data layer / backend infrastructure**
Per Section 6.12: pick one primary backend (a real Postgres-backed service with row-level security is a strong, defensible default) and one primary auth provider, and keep them consistent with your own documentation for the life of the project. Every server data-access route must funnel through one shared, well-tested "require an authenticated user, derive their ID from a server-verified token, never from client input" helper, called as the literal first statement of every single data route with no exceptions — audit this yourself periodically by grepping for the helper's usage across every route file. If you use RLS, actually author real per-table policies (not "RLS enabled, zero policies, security enforced entirely by a service-role key and a helper function" — that pattern technically works today but gives you no defense-in-depth if a future code path ever bypasses the helper). Keep your ORM/mapper layer's type and column naming honest to the actual schema — don't let leftover terminology from an abandoned earlier architecture (e.g. document-database naming conventions) linger in types/comments describing a relational schema underneath.

**8.24 Instruction inspector / transparency tool (optional, build carefully if you build it)**
If you build a "show me my own active system prompt" transparency feature, implement the Section 6.9 constraints exactly: strip anything not meant for end-user eyes, scope it strictly to the requesting user's own real context, and make its presence in the command palette/global chrome a deliberate, reviewed decision rather than an oversight.

### Meridian Code

**8.25 Project gallery**
A real, live grid of the user's own projects (no seeded/demo projects, ever), plan-gated with a real, non-generic upgrade prompt (state the actual required tier and price, with a direct path to checkout — not just a vague "upgrade" link one hop away from any pricing information, which was a concrete weakness in the prior build). Several genuinely functional starter templates (not empty-file stubs presented as "a visible starting point" — if you claim a starter opens to something visible, make sure it actually does). Transactional project creation (project row + initial files created atomically, or with a real cleanup/retry path on partial failure) rather than two independent inserts that can leave an orphaned, broken, file-less project if the second one fails.

**8.26 IDE — file tree, editor, live preview**
Multi-tab Monaco (or equivalent) editing with per-language syntax highlighting, debounced autosave, manual save, dirty-state indication. A real virtual file system with create/rename/delete/duplicate/drag-move and OS drag-drop import. **Enforce path-safety validation at every server-side write path, not only from one UI call site** (Section 6.11) — this was a concrete, real gap in the prior build: a client-side-only or single-call-site validator that other write paths (direct API calls, other UI actions like rename/move) could bypass entirely. A real binary/blob storage path for images/PDFs/other binaries actually wired end-to-end from the file-drop UI through to storage and back through a binary viewer — don't build a binary-storage abstraction that no actual import path in the product ever calls, which was a real dead-code gap in the prior build (dropped binary files were silently corrupted by being read as UTF-8 text instead). Live preview for static web and at least one real framework (React and/or Vue) via in-browser bundling, rendered in a sandboxed iframe per Section 6.4, with the storage shim from that same section. **"Open in new tab" must not defeat the sandbox** — see Section 6.4 again; this was a literal, concrete, exploitable bug in the prior build (a plain `window.open` + `document.write` popup that inherited the opener's origin, completely bypassing the otherwise-correct iframe sandboxing used everywhere else).

**8.27 AI build pipeline**
Plan → stream → apply, with a real, targeted search/replace diff-editing mode for existing files (not whole-file-rewrite-only) with an exact-match-then-whitespace-tolerant fallback strategy, plus explicit truncated-write and "destructive collapse" (a large file suddenly shrunk to almost nothing) detection that rejects the write rather than silently applying it. Post-write verification that re-reads storage and only reports a change as "applied" if the persisted content actually matches what was sent — never trust your own write call's return value alone. Checkpoint-before-write on every AI-driven build so the user always has a real, one-click restore point. A bounded self-correction loop (real caps on cycles, token budget, wall-clock time, and stagnation detection) with an honest, accurate final summary that distinguishes "generation was cut off," "the model claimed a change but nothing was actually written," and "genuinely applied" — never report success when the underlying operation silently failed or was truncated. **If you build a secondary strict-review/fixer pass, make sure it's actually wired to run** (Section 6.14) — do not let it become dead code behind a permanently-disabled flag while presenting the product's marketing/documentation as if it runs.

**8.28 Code execution / sandbox runner**
Per Section 6.10 in full: real isolated remote execution, per-user/per-minute rate limiting in addition to a monthly cap, atomic quota check-and-increment, output size caps, a clean "not configured" state with no fake output when the execution backend isn't set up, and specific, friendly error normalization (never leak raw sandbox/vendor internals to the user).

**8.29 Build verification suite**
Real fabrication detection (catching a model that claims to have written a large dataset/asset but visibly hasn't — not narrowly scoped to one vocabulary domain; make the heuristic general enough to catch "claimed N items, wrote far fewer, and isn't loading them at runtime" for any kind of large generated dataset, not just one example category). Real rename-consistency checking (stale references to an old name/term left behind after a rename). A genuine runtime verification pass that actually renders/executes the built project in a sandboxed context and inspects real DOM state/console errors/scripted smoke assertions — not merely static analysis dressed up with a "runtime" name. A strict secondary LLM-verdict pass that can override a model's own self-reported "looks fine" if concr0ete issues are found — and, again, **it must actually run in the shipped build**, not be gated behind a disabled flag.

**8.30 Checkpoints**
Full-project snapshotting (or a smarter diff-based scheme if you want to reduce storage — either is fine as long as restore is genuinely complete and correct), auto-checkpoint before every AI build plus a manual "save now," server-side pruning of old checkpoints bounded to a sane per-project cap enforced independent of client trust, and a restore flow that both writes back every snapshotted file *and* removes any file that didn't exist at snapshot time (a true rollback, not a partial overwrite that leaves newer files behind). Make restore as close to atomic as your storage layer allows, and surface real errors on partial restore failure rather than swallowing them silently.

**8.31 Export**
A real "export this project as a zip" flow and a real "download all my account data" GDPR-style export (conversations, files, projects, skills, agents, memory), both driven by real, current backend data with proper per-user authorization on every query. Add basic size/rate limiting on the account-wide export endpoint so it can't be hammered or used to pull an unbounded amount of data with no throttling. Clearly flag in the export manifest itself any content that couldn't be fully inlined (e.g. large binary files represented as metadata only) rather than silently shipping an incomplete-but-undocumented archive.

**8.32 Plan gating for Code mode**
A real, concrete upgrade prompt that states the actual plan tier needed and links directly toward completing an upgrade (not just toward a generic settings page one more hop away from any pricing), matching the specific gate that was actually triggered (don't show a generic "upgrade to Pro" message if the user's usage pattern actually requires a higher tier).

**8.33 Build utilities (diff/retrieval helpers)**
A real, dependency-free line-based diff engine with sane cost guards (a coarse fallback for pathologically large file pairs, capped hunk/prompt-byte output), and CRLF-safe line splitting (normalize line endings before diffing so a pure line-ending mismatch between two versions of a file doesn't register as every single line changed — a concrete gap in the prior build). A real retrieval/ranking system for feeding relevant project context to the build pipeline without shipping the whole codebase every time — keyword + reference-graph based ranking is a legitimate, lower-cost approach; whatever you choose, never silently drop a file from consideration entirely — inline it in full if it's highly ranked, or reduce it to a compact signature with an explicit "ask to see this file in full" instruction if it's not, so the model always knows what it's missing rather than being unaware a file exists at all.

---

## 9. Suggested architecture (adjust as needed, but resolve every open question consistently and document your decision)

- **Framework:** A modern React meta-framework with server components and streaming support (e.g. Next.js App Router) and TypeScript in strict mode throughout.
- **Styling:** A CSS-first utility framework (e.g. Tailwind v4) layered on top of the token system in Section 3, or an equivalent CSS-variable-driven design-token architecture — either is fine as long as the token system in Section 3 is the actual source of truth, not scattered hardcoded values.
- **State:** A small global store for cross-navigation state (streaming responses, composer settings, UI chrome state) plus server-state caching for data fetched from your backend.
- **Backend/persistence:** One consistent choice per Section 6.12 — a managed Postgres service with row-level security, realtime/streaming updates, storage buckets, and a service-role-key server-only access pattern behind a single shared auth-and-ownership-check helper is a strong, coherent default that avoids the exact split-brain (two different databases, one used, one describing dead security rules for the other) found in the prior implementation.
- **Auth:** One consistent provider, server-verified on every request via a signed token, never a client-supplied identity.
- **Billing:** Stripe (or equivalent) with signature-verified webhooks and a reconciliation path.
- **AI provider access:** A single server-only module resolving user-facing model names to real backend model identifiers, imported only by your streaming client, per Section 6.1.
- **Code execution:** A real isolated remote sandbox execution service, never local `eval`.
- **Editor:** Monaco or an equivalent full-featured code editor component.
- **Testing:** A unit-test runner for pure logic and critical control flow (webhooks, quota reserve/commit, path-safety, ownership checks), plus at least a lightweight end-to-end smoke pass over the golden paths (sign in → send a message → get a streamed response → branch/edit/regenerate; create a project → AI build → checkpoint → restore; upgrade a plan → verify entitlement takes effect).

---

## 10. Build order (phase gates — do not start a phase until the previous one is fully working and visually correct in both themes)

1. **Foundation:** design tokens (Section 3), theme system (8.20), auth gate (8.1), app shell (8.21) — matching the mockup's chrome pixel-for-pixel in both static appearance and every listed animation.
2. **Core chat:** provider-secret model layer (8.2), streaming engine (8.3), effort/thinking (8.4), composer (8.5), message persistence/branching (8.6), markdown/code rendering (8.7) with sanitization from day one, not bolted on later.
3. **Chat extensions:** artifacts/publish (8.8) with sandboxing correct from the first commit, image/vision (8.9), voice (8.10), web search (8.11), PDF/attachments (8.12).
4. **Personalization layer:** skills (8.13), agents (8.14), memory (8.15).
5. **Monetization & platform:** usage/plan gates (8.16) with reserve-then-commit from the start, billing (8.17), settings (8.18).
6. **Shared platform hardening:** command palette real fuzzy search + full ARIA (8.22), data-layer consistency review (8.23), accessibility pass across every custom primitive (8.19).
7. **Meridian Code:** gallery (8.25), IDE + sandboxed preview (8.26) with "open in new tab" solved correctly from the first implementation, build pipeline (8.27), sandboxed execution (8.28), verification suite with the strict pass actually wired on (8.29), checkpoints (8.30), export (8.31), Code-mode plan gating (8.32), build utilities (8.33).
8. **Final security & QA pass:** walk every item in Section 6 one more time as an explicit checklist against the finished product before calling it done; add the automated tests called out throughout Section 8 for any that were deferred during feature-building.

---

## 11. Definition of done

A phase (and ultimately the whole product) is not done until:
- It works against a real backend with no seeded/fake data anywhere in it.
- It is visually correct and fully animated per Section 5 in both light and dark themes.
- Every applicable item in Section 6's invariant list has been checked against the actual shipped code, not just designed for.
- Every "fix" called out inline in Section 8 (each one traceable to a specific, evidenced bug in the prior implementation) has a corresponding piece of code or test that would have caught the original bug.
- The keyboard-only and screen-reader experience of every custom interactive primitive has been manually verified at least once.
- `npm run typecheck` / equivalent, your test suite, and a production build all pass clean.

Do not declare the product "complete" from documentation alone — verify behavior by actually running it, the same way you would verify any other nontrivial change.
