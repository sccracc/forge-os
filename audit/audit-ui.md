# Forge OS — Molten Design System, App Shell & Settings UI: Feature Audit

Scope audited: `app/globals.css` (full file, 5436 lines), `app/layout.tsx`, `lib/theme.ts`, `components/theme/theme-applier.tsx`, `components/shell/*`, `components/command-palette.tsx`, `components/shortcuts-sheet.tsx`, `components/icons.tsx`, `components/providers.tsx`, `components/instruction-inspector.tsx`, `components/ui/*`, `components/settings/*`, `app/(app)/settings/page.tsx`, `app/(app)/layout.tsx`, `lib/fonts.ts`, `lib/confetti.ts`, `lib/platform.ts`, `lib/shiki.ts`, `app/api/inspect/route.ts`, `lib/ai/prompts.ts`, `lib/ai/models.ts`, `lib/ai/models.public.ts`, `lib/store/ui-store.ts`, and `tests/prompt-state.test.ts`. All findings below were verified by reading the source; none are speculative.

---

## Molten Token System & Theming

**What's included:**
- Single-import Tailwind v4 CSS-first entry with a `@theme inline` bridge mapping `--color-bg/surface/border/text/amber` and font vars to Tailwind's token space — `app/globals.css:1-17`.
- Light theme token block (default, unguarded `:root` + `:root[data-theme="light"]`) — `app/globals.css:20-60`, including `color-scheme: light`.
- Dark theme token block (`:root[data-theme="dark"]`) — `app/globals.css:63-100`, including `color-scheme: dark`.
- Shared tokens not overridden per-theme: `--radius`, `--radius-sm` (defined once on `:root`, lines 57-58) so corner radii stay constant across themes.
- Base element rules: global `border-color`, `body` background/color/font with a 0.4s cross-fade transition, `::selection` styling, heading letter-spacing, thin custom scrollbars (`app/globals.css:102-148`).
- "Molten atmosphere" ambient background: a pulsing radial amber glow (`::before`) plus an SVG `feTurbulence` grain overlay (`::after`), both `position: fixed`, `z-index: 0`, driven by `--glow-opacity`/`--grain` tokens — `app/globals.css:150-174`, keyframes `emberPulse` at 177-187.
- Global `prefers-reduced-motion` kill-switch that zeroes animation/transition durations and disables the atmosphere pulse — `app/globals.css:242-255`.
- A large shared component/utility layer built entirely on these tokens: buttons (`.btn-amber`, `.btn-ghost`, `.btn-danger`), `.icon-btn`, `.status-chip`, `.segmented`, `.switch`, focus utility `.focus-ring`, and dozens of feature-specific blocks (composer, code blocks, artifacts, skills, build dock, IDE, plans/billing, empty states) all the way to line 5436.
- A second "Motion Polish" layer (two waves) adding press-feedback, spring easing variables (`--ease-spring`, `--ease-smooth`), and choreographed micro-interactions layered on top of the base primitives — `app/globals.css:5251-5436`.

**Strengths:**
1. Clean single-source-of-truth token model — every color a component uses resolves through a CSS variable, not a literal, so re-theming is a token edit (e.g., `--amber`, `--bg-elev2`) rather than a grep-and-replace.
2. Light is genuinely the default and fully specced (`:root` un-suffixed = light) per the CLAUDE.md requirement, not an afterthought bolted onto a dark-first system.
3. `color-scheme` is set per theme (`app/globals.css:59,99`), so native form controls (scrollbars, date pickers) also render in the matching mode.
4. The reduced-motion media query is comprehensive — it targets `*, *::before, *::after` plus explicitly kills the atmosphere's infinite pulse animation, not just a subset of animations.
5. `--code-bg`/`--code-text`/`--tk-*` token family cleanly isolates code-surface theming from the rest of the UI so Shiki output only needs the dark code theme in both app themes (intentional, documented design — see `lib/shiki.ts:5-9`).
6. Font tokens (`--font-sans`, `--font-mono`) are bridged through `@theme inline` so both Tailwind utilities and hand-written CSS reference the same source.
7. The `--amber-glow`/`--amber-tint` pair gives a consistent "amber wash" language (focus rings, active chips, hover backgrounds) reused across dozens of components instead of one-off rgba literals.
8. Motion primitives (`--ease-spring`, `--ease-smooth`) are centralized as CSS custom properties, so the whole "wave 2" choreography layer can be retuned globally in two places.
9. Scrollbar styling is theme-aware (`--border-bright` thumb) and works on both Firefox (`scrollbar-color`) and WebKit (`::-webkit-scrollbar*`).
10. The grain/glow atmosphere technique is inexpensive (single fixed pseudo-elements, no per-frame JS), keeping ambient motion off the render-blocking path.

**Weaknesses:**
1. **Undefined CSS variable — real bug.** `.dock-build-bar` references `var(--surface-2)` (`app/globals.css:349`), but `--surface-2` is never defined anywhere in either token block (only `--surface` exists). With no fallback supplied, the build progress bar's track renders with the browser's initial `background-color` (transparent) in both themes instead of the intended tint.
2. **Duplicate, colliding class name — real bug.** `.artifact-icon` is defined twice with materially different, conflicting styles: once at `app/globals.css:1930-1952` (30×30px, transparent background, `--text-faint` color — a plain hover icon-button meant for the artifact card's expand/collapse chevron) and again at `app/globals.css:2082-2096` (40×40px, `--amber-tint` background, `--amber` border/color — the "Artifact Card" icon tile). Because both rules have identical specificity, the later one in source order wins for **every** element using the class, including the one actual consumer, `components/chat/artifact-card.tsx:82` (the "Show/Hide code" toggle button) — so that button renders as a large amber-tinted tile instead of the intended plain 30px hover icon, and the first rule block is fully dead/unreachable CSS.
3. **Duplicate class name, same pattern.** `.artifact-meta` is likewise defined twice with different layouts (`app/globals.css:1910-1913` vs `2097-2100`), same cascade-order hazard.
4. `--text-faint` fails WCAG AA contrast for normal text in both themes. Computed from the actual token values: light `#9a8e7b` on light `--bg`/`--surface` (`#faf6f0`/`#fffdf9`) ≈ 3.0:1; dark `#6b6253` on dark `--bg` (`#0c0a09`) ≈ 3.2:1 — both below the 4.5:1 AA threshold for body text, yet `--text-faint` is used at 11–13px for nav labels, sidebar timestamps, artifact/skill subtext, and hint copy throughout the file.
5. `.focus-ring` (`app/globals.css:428-432`) — the one utility class that provides a strong, consistent focus-visible treatment (3px amber box-shadow + border color) — is defined but never applied to any element in the audited components (`grep` across `components/` and `app/` finds zero usages). It is effectively dead code, and its absence means focus styling is reinvented ad hoc (and inconsistently — see Command Palette/Account Menu below) everywhere else.
6. Reduced-motion coverage is duplicated but incomplete: a second, narrower reduced-motion block at `app/globals.css:424-426` only kills `.ft-row, .code-block, .ft-children`, which is redundant with the earlier blanket rule at lines 242-255 and easy to mistake for the authoritative one when editing.
7. The atmosphere overlay (`.molten-atmosphere::before/::after`) is `position: fixed; inset: 0` and layered under content only via `z-index: 0` on itself and `z-index: 1` on `.app` (`app/globals.css:1013`) — this ordering is implicit and fragile; any future full-bleed element added without an explicit `z-index` could end up behind the atmosphere glow instead of above it.
8. No `prefers-contrast: more` / high-contrast accommodation anywhere in the token system — only motion preferences are respected, not contrast preferences, despite the system already having borderline-contrast tokens (see #4).
9. Code-comment claims ("shiki overrides — force molten background", `app/globals.css:1727`) rely on `!important` (`app/globals.css:1729,1864,2025`) to fight Shiki's inline styles rather than configuring Shiki to omit its own background, which is a maintenance smell — any future Shiki theme change re-adds the fight.
10. The two motion-polish "waves" (`5251-5436`) redeclare `transition`/`animation` for selectors already styled earlier in the file (e.g. `.msg-actions`, `.send-btn svg`, `.chat-item svg`) rather than amending the original rule — functionally fine due to cascade order, but it means a reader must cross-reference two locations to know a selector's final animation behavior.

**Fixes:**
1. Define `--surface-2` in both theme blocks (e.g. alias to `--bg-elev2` or a slightly lighter/darker step) or change `.dock-build-bar` to use an existing token.
2. Rename one of the two `.artifact-icon` rule sets (e.g. `.artifact-card-icon` for the amber tile) so the chevron toggle in `artifact-card.tsx` gets its intended plain-button styling back; same for `.artifact-meta`.
3. Either raise `--text-faint` luminance contrast (e.g. light `#8a7c66`→ darker, dark `#7d7364` → lighter) or restrict its use to large/decorative text and switch small informational text to `--text-dim`, which has adequate contrast.
4. Apply `.focus-ring` (or fold its box-shadow treatment into `:focus-visible` globally for `button`, `[role="button"]`, `a`) so keyboard focus is visible and consistent everywhere, then delete the dead rule if superseded.
5. Consolidate the two reduced-motion blocks into one canonical rule near the top of the file.
6. Give the atmosphere pseudo-elements an explicit low z-index constant and document the stacking contract in a comment so future full-bleed UI doesn't silently land behind it.
7. Add a `prefers-contrast: more` block that swaps `--text-faint`/`--border` to higher-contrast values.
8. Configure Shiki's `codeToHtml` to not emit an inline background (or override via the `theme` option's `bg` transform) instead of fighting it with `!important`.

---

## Pre-paint Theme Script & SSR Theme Resolution

**What's included:**
- `THEME_COOKIE`, `ThemePref`/`ResolvedTheme` types, `DEFAULT_THEME = "light"`, `resolvePref()` guard, `resolveTheme()` (resolves `"system"` via `matchMedia` client-side), and `THEME_INIT_SCRIPT` — `lib/theme.ts:1-37`.
- Server layout reads the theme cookie via `next/headers`, resolves it, sets `data-theme` on `<html>` for SSR (defaulting `"system"` to `"light"` server-side since `matchMedia` isn't available), and injects `THEME_INIT_SCRIPT` into `<head>` via `dangerouslySetInnerHTML` so the real theme (including "system") is applied before first paint — `app/layout.tsx:27-50`.
- `suppressHydrationWarning` is set on both `<html>` and `<body>` specifically to tolerate the pre-paint script mutating `data-theme`/attributes before React hydrates — `app/layout.tsx:40,45`.
- Client-side `ThemeApplier` (`components/theme/theme-applier.tsx`) mirrors the Zustand `themePref` into both the `data-theme` attribute and the cookie on every change, listens for OS theme changes when `"system"` is active, and skips the celebratory "theme sweep" animation on first mount (`firstApply` ref) so it only plays on an actual user-triggered change.
- `ThemeHydrator` (`components/providers.tsx:18-26`) reconciles the store with the server-resolved cookie value on mount.
- `.theme-sweep` radial-reveal animation (`app/globals.css:407-408`, keyframes 408) triggered from JS with a `--sx/--sy` origin point, auto-removed via `setTimeout` after 650ms, and skipped entirely under `prefers-reduced-motion`.

**Strengths:**
1. Correct no-flash architecture: cookie read at SSR time, then re-resolved before paint via an inline `<head>` script — this is the standard, robust pattern for avoiding FOUC even for the ambiguous `"system"` preference that the server cannot itself resolve.
2. The inline script is minimal, wrapped in `try/catch`, and fails safe to `"light"` on any error (`lib/theme.ts:31-36`), so a malformed cookie can't leave the page themeless.
3. `THEME_COOKIE`/`DEFAULT_THEME` are compile-time constants interpolated into the script string, not user input, so there is no injection surface despite the use of `dangerouslySetInnerHTML`.
4. `suppressHydrationWarning` is scoped only to the two elements the pre-paint script actually touches, rather than being applied broadly (which would mask unrelated hydration bugs).
5. The theme-sweep visual only fires on genuine user-initiated changes (guarded by `firstApply`), avoiding an animation flash on every page load.
6. `matchMedia` listener cleanup is correct — the `change` listener is only attached when `themePref === "system"` and is removed in the effect's cleanup function (`theme-applier.tsx:37-40`).
7. Cookie is written with `path=/; max-age=31536000; samesite=lax` (`theme-applier.tsx:35`), reasonable defaults for a non-sensitive UI preference.
8. Theme state is deliberately excluded from the Zustand `persist` partialize (`lib/store/ui-store.ts:79`, only `sidebarCollapsed` is persisted) so the cookie remains the single source of truth and can't drift out of sync with a stale localStorage copy.

**Weaknesses:**
1. `ThemeHydrator` and `ThemeApplier` both run on mount and both end up writing `document.cookie`/`data-theme` in quick succession (`providers.tsx:21-24` → triggers `theme-applier.tsx`'s effect) — functionally harmless but redundant; a reader has to trace two files to understand who "owns" the theme write.
2. The pre-paint script re-implements the exact same `"system"` → `matchMedia` resolution logic that already exists as `resolveTheme()` in `lib/theme.ts:15-25`, as an inline string duplicate (`lib/theme.ts:34`) rather than referencing one implementation — any future change to the resolution rule (e.g., adding a new pref) must be updated in two places that can drift apart silently (no test currently guards their equivalence).
3. No automated test asserts the inline script string stays behaviorally identical to `resolveTheme()`/`resolvePref()` — a refactor of one without the other would ship a working TypeScript build but a broken pre-paint theme.
4. `THEME_INIT_SCRIPT` is injected with `dangerouslySetInnerHTML` without a CSP nonce; if the app ever adds a strict `script-src` CSP (common hardening step), this inline script would need a nonce/hash wired through `next/headers`, which isn't prepared for here.

**Fixes:**
1. Export a small `resolveThemeInline()` string builder from `lib/theme.ts` that both the constant and any test import, or better, generate `THEME_INIT_SCRIPT` by serializing calls into `resolvePref`/`resolveTheme` logic so there is truly one implementation.
2. Add a unit test that renders both resolution paths for `light`/`dark`/`system` (with mocked `matchMedia`) and asserts they agree.
3. If/when CSP is introduced, thread a nonce through `headers()` into the inline `<script>` tag.
4. Consider having only `ThemeApplier` write the cookie and have `ThemeHydrator` simply seed the Zustand store without an extra cookie write, to remove the double-write.

---

## App Shell Layout & Responsive Behavior

**What's included:**
- `(app)` route group layout wraps every authenticated page in `AuthGate` then `AppShell` — `app/(app)/layout.tsx:1-10`.
- `AppShell` (`components/shell/app-shell.tsx`): renders `<Sidebar/>`, a mobile scrim, `<main>`, and the always-mounted `<InstructionInspector/>`; derives `mode` ("chat"/"code") from the pathname; closes the mobile drawer on navigation; and owns two global keyboard shortcuts (`⌘/Ctrl+B` sidebar toggle, `Alt+N`/`⌘/Ctrl+N` new chat) — lines 1-57.
- `TopbarFrame` (`components/shell/topbar.tsx:15-45`) — shared topbar shell with a mobile hamburger (`Menu` icon, `mobile-only`) and a desktop sidebar toggle (`PanelLeft`, `desktop-only`), a title slot, and a spacer for right-aligned children.
- `ChatTopbar` (lines 47-198) — adds a chat-options overflow menu (rename / export-as-Markdown / delete) with inline rename-to-input, an outside-click-to-close handler, and calls into `exportConversationMarkdown`.
- `SimpleTopbar` (lines 200-202) — bare title-only variant used by Settings.
- CSS: `.app` flex shell (`app/globals.css:1008-1015`), `.sidebar` (1016-1027) with width/transform transitions, `.main`/`.topbar`/`.content-area` (1275-1315).
- Mobile breakpoint behavior at 860px: sidebar becomes a fixed off-canvas drawer (`transform: translateX(-100%)` → `.mobile-open`), a `.scrim` backdrop, `.mobile-only`/`.desktop-only` toggle classes, and full-width `.thread`/`.composer` (`app/globals.css:5195-5249`).

**Strengths:**
1. Mode derivation from the URL (`pathname.startsWith("/code")`) rather than independent client state means the shell can never disagree with the actual route about which mode is active.
2. The mobile drawer is properly closed on every navigation via a dedicated effect (`app-shell.tsx:22`), preventing the common bug of a stale open drawer after a route change.
3. Global shortcuts are registered once at the shell level (not duplicated per-page), with correct cleanup (`removeEventListener` in the effect return) — `app-shell.tsx:43-45`.
4. The `Alt+N` vs `Ctrl/Cmd+N` split is a deliberate, documented workaround for the browser's reserved "new window" shortcut (`app-shell.tsx:34-37` comment), showing real cross-browser/OS consideration.
5. `TopbarFrame` cleanly separates mobile vs. desktop sidebar-toggle affordances using CSS visibility classes rather than JS `useMediaQuery` branching, keeping the component simple and avoiding a hydration-dependent mobile/desktop guess.
6. `ChatTopbar`'s outside-click handling correctly checks `wrapRef.current.contains(e.target)` and cleans up its `mousedown` listener when the menu closes (`topbar.tsx:59-66`).
7. Rename-in-place uses `autoFocus` plus `onBlur`/`Enter`/`Escape` handling with a clear save/cancel distinction (`topbar.tsx:120-128`).
8. The mobile drawer's z-index (50) is intentionally higher than the scrim (40) so the open drawer sits above its own backdrop, and both are well below the command palette (300)/modals (250) so an in-app dialog always wins over shell chrome.
9. Export/rename/delete all correctly gate on `user`/`conversationId` being present and surface `toast.success`/`toast.error` feedback (`topbar.tsx:83-114`).
10. `InstructionInspector` is mounted once at the shell root (`app-shell.tsx:54`) rather than per-page, so its open/closed state (driven by the global store) works uniformly from the command palette on any screen.

**Weaknesses:**
1. **Global hotkeys ignore focus context.** The `keydown` handler in `app-shell.tsx:24-45` does not check whether the event target is a text input, `<textarea>`, or `contentEditable` element. `⌘/Ctrl+B` and `⌘/Ctrl+N` (kept "for PWA/Safari" per the code comment) will fire and call `e.preventDefault()`/navigate even while the user is actively typing in the chat composer, silently discarding an in-progress draft on `⌘/Ctrl+N`. Contrast this with `CommandPalette`'s own `"?"` handler (`command-palette.tsx:61-66`), which explicitly excludes `input`/`textarea`/`isContentEditable` targets — the same guard is missing here.
2. `ChatTopbar`'s options menu (`topbar.tsx:156-193`) has no `Escape`-to-close handler (only the outside-`mousedown` listener), unlike every other popover in the app (account menu, shortcuts sheet, instruction inspector all close on `Escape`).
3. The same menu's trigger button has no `aria-haspopup`/`aria-expanded` (`topbar.tsx:149-155`), unlike `AccountRow`'s trigger which correctly sets both (`account-row.tsx:236-238`) — an inconsistency between two structurally identical "popover menu" patterns in the same codebase.
4. No keyboard arrow-key navigation within the chat-options menu items (Rename/Export/Delete) — a keyboard user can only reach them via sequential Tab.
5. The desktop sidebar-toggle button and the mobile hamburger button are both always rendered (`topbar.tsx:26-39`) and simply hidden via CSS (`mobile-only`/`desktop-only` display:none) rather than not rendered — both remain in the DOM/tab order on whichever breakpoint hides them only via `display:none` (which does correctly remove them from the tab order, so this is low severity, but it does mean both `aria-label`ed buttons exist in the accessibility tree redundantly during a resize transition).
6. `AppShell` toggles `mobileSidebarOpen` for `⌘/Ctrl+B` at `window.innerWidth <= 860` (`app-shell.tsx:28`) — a one-time width check at keypress time, not a reactive media-query listener, so if the window is resized across the 860px breakpoint without a keypress in between, the very next `⌘/Ctrl+B` still behaves correctly (since it re-checks `innerWidth` live), but the check duplicates the CSS breakpoint (`860px`) as a hard-coded magic number in JS with no shared constant.
7. There is no focus trap or `inert` handling anywhere in the shell — when the mobile drawer is open (`.scrim` + `.sidebar.mobile-open`), a keyboard user can still Tab into the main content behind the scrim, since the scrim only blocks pointer events, not keyboard focus.

**Fixes:**
1. Extend the `app-shell.tsx` keydown guard with the same input/textarea/contentEditable exclusion used in `command-palette.tsx:64-65` (and consider dropping the redundant `⌘/Ctrl+N` binding entirely now that `Alt+N` is documented as the real cross-browser shortcut, to remove the draft-loss risk).
2. Add an `Escape` listener to `ChatTopbar`'s menu matching the pattern already used in `AccountRow`/`ShortcutsSheet`/`InstructionInspector`.
3. Add `aria-haspopup="menu" aria-expanded={menuOpen}` to the chat-options trigger button.
4. Add `ArrowUp`/`ArrowDown` roving focus to the chat-options menu (mirroring `account-row.tsx:90-102`'s `onMenuKeyDown`).
5. Extract the `860` breakpoint into one shared constant imported by both the CSS custom property (or a JS module) and `app-shell.tsx`, to avoid future drift.
6. When the mobile drawer is open, set `inert` (or `aria-hidden` + a focus trap) on the `<main>` content so Tab cannot escape behind the scrim.

---

## Sidebar & Navigation Shell

**What's included:**
- `Sidebar` component (`components/shell/sidebar.tsx`): logo/brand mark, `ModeSwitcher`, mode-conditional content (Forge Code: "New Project" + recent projects list; Forge Chat: "New Chat" + search box + grouped, bucketed conversation list), a static "Skills"/"Agents" nav section, and `AccountRow` pinned to the bottom.
- `TitleText` (lines 22-45) — a typewriter effect that only re-types a chat title when it actually changes (e.g., "New chat" → AI-generated title), gated by `prefers-reduced-motion`.
- Conversation grouping into `Today`/`Yesterday`/`Previous 7 Days`/`Older` buckets via `dateBucket()` (lines 89-100), with live client-side search filtering by title.
- Global `forge:focus-search` custom event listener so other parts of the app (e.g., the command palette's "Search chats" command) can programmatically focus the sidebar's search input (lines 62-66).
- Per-chat delete flow using the shared `confirm()` promise-based dialog and `toast.success` feedback, with active-chat redirect to `/` if the deleted chat was open (lines 73-87).
- `framer-motion`'s `AnimatePresence`/`motion.div` for list enter/exit animation of chat rows (lines 218-256), each row exposing a keyboard-operable `role="button" tabIndex={0}` with `Enter`/`Space` handling (lines 227-237).
- Loading skeleton (`.skeleton` shimmer, 4 placeholder rows) and empty states for both projects and chats.
- Project rows render a per-project gradient dot from `p.gradient` with a sane fallback (`#ff7a1a`/`#c2470a`) if unset.

**Strengths:**
1. Keyboard operability was clearly considered for the primary row action: `role="button" tabIndex={0}` plus explicit `Enter`/`Space` `onKeyDown` handling (lines 229-237) is exactly the correct pattern for a non-native clickable `motion.div`.
2. The typewriter effect intelligently no-ops when the text hasn't changed (`prev.current === text` guard, line 28) so it doesn't replay on every re-render, only on genuine title updates, and it fully respects reduced-motion.
3. Search is purely client-side and instant (no debounce needed given local data), filtering an already-loaded list rather than issuing new network requests per keystroke.
4. The `forge:focus-search` event bridge is a clean, decoupled way for the command palette to trigger sidebar focus without prop drilling or a shared ref across distant components.
5. Delete uses the shared, accessible `confirm()` dialog rather than a native `window.confirm`, keeping the interaction visually and behaviorally consistent with the rest of the app.
6. Empty states are real, specific copy ("No chats yet. Start a new conversation to see it here.") rather than a generic placeholder, matching the CLAUDE.md "no placeholder data" invariant.
7. `AnimatePresence initial={false}` (line 218) correctly suppresses an entrance animation for chats already present on first render, only animating genuine adds/removes.
8. Bucket order is explicit and stable (`BUCKET_ORDER` constant, line 20) rather than relying on object key iteration order.
9. The loading skeleton only shows while `loading && conversations.length === 0` (line 190), avoiding a jarring skeleton flash on subsequent refetches once data already exists.
10. `title={c.title}` / `title={p.name}` native tooltips are set on truncated rows as a low-cost fallback for full text on hover.

**Weaknesses:**
1. **Keyboard-unreachable delete action.** The per-row delete control is a `<span className="row-action" role="button" aria-label="Delete chat" ...>` (`sidebar.tsx:242-253`) with an `onClick` but **no `tabIndex` and no `onKeyDown`**. Since the class also lacks any button semantics beyond `role`, a keyboard-only user tabbing through the sidebar can reach the parent chat row (which itself is `tabIndex={0}`) but has **no way to reach or activate the delete button** — it's only operable by mouse/pointer. This is a genuine, verifiable keyboard-accessibility gap, not a nit.
2. **Nested interactive elements.** The delete `<span role="button">` is nested inside the chat row `<motion.div role="button" tabIndex={0}>` (lines 220-254) — two interactive roles nested inside one another is an ARIA anti-pattern (assistive tech cannot cleanly express "a button inside a button") regardless of the tabIndex issue above.
3. `onDeleteChat` (lines 73-87) swallows the delete failure silently: `await deleteConversation(user.uid, c.id).catch(() => {})` — if the delete actually fails server-side, the UI still shows `toast.success("Chat deleted")` unconditionally, telling the user something succeeded when it may not have.
4. The search input's wrapping element is a `<button className="sidebar-search" onClick={...}>` containing a nested `<input>` (lines 169-187) — a `<button>` element containing a focusable `<input>` is invalid/unreliable HTML (buttons are meant to contain phrasing content, and nesting an interactive control inside another interactive control has undefined/inconsistent activation behavior across browsers and screen readers).
5. No virtualization/windowing for the conversation list (`nav-section`, lines 189-261) — for a user with hundreds or thousands of chats, every row (including its `framer-motion` wrapper) mounts and animates simultaneously, which will noticeably degrade scroll/paint performance as chat count grows; there is no pagination or infinite-scroll cutoff visible in this component.
6. The recent-projects list is hard-capped with `projects.slice(0, 12)` (line 140) with no "see all" affordance — projects beyond the 12th are simply unreachable from the sidebar.
7. Inline styles are used extensively for structural layout (empty states, skeleton placeholders, lines 129-137, 191-199, 202-210) rather than the shared class system used everywhere else in the file, so a themed style change to (for example) empty-state copy padding requires touching JSX rather than CSS.
8. The delete confirmation copy interpolates the raw chat title into the dialog title (`` `Delete "${c.title}"?` ``, line 77) with no escaping/length limit — an extremely long or exotic-Unicode chat title could visually break the fixed-width `.confirm-modal` (400px, `app/globals.css:3596`).

**Fixes:**
1. Add `tabIndex={0}` and an `onKeyDown` (`Enter`/`Space` → same handler as `onClick`, with `stopPropagation`) to the delete `row-action` span, or better, replace it with a real `<button>` sized/styled via the same class.
2. Move the delete action outside the row's interactive wrapper (e.g., render the row as a `<div>` with the delete `<button>` as a proper sibling-level focusable control, and make only the label clickable/keyboard-operable for navigation) to avoid nested interactive roles.
3. Surface a `toast.error("Couldn't delete chat")` when `deleteConversation` rejects, instead of swallowing the error.
4. Change `.sidebar-search` from a `<button>` wrapping an `<input>` to a `<div>` (or a `<label>`) that simply forwards clicks to focus the input, as already done via the `onClick` handler.
5. Introduce list virtualization (e.g., `react-window`) once conversation counts are expected to exceed roughly 100–200 for a user, or add server-side pagination with a "load more" affordance.
6. Add a "See all projects" link/route when `projects.length > 12`.
7. Truncate/clip the interpolated chat title before it reaches the confirm dialog (the row already truncates visually via `text-overflow: ellipsis`; reuse the same truncation for the dialog title).

---

## Mode Switcher (Chat / Code)

**What's included:**
- `ModeSwitcher` (`components/shell/mode-switcher.tsx`) — a segmented `role="tablist"` control with an animated sliding thumb (`.seg-thumb`) between "Chat" and "Code" tabs.
- Plan-gating: attempting to switch into Forge Code when `!canUseForgeCode(plan)` opens the shared usage/upgrade gate modal instead of navigating, via `openGate()` from `useUsageStore` (lines 20-29).
- A `Lock` icon badge on the Code tab when locked, plus a `title` tooltip explaining the gate (lines 59-63).

**Strengths:**
1. Correct ARIA shape for a two-way toggle: `role="tablist"` on the container and `role="tab"`/`aria-selected` on each button (lines 36, 49-50, 54-58).
2. The animated thumb position is computed from the same boolean (`isCode`) that drives `aria-selected`, so the visual state and the accessible state can't fall out of sync.
3. Plan-gating happens *before* navigation/mode change, not after — clicking a locked "Code" tab never briefly flashes into Forge Code before being redirected, since `go()` returns early (lines 20-24) without calling `setMode`/`router.push`.
4. Mobile sidebar auto-closes on any mode switch (`setMobileSidebarOpen(false)`, lines 22,31), preventing a stale open drawer after navigating.
5. The `title` attribute communicates *why* Code is locked ("Forge Code is available on Pro and above") directly on the disabled-feeling tab, rather than only in a toast the user might miss.

**Weaknesses:**
1. No arrow-key navigation between the two tabs — the ARIA Authoring Practices "tabs" pattern expects `ArrowLeft`/`ArrowRight` to move selection with a roving `tabIndex`, but here both buttons are simply in normal Tab order with no keydown handling at all.
2. Neither tab has `aria-controls` pointing at the panel it governs (there's no associated `tabpanel` id at all), so the tablist/tab relationship is only half-implemented per the ARIA tabs pattern — screen readers will announce "tab" but cannot navigate to the associated content programmatically.
3. The locked "Code" tab is still a fully clickable, focusable `<button>` with `aria-selected={isCode}` but no `aria-disabled`, so assistive tech has no signal that clicking it won't actually switch modes until after the click opens an unrelated modal.
4. The gate flow itself is entirely mouse-event-shaped: clicking calls `openGate` synchronously, but keyboard activation via `Enter`/`Space` on the button will also work (native button semantics), yet there is no code path tested for this — it's implicit and relies entirely on default `<button>` behavior rather than being verified.

**Fixes:**
1. Add roving-tabindex arrow-key navigation (`ArrowLeft`/`ArrowRight` cycles between the two tabs, matching the shared `onMenuKeyDown` pattern already written for `AccountRow`).
2. Either add real `tabpanel` elements with `aria-controls`/`id` wiring, or drop the `tablist`/`tab` roles in favor of a simpler `radiogroup` semantic if there's no distinct panel markup to reference.
3. Add `aria-disabled="true"` (not native `disabled`, to keep it focusable/tabbable and explain the lock) to the Code tab when `codeLocked`.

---

## Account Menu (Bottom-Left Popover)

**What's included:**
- `AccountRow` (`components/shell/account-row.tsx`): avatar (photo or initial), name/plan label trigger button, and an animated popover (`framer-motion`) containing: usage summary + progress bar (links to `/settings#usage`), Settings, Skills, Agents, an inline theme toggle (Light/Dark/System), Keyboard shortcuts, Data controls (`/settings#data`), and Sign out.
- Outside-click and `Escape` close handling (lines 61-78), auto-focus of the first menu item shortly after opening (`setTimeout(..., 30)`, line 72), and `refreshUsage()` triggered every time the menu opens (lines 80-82).
- `onMenuKeyDown` (lines 90-102) implements `ArrowUp`/`ArrowDown` roving focus across all `[data-acct-item]` elements.
- Live usage bar colored via `progressColor(usageStatus.pct)` and text via `formatUsagePercent`/`tokenStatus` from `lib/usage/compute`.

**Strengths:**
1. This is the one popover in the audited surface with a real roving-tabindex-style keyboard navigation implementation (`onMenuKeyDown`, lines 90-102) — a genuinely more complete a11y treatment than its sibling menus (chat-options menu, command palette list).
2. `role="menu"`/`role="menuitem"` are applied correctly and consistently to every actionable row (lines 110, 122, 146, 158, 168, 195, 218).
3. Auto-focusing the first item on open (line 72) gives keyboard users an immediate, predictable focus target instead of leaving focus stranded on the trigger.
4. Usage is refreshed on every open (`void refreshUsage()`, line 81) rather than cached indefinitely, so the usage bar shown here can't go stale across a long session.
5. `aria-pressed` is correctly set on each theme button reflecting the active preference (line 182), not just a visual `active` class.
6. The avatar image (`referrerPolicy="no-referrer"`, line 243) avoids leaking the app's URL to whatever CDN serves the user's profile photo — a small but real privacy-conscious detail.
7. Both the sidebar "New chat"-style navigation calls and the deep-linked `/settings#usage` / `/settings#data` routes are consistent with the actual anchor ids present on the settings page (verified in `app/(app)/settings/page.tsx:218,373`).

**Weaknesses:**
1. No focus trap: `Tab`/`Shift+Tab` from the last/first menu item is not intercepted, so keyboard focus can leave the open popover into background content while it's still visually open (it will close on the next click elsewhere, but a keyboard user tabbing past the end has no such affordance and the popover stays open, floating over content, until a stray click or `Escape`).
2. No focus restoration: closing the menu (via item click, outside click, or `Escape`) never returns focus to the `sidebar-foot` trigger button — for a keyboard user, focus is simply lost to `document.body`/wherever the pointer happened to land.
3. `:focus-visible` styling for `.acct-usage`/`.acct-item` explicitly removes the native outline and substitutes only a background/border color change identical to the row's own `:hover` state (`app/globals.css:2872-2876, 2927-2931` — both rules literally combine `:hover, :focus-visible` into one selector). A keyboard user tabbing through the menu gets no visual signal distinguishing "focused" from "would be hovered," which is a materially weaker indicator than the unused `.focus-ring` utility already defined elsewhere in the same stylesheet.
4. The theme toggle buttons inside the menu (lines 176-189) are reachable only via plain Tab order, not via the `onMenuKeyDown` arrow-key roving logic (that logic only queries `[data-acct-item]`, and the theme buttons don't carry that attribute) — so arrow-key navigation silently skips over three focusable elements in the middle of the menu.
5. `setTimeout(() => firstItemRef.current?.focus(), 30)` (line 72) is a magic-number timing hack to wait out the `framer-motion` entrance animation rather than using the animation's `onAnimationStart`/mount callback, which is fragile if the transition duration/easing changes later.

**Fixes:**
1. Implement a real focus trap (e.g., cycle `Tab` from the last item back to the first, and `Shift+Tab` from the first back to the last) inside the popover while `open`.
2. Store the trigger button in a ref and call `.focus()` on it when the menu closes via any path (item activation, outside click, or `Escape`).
3. Give `:focus-visible` its own distinct treatment (e.g., reuse `.focus-ring`'s box-shadow) separate from `:hover`, at least for keyboard users.
4. Add `data-acct-item` to the theme toggle buttons (or handle them as an explicit sub-group) so arrow-key roving covers the full menu.
5. Replace the `setTimeout(30)` with a `framer-motion` `onAnimationComplete` callback (or focus immediately since focus-during-transition is generally fine) to remove the timing guess.

---

## Command Palette

**What's included:**
- `CommandPalette` (`components/command-palette.tsx`) — a `⌘/Ctrl+K`-toggled, portal-rendered command list (`createPortal(..., document.body)`, lines 273,341) covering Navigation (new chat/project, mode switch, chat search, skills/agents, "Inspect active instructions", settings), Appearance (theme light/dark/system), Help (shortcuts), and conditionally Account (sign out).
- Fuzzy-ish substring filtering across `label + group + keywords` (lines 252-258), `ArrowUp`/`ArrowDown`/`Enter`/`Escape` handling inside the input (lines 293-307), and mouse hover/click parity (`onMouseEnter` sets active, `onMouseDown` runs the command).
- Horizontal centering logic that measures `.main`'s bounding rect so the palette visually tracks the content area rather than the full viewport as the sidebar collapses/expands (lines 85-94).
- Global `"?"`-opens-shortcuts hotkey co-located in the same top-level `keydown` listener as the `⌘/Ctrl+K` toggle (lines 56-73).

**Strengths:**
1. `role="dialog" aria-modal="true" aria-label="Command palette"` is correctly set on the outer container (line 281).
2. The `"?"` global hotkey correctly excludes `input`/`textarea`/`contentEditable` targets (lines 63-66) — the one place in the audited surface that gets this guard right, and a useful contrast against the shell-level hotkeys that don't (see App Shell section).
3. Reopening always resets `query`/`active` to a clean state (lines 76-81) rather than preserving stale filter text from the previous session, avoiding user confusion.
4. The palette is only mounted client-side after `useEffect(() => setMounted(true), [])` (line 53) before being portaled, correctly avoiding SSR/portal mismatch.
5. Command definitions are declarative, data-driven (`Command[]` with `run()` closures), making it straightforward to audit exactly what each entry does and add new ones without touching render logic.
6. `onMouseDown` (not `onClick`) is used for item activation (line 326), which is the correct choice to avoid the classic "blur-then-click-fails" bug where an input's blur handler or a parent's outside-click-close fires before the click registers.
7. Command list is grouped and labeled (`cmdk-group-label`) consistent with the visual hierarchy of a command palette users would recognize from similar tools.
8. The dialog closes cleanly on backdrop click via a `currentTarget`/`target` equality check (lines 277-279) rather than closing on any click bubbling from inside the palette.
9. `useMemo` correctly recomputes the `commands` array only when its actual dependencies change (line 250), and the `active` index is defensively clamped whenever the filtered list shrinks (lines 260-262).
10. Palette re-centers on window resize while open, with correct listener cleanup (lines 91-93).

**Weaknesses:**
1. **No focus trap.** Like the account menu, `Tab` is never intercepted — a keyboard user can Tab out of the open, `aria-modal="true"` dialog into background page content while it's still visually covering the screen. `aria-modal="true"` is a lie to assistive tech unless focus is actually constrained to the dialog, which it is not here.
2. **No listbox/option semantics.** The result list has no `role="listbox"`/`role="option"`/`aria-activedescendant` wiring — the "active" (highlighted) item is communicated only via a CSS class (`cmdk-item.active`, purely visual). A screen reader user gets no announcement of which command is currently selected while arrowing through the list, despite the component visually implementing exactly that pattern.
3. No focus restoration to whatever triggered the palette (a `⌘K` press could have come from anywhere) when it closes.
4. The list items themselves (`<div className="cmdk-item">`, lines 322-335) are not natively focusable and carry no `tabIndex`; the only way to activate a non-topmost item without the mouse is via repeated `ArrowDown` + `Enter` inside the text input — there is no way to Tab into the list at all, meaning the entire result list is invisible to sequential keyboard navigation (only arrow-key navigation from the search box works).
5. `.cmdk-input` sets `outline: none` (`app/globals.css:3507`) with **zero compensating focus style** anywhere for `.cmdk-input` or `.cmdk-input-wrap` (verified: no `:focus`/`:focus-within` rule exists for either selector in the stylesheet) — a genuine WCAG 2.4.7 (Focus Visible) failure on the palette's primary control, mitigated in practice only by the fact that it autofocuses on open (so its focus state is inferred contextually, not shown visually).
6. The `"?"` global-shortcut guard (lines 61-66) checks that the *command palette* isn't open, but not whether the *shortcuts sheet itself*, the *instruction inspector*, or the *confirm dialog* are already open — pressing `"?"` while, say, the Instruction Inspector is open (its content area is a `<pre><code>`, not an input/textarea, so the guard doesn't exclude it) will additionally open the Keyboard Shortcuts sheet on top of it. Both use the same `.modal-overlay` z-index (250, `app/globals.css:3575`), so two full-screen overlays end up stacked with no coordinated close order — pressing `Escape` once fires *both* components' independent `Escape` listeners and closes both simultaneously, which is a real, reproducible stacking/UX defect rather than a cosmetic one.
7. Filtering is a plain case-insensitive substring match (`label + group + keywords`, lines 252-258) with no fuzzy/typo tolerance and no result ranking — a query like "new chta" (typo) returns nothing, and multi-word queries must appear in that exact order/adjacency within the concatenated string.

**Fixes:**
1. Implement a focus trap while `open` (wrap Tab/Shift+Tab at the dialog boundary), matching the promise implied by `aria-modal="true"`.
2. Add `role="listbox"` to `.cmdk-list`, `role="option"` + `aria-selected` to each `.cmdk-item`, and drive `aria-activedescendant` on the input from the `active` index.
3. Store and restore focus to the triggering element on close.
4. Either make list items programmatically focusable (`tabIndex={-1}` + roving management) or explicitly document/accept that only arrow-key navigation is supported (current behavior), but fix the missing screen-reader announcement regardless (#2 covers this).
5. Add a visible `:focus` state to `.cmdk-input` (e.g., a subtle border/box-shadow on the wrapper) so the outline removal isn't a total focus-visibility regression.
6. Have the `"?"` handler (and the command-palette toggle) check a single shared "any overlay open" flag (shortcuts, inspector, confirm, palette) before acting, and have `Escape` handling in each overlay close only the topmost one.
7. Consider a lightweight fuzzy-match (e.g., subsequence matching) for the filter instead of a plain substring test.

---

## Keyboard Shortcuts Sheet & Global Hotkeys

**What's included:**
- `ShortcutsSheet` (`components/shortcuts-sheet.tsx`) — a modal listing three groups (General, Navigation, Composer) of shortcut/label pairs, using `lib/platform.ts`'s `modLabel()`/`altLabel()` to render OS-correct modifier glyphs (`⌘`/`Ctrl`, `⌥`/`Alt`).
- Opened via the account menu, the command palette ("Keyboard shortcuts" entry / `"?"` hotkey), and closes on `Escape` or backdrop click.
- `lib/platform.ts` — `isMacPlatform()` (checks `navigator.platform`/`userAgent`), `modLabel()`, `altLabel()`.
- Documents shortcuts that are implemented elsewhere: `⌘/Ctrl+K` (palette), `?` (this sheet), `Esc` (close), `Alt+N` (new chat), `⌘/Ctrl+B` (sidebar), `Enter`/`Shift+Enter`/`/` (composer — implemented in composer components outside this audit's file list).

**Strengths:**
1. Correctly derives platform-specific modifier labels only after mount (`useMemo` + `mounted` gate, lines 15-44), avoiding an SSR/client label mismatch (server can't know the client's OS).
2. `role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"` is set correctly (line 63).
3. The listed shortcuts are cross-checked against real handlers elsewhere in the codebase (e.g., `Alt+N`/`⌘/Ctrl+B` genuinely match `app-shell.tsx:26-41`; `⌘/Ctrl+K` matches `command-palette.tsx:58`) — the documentation is accurate, not aspirational, for every entry this audit could verify.
4. `isMacPlatform()`'s detection checks both `navigator.platform` and falls back to `navigator.userAgent` (`lib/platform.ts:6-7`), which is more robust than relying on the (deprecated, disappearing) `navigator.platform` alone.
5. The sheet gracefully no-ops (`if (!mounted || !open) return null`, line 54) before both mount and open, avoiding any portal/hydration flash.

**Weaknesses:**
1. No focus trap and no initial focus movement into the dialog on open — unlike the command palette (which autofocuses its input) or the confirm dialog (which `autoFocus`es its confirm button), this modal moves focus nowhere, so a keyboard user who opened it via `"?"` has focus sitting wherever it was before (often `document.body`), and can Tab straight through to background content while the dialog is visually modal.
2. No focus restoration to the trigger on close.
3. As noted in the Command Palette section, the global `"?"` hotkey doesn't check whether *other* overlays (instruction inspector, confirm dialog) are already open before opening this one, creating overlapping same-z-index modals.
4. The shortcut list itself is static/hand-maintained data (lines 17-41) with no mechanism tying it to the actual registered handlers — if a future change removes or rebinds `⌘/Ctrl+B`, nothing will fail a build or test to catch the sheet going stale; the accuracy verified above is correct *today* but structurally unenforced.
5. The composer shortcuts documented here (`Enter`, `Shift+Enter`, `/`) belong to components outside this audit's scope, so their accuracy could not be independently verified in this pass — flagged for completeness, not confirmed broken.

**Fixes:**
1. Move focus to the dialog container (or its close button) on open, and restore it to the trigger element on close.
2. Add a focus trap consistent with the other modals in this audit.
3. Route the global `"?"` hotkey (and the palette's `⌘K`) through the same "is any overlay already open" check recommended in the Command Palette fixes.
4. Consider colocating shortcut definitions with their handlers (e.g., a small shared registry both `app-shell.tsx`/`command-palette.tsx` and `shortcuts-sheet.tsx` read from) so the help sheet can't silently drift from reality.

---

## Molten UI Primitives: Toasts, Confirm Dialog, Menus/Popovers, Switches

**What's included:**
- `Toaster` (`components/ui/toaster.tsx`) — a fixed bottom-right stack (`aria-live="polite"`, `role="status"` per toast) rendering success/error/info variants with `framer-motion` enter/exit and a manual dismiss button.
- `ConfirmDialog` (`components/ui/confirm-dialog.tsx`) — a single global, store-driven (`useConfirmStore`) promise-based confirm/cancel modal (`role="alertdialog"`), used throughout the shell for destructive actions (chat delete, clear-all-chats, sign out is *not* gated by it).
- `ConnectionStatus` (`components/ui/connection-status.tsx`) — a transient online/offline pill driven by real `window` `online`/`offline` events, auto-hiding 2.4s after reconnecting.
- `CountUp` (`components/ui/count-up.tsx`) — an eased, cubic-out animated number counter using `requestAnimationFrame`, with a `compact` (K/M) formatting mode.
- `SuccessCheck` (`components/ui/success-check.tsx`) — a small self-drawing SVG checkmark relying on the `.success-draw` stroke-dasharray animation defined in `app/globals.css:401-404`.
- Shared CSS primitives: `.menu`/`.submenu`/`.popover` (dropdown/flyout system, `app/globals.css:2505-2813`), `.switch` (toggle, 976-1007, with a spring-loaded knob added in the motion-polish layer at 5292-5295), `.toast`/`.toast-region` (3425-3465), `.modal`/`.modal-overlay`/`.confirm-modal` (3569-3663).

**Strengths:**
1. `Toaster`'s region uses `aria-live="polite" aria-atomic="false"` (line 18) — the correct choice so new toasts are announced without re-announcing the whole stack, and `polite` (not `assertive`) so toasts don't interrupt a screen reader mid-sentence.
2. `ConfirmDialog` is a single centralized instance driven by a promise-returning `confirm()` call (rather than each call site rolling its own modal), guaranteeing visual/behavioral consistency for every destructive action in the app.
3. `ConfirmDialog`'s confirm button has `autoFocus` (line 43) so `Enter` immediately confirms — paired with a real `Escape`→cancel / `Enter`→confirm global handler (lines 17-23), giving this one modal fully functional keyboard operation, unlike its siblings.
4. `ConfirmDialog` defaults to the more dangerous-looking (`Trash2`/red) treatment unless the caller explicitly opts out (`danger ?? true`, line 26) — a safe default that biases toward showing users a more severe-looking confirmation for anything unspecified.
5. `ConnectionStatus` is driven by genuine browser connectivity events, not a polling/heartbeat guess, and self-cleans its `setTimeout` on unmount (lines 22-27).
6. `CountUp` correctly cancels its `requestAnimationFrame` loop on unmount/prop change (lines 31-33), avoiding a classic leaked-RAF bug.
7. `SuccessCheck`'s SVG is marked `aria-hidden` (line 4) since it's purely decorative next to accompanying text elsewhere, correctly keeping it out of the accessibility tree.
8. The `.switch` toggle uses a real `aria-pressed` binding wherever it's consumed (verified in `account-row.tsx`'s theme buttons is a different pattern, but `settings/page.tsx`'s `<button className="switch">` toggles all set `aria-pressed={profile?.field}` — e.g. lines 279, 286, 346, 353) rather than relying on visual state alone.
9. Toast auto-dismiss/manual-dismiss both flow through one `dismiss(id)` action in the store, so there's a single code path for removing a toast regardless of trigger.
10. `.toast-region` itself has `pointer-events: none` while individual `.toast` elements re-enable `pointer-events: auto` (`app/globals.css:3434,3447`) — correctly scoped so the empty space around toasts doesn't block clicks to underlying content.

**Weaknesses:**
1. **Stacking hazard: connection pill and tooltip render above modals.** `.conn-pill` is `z-index: 500` and `[data-tip]::after` is `z-index: 400` (`app/globals.css:407... 412,416` region), both **higher** than `.modal-overlay` (250) and even `.cmdk-overlay` (300). `.conn-pill` has no `pointer-events: none` (unlike `.ft-dropzone`/`.ft-uploads`, which explicitly opt out of hit-testing at lines 392,394) — so if connectivity flips while a confirm dialog, the shortcuts sheet, or the instruction inspector is open, the reconnect pill (fixed, bottom-center) renders on top of and can intercept clicks intended for whatever modal content happens to sit underneath it.
2. No focus trap in `ConfirmDialog`, despite `role="alertdialog"` — the ARIA alertdialog pattern specifically expects focus containment; here, `autoFocus` puts focus on the confirm button correctly, but nothing stops `Tab` from leaving the dialog into background content.
3. `ConfirmDialog`'s global `keydown` listener (lines 17-23) treats *any* `Enter` press anywhere on the page as "confirm" and *any* `Escape` as "cancel" while `request` is truthy — there is no check that focus is actually inside the dialog. In practice the lack of a focus trap (#2) means it's possible for focus to have drifted to a background element while the dialog is open, and an `Enter` there would still confirm the (possibly destructive) dialog action rather than whatever the background element's `Enter` behavior would normally be.
4. The `.menu`/`.submenu`/`.popover` primitives (shared by the model picker, agent picker, skills popover, and the account/chat-options menus) rely entirely on ad hoc per-component outside-click listeners rather than a single shared "close on outside click / Escape / focus-trap" hook — this audit found at least three independent, slightly-different re-implementations of the same "outside click closes me" logic (`account-row.tsx:61-78`, `topbar.tsx:59-66`, plus the command palette's backdrop check) instead of one shared utility, increasing the chance of exactly the inconsistencies documented above (e.g., missing `Escape` handling in `topbar.tsx`).
5. `CountUp`'s easing runs from `useEffect` on every `to`/`durationMs` change (line 22) starting the animation from `0` each time (`setVal(0)` isn't explicit, but `val` state starts at 0 on mount and `tick` recomputes from `to * eased` where `eased` starts near 0) — if `to` changes rapidly (e.g., a live usage counter updating every second), each change restarts the count from 0 rather than animating from the previous value, which would look like a visual "reset-then-recount" glitch rather than a smooth increment. (Verified from the effect/deps in lines 22-34; no test currently exercises rapid updates.)
6. `.switch` has no explicit `role="switch"` anywhere it's consumed as a plain `<button className="switch ...">` (e.g., `settings/page.tsx:277-280`) — it relies on `aria-pressed` alone, which communicates a toggle-button semantic but not the more specific "switch" semantic some screen readers surface differently (minor, but inconsistent with the component clearly being designed as an iOS-style switch).

**Fixes:**
1. Add `pointer-events: none` to `.conn-pill` (it has no interactive children) and/or lower its z-index below the modal/palette layer, or explicitly raise modal/palette z-indices above it if connectivity status must always be visible.
2. Add a focus trap to `ConfirmDialog` (and the other modals) — a small shared `useFocusTrap(ref, active)` hook would fix this everywhere at once.
3. Scope `ConfirmDialog`'s `Enter`/`Escape` handling to only fire when the dialog (or its focus trap) actually contains `document.activeElement`, once a focus trap exists making this guaranteed by construction.
4. Extract one shared `useClickOutside`/`useDismissableOverlay` hook used by every menu/popover/modal in the app, replacing the three-plus ad hoc implementations found in this pass.
5. Track the previous displayed value as `CountUp`'s animation start point rather than always animating from 0, so successive value changes visually increment rather than reset.
6. Add `role="switch"` alongside `aria-pressed` (or use `aria-checked` with `role="switch"` instead of `aria-pressed`, per the ARIA switch pattern) wherever `.switch` is used as a toggle.

---

## Settings Screens

**What's included:**
- `SettingsPage` (`app/(app)/settings/page.tsx`) — Appearance (theme picker), Usage (`UsageSection`), Plan & Billing (`BillingSection`), Defaults (default model/effort, thinking/tools-on-by-default), Forge Code build agent autonomy, Personalization (About/Style free-text, persisted to profile), Memory & history (auto-memory toggle, chat-search toggle, editable memory profile textarea), and Data & account (export all data as `.zip`, clear all chats, sign out).
- Local `Card`/`Row` presentational helpers (lines 23-69) reused across every settings section.
- Post-Stripe-redirect handling: reads `?upgraded=true&plan=…` / `?billing_sync=true` query params, shows a welcome toast, calls `/api/stripe/sync` to reconcile the plan from Stripe directly (bypassing potential webhook misconfiguration), invalidates the cached profile query twice (immediately and again after 3.5s), then strips the query params via `router.replace("/settings")` (lines 100-137).
- Deep-link-to-section support via `location.hash` + `scrollIntoView` (lines 140-147), matching the anchors `AccountRow` links to (`/settings#usage`, `/settings#data`).
- `BillingSection` (`components/settings/billing-section.tsx`) — five hardcoded plan cards (Free/Starter/Pro/Max/Ultra) with highlight/full feature lists, a togglable full comparison table, Stripe Checkout (new subscribers) vs. Stripe Billing Portal (existing subscribers) upgrade/downgrade flows, and price IDs read from `NEXT_PUBLIC_STRIPE_*_PRICE_ID` env vars.
- `UsageSection` (`components/settings/usage-section.tsx`) — free-plan daily token bar vs. paid-plan 5-hour + weekly token windows plus seven monthly feature usage bars (images, vision, search, documents, voice in/out, code executions), with a live 1-second countdown tick and a static "How Forge Usage Works" multiplier explainer.

**Strengths:**
1. All plan/pricing copy is provider-neutral and uses only the public "Spark 2.5"/"Magnum 2.8" labels (via `FORGE_MODELS_PUBLIC`, imported correctly at `page.tsx:13`) — no leak of the underlying model provider anywhere in the settings surface.
2. The Stripe-return reconciliation logic (lines 100-137) is a genuinely thoughtful defensive pattern — actively re-syncing from Stripe rather than trusting the webhook alone, with a documented rationale in the code comment ("Don't rely on the Stripe webhook (easy to misconfigure)").
3. Query-param cleanup via `router.replace` (line 136) prevents the `?upgraded=true` toast from re-firing on a page refresh.
4. `UsageSection`'s countdown correctly gates on `usage.dailyResetAt != null && now < usage.dailyResetAt` (and equivalents for 5h/weekly) rather than assuming a window is always active, correctly showing "0 used" once a window has silently expired client-side before the next server sync (lines 115-116, 134-135, 141-142).
5. `Card`'s `scrollMarginTop: 16` (line 43) is set specifically so hash-based `scrollIntoView` navigation doesn't tuck section headings under any sticky chrome.
6. All destructive actions (clear all chats) go through the shared `confirm()` dialog rather than firing immediately (lines 168-179).
7. Personalization and Memory are explicitly and correctly described to the user as being "added to Forge's instructions on every conversation" (line 318) — an honest, transparent explanation of what these fields do, consistent with the Instruction Inspector's purpose elsewhere in the app.
8. `BillingSection`'s upgrade/downgrade logic correctly branches free-user Checkout vs. existing-subscriber Portal (lines 257-270) to avoid creating duplicate Stripe subscriptions, with a clear code comment explaining why.
9. The plan/feature data (`PLANS`, `COMPARISON` in `billing-section.tsx`) is centralized in one typed array/table rather than scattered across JSX, making the actual entitlement copy easy to audit for accuracy against `lib/plans/limits.ts` (not in this audit's scope, but the settings-side representation itself is clean).
10. Every async settings action (`savePersonalization`, `saveMemory`, `downloadAll`, `openPortal`, `handleUpgrade`) sets a local `saving`/`loading` boolean and disables its trigger button while in flight, preventing double-submits.

**Weaknesses:**
1. **Real CSS misuse bug — inconsistent, unstyled control.** The "Default model" `<select>` (`page.tsx:239-251`) is given `className="field"` directly on the `<select>` itself. But `.field` (`app/globals.css:3865-3903`) is a *wrapper* class whose styling rules target descendants (`.field input, .field textarea, .field select { ... }`, line 3875) via a descendant combinator — it only styles a `select` that is *inside* an element with class `field`, not a `select` that *is* `field`. As written, this `<select>` receives none of the intended background/border/radius/color styling (only its inline `style={{ width:200, padding:"8px 10px", margin:0 }}` applies) and renders as a bare, unstyled native OS dropdown. The very next control in the same card, "Default effort" (lines 253-274), achieves the correct look only by hand-duplicating the `.field select` styles inline. The result: two adjacent dropdowns in the same "Defaults" card are visibly inconsistent — one matches the design system, one doesn't.
2. **Default-value mismatch.** The "Default model" select falls back to `"magnum-2.8"` when `profile?.defaultModel` is unset (`page.tsx:243`), but the actual app-wide default model constant is `DEFAULT_MODEL = "spark-2.5"` (`lib/ai/models.public.ts:24`, documented as "New users start on Spark (fast/efficient)"). A new user who has never touched this setting will see "Magnum 2.8" pre-selected in Settings even though their conversations are actually defaulting to Spark 2.5 elsewhere — a real, verifiable display/data mismatch.
3. Disclosure widgets lack `aria-expanded`: `BillingSection`'s "See all features" per-plan-card toggle (`billing-section.tsx:329-341`) and the "Compare all plans" toggle (lines 371-377) both show/hide content on click but neither button sets `aria-expanded`, so screen reader users get no indication the button is a disclosure control or what state it's in.
4. `Card`'s `<h2>` heading and its wrapping `<section id=...>` are not associated via `aria-labelledby` (`page.tsx:35-46`) — for a page with many `<section>` landmarks (Appearance, Usage, Billing, Defaults, Forge Code, Personalization, Memory, Data), a screen reader's landmark list will show unnamed regions instead of "Usage region," "Billing region," etc.
5. The whole page relies heavily on one-off inline `style={{...}}` objects (visible throughout `page.tsx`, e.g. lines 37-50, 55-68, 176-186, 255-264, 296-305) rather than the shared Molten class system used by the rest of the app — functionally fine (and correctly theme-aware since the inline styles reference CSS variables), but it means this page's visual language must be maintained in two places (JSX inline styles here vs. classes in `globals.css` everywhere else), and it's how bug #1 above happened in the first place (inline styles partially masking a missing class-based style).
6. `downloadAll()` (`page.tsx:181-191`) has no maximum-size/timeout handling visible in this component — for a user with a very large account (many conversations, large memory), the export could hang with only a static "Preparing…" label and no progress indication or cancel affordance.
7. The Stripe reconciliation `fetch("/api/stripe/sync")` (line 121) has no visible error surfaced to the user beyond a code comment ("best-effort — webhook is the fallback") — if both the direct sync call and the webhook fail, the user who just paid sees no error and no indication their upgrade might not have registered, only silence.
8. `BillingSection`'s plan cards render `Check` icons decoratively for every feature bullet (e.g. lines 315,322) without `aria-hidden`, so a screen reader may announce a redundant "check" or icon-name before every single feature line across five plan cards and the multiplier card.

**Fixes:**
1. Change the "Default model" `<select>` to either drop `className="field"` and hand-style it identically to "Default effort" (matching the existing sibling control), or better, wrap both selects in an actual `<div className="field">` and let the shared CSS rule apply to both consistently.
2. Change the fallback in `page.tsx:243` from `"magnum-2.8"` to `DEFAULT_MODEL` (imported from `lib/ai/models.public.ts`) so the displayed default always matches the real system default.
3. Add `aria-expanded={expanded === p.id}` / `aria-expanded={showCompare}` to the two disclosure toggle buttons in `billing-section.tsx`.
4. Give each `Card` an `id`-linked heading (`aria-labelledby` on the `<section>` pointing at an `id` on the `<h2>`).
5. Migrate the settings page's structural inline styles into shared CSS classes (or at minimum extract repeated inline-style objects into named constants) to reduce the "two places to maintain" risk that produced bug #1.
6. Add a progress indicator or explicit "this may take a while" messaging plus disable-until-complete guard (already partially present via `exporting` state) with a visible cap or streaming download for very large exports.
7. Surface a toast/error state if `/api/stripe/sync` fails outright (currently only network-level try/catch swallows it silently).
8. Add `aria-hidden="true"` to every purely decorative `Check`/feature-list icon in `billing-section.tsx`.

---

## Instruction Inspector (+ `/api/inspect`) & Provider Secrecy

**What's included:**
- `InstructionInspector` (`components/instruction-inspector.tsx`) — a modal (reusing `.artifact-modal`/`.modal-overlay`) that, when opened, POSTs the current composer state (model, effort, thinking, tools-enabled, active agent, active skills + their instructions, the user's full skill catalog) to `/api/inspect` and renders the returned `systemPrompt` verbatim in a `<pre><code>` block, with a copy-to-clipboard button.
- `/api/inspect/route.ts` — a Zod-validated, Firebase-auth-gated (`verifyRequest`) endpoint that loads the user's custom instructions/memory (`loadUserPromptContext`), optional project instructions/`FORGE.md` (`loadProjectPromptContext`), optional agent instructions (`loadAgentInstructions`), and calls the shared `assembleSystemPrompt()` used by the real chat pipeline, returning `{ systemPrompt }`.
- `lib/ai/prompts.ts` — the single deterministic prompt-assembly function (`assembleSystemPrompt`), the base identity block (which explicitly instructs the model to *never* mention "vendors, hidden implementation details, routing, credentials, or infrastructure" — `prompts.ts:13`), per-model persona strings keyed only by the public `ForgeModelId` (`"spark-2.5"`/`"magnum-2.8"`), and `formatCurrentForgeState()` which renders the "Current Forge State" block shown to the model (and, via this endpoint, to the user).
- The provider-secrecy split: `lib/ai/models.public.ts` (client-safe, no provider strings) vs. `lib/ai/models.ts` (`import "server-only"`, the only file mapping `spark-2.5`/`magnum-2.8` to real provider model ids).
- `tests/prompt-state.test.ts` — asserts the assembled prompt both contains the expected public-facing state lines *and* does not contain `"deepseek"`, `"provider model"`, or `"base url"` (case-insensitive).

**Strengths:**
1. Provider secrecy is verifiably intact end-to-end for this feature: `/api/inspect`'s Zod schema only accepts `forgeModelId: z.enum(["spark-2.5","magnum-2.8"])` (`route.ts:14`) — a client cannot even request a prompt keyed to anything else — and `assembleSystemPrompt`/`MODEL_PERSONA` only ever reference the public `ForgeModelId` type and `modelLabel()`, never the server-only `models.ts` mapping. A live grep of `deepseek|siliconflow|gemini|e2b` across `lib/`, `components/`, `app/` confirms those strings only appear in server-only files (`lib/ai/models.ts`, `lib/ai/provider.ts`, `lib/ai/tools.ts`, `lib/code/runner.ts`, `lib/images/siliconflow.ts`, `lib/vision/gemini.ts`, `app/api/chat/route.ts`) — never in this client-facing feature.
2. A real, targeted regression test (`tests/prompt-state.test.ts:35-51`) explicitly guards against future provider leakage in the assembled prompt, not just against leakage in this one endpoint.
3. The base identity prompt itself proactively instructs the model never to discuss "vendors, hidden implementation details, routing, credentials, or infrastructure" even if asked (`prompts.ts:13`), defense-in-depth beyond the code-level secrecy.
4. The endpoint requires a valid Firebase auth token (`verifyRequest`, `route.ts:32-37`) — it is not an anonymous/unauthenticated debug surface; a request without a valid bearer token gets `401`.
5. The feature is explicitly designed and documented as a *user-facing transparency tool* ("Instruction Inspector — shows the exact merged system prompt... for full transparency", `instruction-inspector.tsx:11-14`), not an internal debug leftover, and is deliberately surfaced in the command palette (`command-palette.tsx:173-183`) rather than hidden — an intentional, reasonable design choice rather than an accidental unguarded surface.
6. Copy-to-clipboard failure is caught and silently ignored rather than throwing (`instruction-inspector.tsx:86-88`), a sensible fallback for restrictive clipboard permissions.
7. The modal correctly guards against stale responses from a superseded request via the `live` flag pattern (`instruction-inspector.tsx:43,67,72-74`), so closing and reopening quickly can't have an old fetch's response overwrite newer state.

**Weaknesses:**
1. **The Inspector's own claim of "exact" fidelity is false — verified by comparing call sites.** `/api/inspect/route.ts`'s call to `assembleSystemPrompt()` (lines 57-79) never sets `webSearchAvailable`, `imageGenAvailable`, `contextBlocks`, `internalForgeOsKnowledge`, or a populated `connectorIds` — none of these fields even exist in the endpoint's Zod schema (`route.ts:13-26`). The **real** chat pipeline (`app/api/chat/route.ts:175-176,198,317-336,344-352`) computes and passes all of these into the identical `assembleSystemPrompt()` call. Consequently, whenever a real conversation would include the Web Search addendum, Image Generation addendum, attached project files/conversation-summary context blocks, the internal Forge OS knowledge doc, or real connector IDs, the Instruction Inspector will *omit all of them* and instead always render "Web search: off", "Image generation: off", and no context/knowledge sections at all — regardless of what's actually active. This directly contradicts the feature's own doc-comment promise of showing "the exact merged system prompt," and could mislead a user into believing capabilities are disabled when they are not (or vice-versa is not possible here, only the omission direction).
2. No focus trap and no initial-focus movement into the modal on open (same pattern as `ShortcutsSheet`), despite `role="dialog" aria-modal="true"` (`instruction-inspector.tsx:93`).
3. No focus restoration to the triggering element (the command palette item, or wherever else this can be opened from) on close.
4. The loading/error text swap (`"Loading…"` / `"Couldn't load instructions."` / the prompt itself, line 110) happens inside a plain `<pre><code>` with no `aria-live` region, so a screen reader user gets no announcement when the fetch resolves or fails.
5. As covered in the Command Palette section, this modal can end up stacked with the Keyboard Shortcuts sheet (both share `.modal-overlay`'s z-index 250) since the global `"?"` handler doesn't check whether the Inspector is currently open before also opening the Shortcuts sheet.
6. The endpoint has no rate limiting visible in this file (unlike, presumably, the real chat endpoint) — since it calls `assembleSystemPrompt` plus several Firestore reads (`loadUserPromptContext`, `loadProjectPromptContext`, `loadAgentInstructions`) per request, a client could hit it in a tight loop with no server-side throttle evident in `route.ts` itself.
7. The displayed prompt includes the user's full Memory profile and Custom Instructions verbatim (`prompts.ts:439-440` sections, fed from `userCtx.memory`/`userCtx.customInstructions`) — appropriate for a transparency tool, but there is no warning in the UI (`instruction-inspector.tsx`) that the copy button will copy this personal data to the clipboard, which could be a mild oversharing risk if a user copy-pastes the whole block into an external bug report without realizing their memory profile is embedded in it.

**Fixes:**
1. Either (a) update `/api/inspect`'s schema and call site to accept and pass through `webSearchAvailable`, `imageGenAvailable`, `contextBlocks`, `internalForgeOsKnowledge`, and real `connectorIds` so the displayed prompt genuinely matches what the next real message would send, or (b) if full fidelity is intentionally out of scope, change the UI copy/doc-comment to say "an approximation of your active instructions" rather than "the exact merged system prompt."
2. Add focus-trap + initial-focus-on-open + focus-restore-on-close, consistent with the fixes recommended for `ShortcutsSheet`/`ConfirmDialog`.
3. Wrap the prompt/loading/error text in an `aria-live="polite"` region so state changes are announced.
4. Route this modal's `"?"`/open-check through the same shared "any overlay open" guard recommended elsewhere.
5. Add a basic rate limit (or confirm one exists at a shared middleware layer not visible in this file) given the endpoint performs multiple Firestore reads per call.
6. Add a one-line note near the copy button (e.g., "Includes your saved memory and personalization") so users understand what they're about to copy externally.

---

## Small Lib Utilities: Fonts, Shiki, Confetti, Platform

**What's included:**
- `lib/fonts.ts` — Next.js `next/font/google` loaders for Space Grotesk (`--font-space-grotesk`, weights 400–700) and JetBrains Mono (`--font-jetbrains-mono`, weights 400–600), both `display: "swap"`.
- `lib/shiki.ts` — `highlightCode(code, lang)` wrapping `shiki`'s `codeToHtml`, a single fixed dark theme (`github-dark-default`) used in both app themes (documented rationale in the file's comment), a language-alias map (`js→javascript`, `py→python`, etc.), and a safe fallback to `lang: "text"` if highlighting the requested language throws.
- `lib/confetti.ts` — `burstConfetti(x?, y?)`, a dependency-free celebratory particle burst built on the Web Animations API, self-cleaning via `setTimeout`, respecting `prefers-reduced-motion` by no-op'ing entirely.
- `lib/platform.ts` — `isMacPlatform()`, `modLabel()`, `altLabel()` (covered above under Keyboard Shortcuts).

**Strengths:**
1. `display: "swap"` on both fonts (`fonts.ts:8,16`) avoids invisible-text-on-load (FOIT), trading it for a brief flash of a fallback font instead — the correct default choice for a text-heavy app.
2. `highlightCode`'s try/catch fallback to plain "text" highlighting (`shiki.ts:11-16`) means an unrecognized or exotic language tag can never crash code-block rendering — it degrades gracefully to unhighlighted (but still readable, monospaced) text.
3. The alias map (`shiki.ts:19-33`) covers the common short-form language tags a model is likely to emit (`js`, `ts`, `py`, `sh`, `yml`, `c++`, `c#`) rather than requiring exact Shiki grammar names, reducing the odds of falling into the fallback path unnecessarily.
4. `burstConfetti` fully respects `prefers-reduced-motion` by returning immediately (`confetti.ts:6`) rather than merely shortening the animation — a correct, complete opt-out rather than a partial one.
5. The confetti implementation is self-contained (no external animation library), uses the native Web Animations API (`element.animate(...)`), and cleans up its own DOM node via `setTimeout` (`confetti.ts:38-39`) rather than leaking detached nodes.
6. `isMacPlatform()`'s dual check (`navigator.platform` OR `navigator.userAgent`) is a pragmatic hedge against `navigator.platform`'s ongoing deprecation across browsers.
7. All four files are small, single-purpose, and free of any provider/vendor-identifying strings — clean with respect to the provider-secrecy invariant.

**Weaknesses:**
1. `burstConfetti` creates and animates 90 individual DOM elements per call (`confetti.ts:15-36`) with no cap on repeated rapid calls — if a caller triggers it more than once in quick succession (e.g., a double-click or a retry loop), the fixed-position wrapper divs stack up (each self-removing after 1600ms) and could transiently create several hundred animated DOM nodes simultaneously; there's no guard/debounce against re-entrant calls in this file itself.
2. `highlightCode`'s fallback path (`shiki.ts:14-15`) calls `codeToHtml` a **second** time synchronously after the first attempt throws, effectively double-invoking Shiki's (non-trivial) highlighting work on the failure path for every unrecognized language — acceptable for occasional misses, but there's no caching/memoization of results across repeated renders of the same code+lang pair, so scrolling a long conversation with many code blocks re-highlights identical content every time a block re-mounts.
3. `lib/platform.ts` has no test coverage in the audited `tests/` directory (no `platform.test.ts` found), despite `isMacPlatform()`'s heuristic (string matching on `navigator.platform`/`userAgent`) being exactly the kind of browser-quirk logic most prone to silent regressions across environments.
4. `lib/confetti.ts`'s color palette (line 13) is a hardcoded array of hex literals entirely independent of the Molten token system (`--amber`, `--ok`, etc.) — every other visual element in the app is themed via CSS variables, but confetti color is a one-off, unthemed exception (functionally fine since it's meant to be multicolored, but worth noting as the one place raw hex literals substitute for the design-token system).

**Fixes:**
1. Add a simple in-flight guard (e.g., a module-level boolean or a minimum-interval check) to `burstConfetti` so rapid repeated calls can't stack multiple 90-particle bursts simultaneously.
2. Add a small in-memory cache (keyed by `lang+code` hash) around `highlightCode` so identical code blocks aren't re-highlighted by Shiki on every mount/scroll-into-view.
3. Add a unit test for `isMacPlatform()`/`modLabel()`/`altLabel()` with mocked `navigator.platform`/`userAgent` values covering Mac, Windows, Linux, and iOS/iPadOS.
4. Optionally derive the confetti palette from existing Molten tokens (`--amber`, `--amber-bright`, `--ok`, plus a couple of extra festive accents) for at least partial design-system consistency, if a fully generic multicolor burst isn't a hard requirement.

---

# Summary of the Most Critical Findings

1. **Instruction Inspector is not "exact."** `/api/inspect/route.ts` omits `webSearchAvailable`, `imageGenAvailable`, `contextBlocks`, `internalForgeOsKnowledge`, and real `connectorIds` from its `assembleSystemPrompt()` call, unlike the real chat route (`app/api/chat/route.ts`) — the tool always shows tools/web-search/image-gen as "off" and never shows attached project/context data, contradicting its own "exact merged system prompt" documentation.
2. **CSS class collision breaks a real button.** `.artifact-icon` is defined twice with conflicting styles (`app/globals.css:1930` vs `2082`); the later rule wins everywhere, so the artifact card's "Show/Hide code" toggle (`components/chat/artifact-card.tsx:82`) renders as a 40px amber tile instead of its intended plain 30px hover icon.
3. **Undefined CSS variable.** `.dock-build-bar` references `var(--surface-2)` (`globals.css:349`), which is never defined in either theme — the build progress-bar track is invisible/transparent.
4. **No focus trap in any modal.** Command palette, shortcuts sheet, instruction inspector, confirm dialog, and the account menu all lack Tab-containment despite several claiming `aria-modal="true"`.
5. **Command palette input has zero focus-visible style.** `.cmdk-input` sets `outline: none` with no compensating `:focus` rule anywhere in the stylesheet.
6. **Keyboard-unreachable sidebar delete.** The chat-row delete control (`sidebar.tsx:242-253`) has no `tabIndex`/`onKeyDown` and is nested inside another interactive `role="button"` row — only mouse users can delete a chat from the sidebar.
7. **Global hotkeys ignore composer focus.** `app-shell.tsx`'s `⌘/Ctrl+N`/`Alt+N`/`⌘/Ctrl+B` handler has no input/textarea exclusion (unlike the command palette's own `"?"` handler), risking silent draft loss while typing.
8. **Overlapping same-z-index modals.** The global `"?"` hotkey and each overlay's own `Escape` handling don't check for other already-open overlays, so the Instruction Inspector and Keyboard Shortcuts sheet (both `z-index: 250`) can stack and both close on one `Escape` press.
9. **Settings "Default model" dropdown is unstyled and shows the wrong default.** `className="field"` is misapplied directly to a `<select>` (needs a wrapper) so it renders unstyled, and its fallback value (`"magnum-2.8"`) contradicts the real app default (`DEFAULT_MODEL = "spark-2.5"`).
10. **`--text-faint` fails WCAG AA contrast (~3:1) in both themes**, computed directly from the token hex values, yet is used throughout for body-sized secondary text (nav labels, subtext, hints).

Provider secrecy was independently verified as intact across every file in scope: no `deepseek`/`siliconflow`/`gemini`/`e2b` strings appear in any client-visible surface, the `models.public.ts`/`models.ts` split is respected, `/api/inspect`'s schema only accepts the public model ids, and a dedicated regression test (`tests/prompt-state.test.ts`) guards against future leaks in the assembled prompt.

Audit file written to: `C:\Users\jbrk1\AppData\Local\Temp\claude\C--Users-jbrk1-Desktop-ForgeOS\3427f231-95d2-4308-b3c1-f6b9df634292\scratchpad\audit-ui.md`
