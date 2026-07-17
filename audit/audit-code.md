# Forge Code — Exhaustive Feature Audit

Scope: `lib/code/**`, `lib/code/verify/**`, `lib/ai/build-plan.ts`, `lib/ai/skill-execution.ts`, `app/api/code/**`, `app/(app)/code/**`, `components/code/**`, `app/api/data/checkpoints/**`, `app/api/data/build-log/**`, and their tests. Every file in scope was read in full. All citations are `file:line`.

---

## Project Gallery, Starters & Plan Gating

**What's included:**
- Gallery grid listing the user's projects with thumbnail gradient, language, file count, and relative-time last-edit — `app/(app)/code/page.tsx:91-116`.
- "New Project" flow via modal: name + starter pick (Blank/HTML/React/Vue/Python) — `components/code/new-project-modal.tsx:1-97`, starter catalog in `lib/code/starters.ts:130-187`.
- Each starter ships a real, minimal runnable scaffold (not demo content) so preview works immediately — `lib/code/starters.ts:22-128`.
- Project deletion with a confirm dialog — `app/(app)/code/page.tsx:44-57`.
- Plan gating: Forge Code is Pro+ only (`canUseForgeCode`, `lib/plans/gates.ts:47-49`); gallery and IDE both render a full-page `ForgeCodeUpgrade` paywall otherwise — `app/(app)/code/page.tsx:59-68`, `app/(app)/code/[id]/page.tsx:32-40`, `components/code/forge-code-upgrade.tsx:1-41`.
- Per-plan project-count ceilings (pro 20 / max 50 / ultra unlimited, free/starter 0) — `lib/plans/gates.ts:59-65`; gallery blocks project creation at the cap and opens the upgrade-gate store instead — `app/(app)/code/page.tsx:31-42`.
- Model routing note surfaced to the user in the upgrade copy ("AI builds your projects with Magnum 2.8") — `components/code/forge-code-upgrade.tsx:9`. This is the one place a *model name* (not a provider) is shown; it's a public Forge label, not a leak.

**Strengths:**
1. Starters are genuinely runnable, not placeholder text — e.g. the HTML starter wires `index.html`/`style.css`/`script.js` together correctly (`lib/code/starters.ts:22-57`).
2. `getStarter` safely falls back to the first starter (`blank`) for an unknown id instead of throwing — `lib/code/starters.ts:189-191`.
3. Deletion requires an explicit confirm modal, preventing accidental data loss — `app/(app)/code/page.tsx:47-54`.
4. The upgrade paywall is a full, on-brand component rather than a bare 403 — `components/code/forge-code-upgrade.tsx`.
5. Project-limit messaging dynamically names the *next* plan up ("pro" → "max" → "ultra") instead of a static string — `app/(app)/code/page.tsx:33`.
6. Gallery skeleton-loads placeholders while projects stream in, avoiding a blank flash — `app/(app)/code/page.tsx:89-90`.
7. New-project creation navigates straight into the IDE (`router.push`) so the user lands in a working state immediately — `components/code/new-project-modal.tsx:35-36`.
8. Starter gradients are precomputed per-starter and reused for the project thumbnail, giving visual continuity from creation to gallery card — `lib/code/starters.ts:136,145,158,171,183` vs `app/(app)/code/page.tsx:94-95`.
9. `codeLocked` is checked independently on both the gallery and the `[id]` IDE route, so a Pro user can't route around the gate by deep-linking a project URL — `app/(app)/code/[id]/page.tsx:32-40`.
10. The empty-state copy explicitly reassures the user that Forge Code shares files/account with Forge Chat, reducing confusion about "another app" — `app/(app)/code/page.tsx:119-123`.

**Weaknesses:**
1. `NewProjectModal.create` swallows the real error and always shows a generic "Couldn't create project" toast — `components/code/new-project-modal.tsx:37-39` — a quota error, network error, and server 500 are all indistinguishable to the user.
2. No client-side validation on project name length/characters before submit; only trimmed — `components/code/new-project-modal.tsx:31-34` — an empty/whitespace name silently falls back to "`<Starter> project`" with no visible feedback that the typed name was ignored.
3. The Python starter (`lib/code/starters.ts:179-186`) and Blank starter (`lib/code/starters.ts:131-139`) both set `previewMode: "none"`, so a brand-new Python project shows "Preview isn't available for this project type yet" (`components/code/preview-pane.tsx:86-96`) even before the user has done anything — a slightly discouraging first impression with no explanation of *why* Python has no preview (it's a script-runner category, not a web preview category, but the UI doesn't say so).
4. `getProjectLimit` returns `null` for "ultra" but the UI comparison `atProjectLimit = projectLimit !== null && projects.length >= projectLimit` (`app/(app)/code/page.tsx:29`) is correct, but the *upgrade suggestion* logic (`plan === "pro" ? "max" : plan === "max" ? "ultra" : undefined`, line 33) will pass `undefined` as `requiredPlan` for any other plan value, silently producing a gate dialog with no upgrade target if `plan` is ever an unrecognized string (defensive gap, not defensively typed against `resolvePlanId`).
5. There is no "duplicate project" feature (only duplicate *file* exists in the file tree, `lib/data/files.ts:159-175`), so starting a new project "like this one" requires downloading and re-uploading, or manual re-creation.
6. No search/filter/sort control on the gallery when a user has many projects (pro tier allows up to 20, max 50) — the grid has no pagination or sort-by-recency toggle beyond natural list order returned by `useProjects()`.
7. The gallery's delete button is a `<span role="button">` nested inside a `<button>` project card (`app/(app)/code/page.tsx:98-106`) — nesting interactive elements inside a `<button>` is invalid HTML and can produce inconsistent keyboard/AT behavior (the outer button's click still fires via bubbling unless `stopPropagation` fully suppresses it, which it does here, but a screen reader announcing "button" inside "button" is non-conformant).
8. `ForgeCodeUpgrade`'s feature list is static copy (`components/code/forge-code-upgrade.tsx:6-12`) that must be hand-kept in sync with actual shipped capabilities; e.g. it says "Download and publish your projects" but doesn't mention checkpoints/history, code execution, or skills — incomplete marketing surface, not a functional bug.
9. No project template/starter preview thumbnail beyond a flat gradient swatch (`components/code/new-project-modal.tsx:74-77`) — a user can't see what the React/Vue starter actually looks like before committing.
10. `getFeatureLimit`/gates are re-derived on every render via `usePlan()` with no memoized combination of `codeLocked`/`projectLimit`, which is fine at this scale but would re-run gate math on every parent re-render as the project list grows.

**Fixes:**
1. Surface the actual thrown error message (or a mapped, still-generic-but-specific string per error type) instead of one blanket toast.
2. Disable "Create" until the trimmed name is non-empty, or show inline placeholder-becomes-name feedback.
3. Add a one-line explanatory caption in the preview pane's empty state for non-web project kinds ("Python projects run via the Run panel, not a live preview").
4. Fall back `requiredPlan` to a sane default (e.g. `"ultra"`) when `plan` isn't `pro`/`max` so the gate dialog always has a target.
5. Add a "Duplicate project" action next to Delete, reusing `writeFilesByPath`/starter-copy logic.
6. Add simple client-side sort (recent/name) once project counts grow past a page.
7. Restructure the delete affordance as a sibling control outside the `<button>`, or use a non-button wrapper with explicit `role="group"`.
8. Keep the feature list generated from an actual capability manifest, or at least periodically re-audit it against shipped features.
9. Render a tiny static screenshot or live mini-iframe per starter card.
10. Memoize `codeLocked`/`projectLimit`/`atProjectLimit` with `useMemo` keyed on `plan`/`projects.length`.

---

## Monaco IDE, File Tree & Tabs

**What's included:**
- Full IDE shell: file tree, tab bar, editor/preview split, status bar — `components/code/ide.tsx:204-329`.
- Monaco editor wrapped with custom "Molten" light/dark themes, self-hosted `vs` assets (avoids jsDelivr CDN + cross-origin tracking-prevention warnings) — `components/code/monaco-editor.tsx:9-14,16-74`.
- Ctrl/Cmd+S saves immediately via a Monaco command binding — `components/code/monaco-editor.tsx:102`.
- Debounced autosave 800ms after the last keystroke, plus an explicit "save now" path (used before running a script) — `components/code/ide.tsx:110-119`.
- Tabs: open/close/switch, dirty-dot indicator per tab — `components/code/ide.tsx:27,86-93,211-231`.
- Default file selection on load prefers `index.html`, then any text file, then any file — `components/code/ide.tsx:47-58`.
- Auto-switches to Split view the first time a preview becomes available (once per session) — `components/code/ide.tsx:61-66`.
- Draft state resyncs from the server copy only when the tab isn't locally dirty, so the Build Dock rewriting the open file live-updates the editor without clobbering unsaved user edits — `components/code/ide.tsx:71-77`.
- Draggable code/preview split divider — `components/code/ide.tsx:121-139,286`.
- File tree: create/rename/delete/duplicate/move (drag-drop) file or folder, context menu, tree/grid view toggle, OS file drag-and-drop import (≤2MB, ≤12 files/import) — `components/code/file-tree.tsx:96-175,392-419`.
- Binary/image/PDF viewer for non-text categories — `components/code/binary-viewer.tsx`.
- Per-file "Run" trigger for Python/JS files, wired to the E2B execution route — `components/code/ide.tsx:143-202,246-256`.
- Status bar: dirty/saved state, language label, cursor line/col — `components/code/ide.tsx:309-321`.

**Strengths:**
1. Monaco is served same-origin (`/monaco/vs`) instead of a CDN, eliminating third-party network calls and browser tracking-prevention console noise — `components/code/monaco-editor.tsx:9-14`.
2. Custom "molten-dark"/"molten-light" Monaco themes are defined once in `beforeMount` and reused, matching the app's design language even inside the embedded editor — `components/code/monaco-editor.tsx:16-73`.
3. The dirty-vs-clean resync logic (`!dirty[id] && drafts[id] !== content`) correctly avoids clobbering in-flight edits when the AI rewrites the same file — `components/code/ide.tsx:71-77`.
4. Debounced save (800ms) balances save frequency against Firestore/API write volume — `components/code/ide.tsx:110-112`.
5. `runActiveScript` force-saves and clears any pending debounce before executing, so "Run" always executes the latest edited content, not a stale save — `components/code/ide.tsx:150-152`.
6. File tree drag-and-drop guards against moving a folder into itself or its own descendant — `lib/data/files.ts:120-122`.
7. Rename/move cascade correctly rewrites all descendant paths for a folder rename, not just the folder's own row — `lib/data/files.ts:100-109,136-144`.
8. External OS file drop is capped both by count (12) and per-file size (2MB) before any network call — `components/code/file-tree.tsx:150-152`.
9. `duplicateNode` produces a sensible `name-copy.ext` (handles dotted extensions) rather than a naive suffix — `lib/data/files.ts:160-163`.
10. The keyboard-first `NameInput` (used for both create and rename) commits on Enter/blur and cancels on Escape, a small but correct UX detail — `components/code/file-tree.tsx:176-200`.
11. Binary/image files never get routed into the text editor; `isTextCategory` cleanly branches to `BinaryViewer` — `components/code/ide.tsx:266-276`, `lib/code/languages.ts:74-76`.
12. `canRunScript`/`runLanguage` derivation correctly restricts the Run button to files that are both a runnable language *and* a text category (guards against e.g. a `.py` binary blob) — `components/code/ide.tsx:143-145`.
13. Context menu closes on any outside click or scroll, not just click — `components/code/file-tree.tsx:75-84`.

**Weaknesses:**
1. **Race condition in `writeFilesByPath`**: it does one `GET` then one `POST` with no locking/transaction/If-Match (`lib/data/files.ts:182-269`); if the Build Dock's corrective pass and a concurrent manual IDE edit both write near-simultaneously, one silently overwrites the other with no merge or conflict warning.
2. Autosave and the AI's live-rewrite-resync (`components/code/ide.tsx:71-77`) can race: if the user types into a file at the exact moment the AI's write for that same path lands, the `!dirty[id]` check may briefly be false→true→false across renders in a way that isn't atomic with the debounce timer, risking a save that clobbers the just-applied AI content (no revision/version check anywhere in `updateContent`, `lib/data/files.ts:68-77`).
3. `updateContent` computes `size` client-side via `new Blob([content]).size` (`lib/data/files.ts:70-71`) with no upper bound enforced on manual edits — only `writeFilesByPath` (the AI path) enforces the 900KB cap (`lib/data/files.ts:225-230`); a user can paste an enormous file directly into Monaco with no client or server-side size guard.
4. The file tree has no virtualization — `renderNode` recurses over the full tree every render (`components/code/file-tree.tsx:202-274`); a large generated project (hundreds of files) will visibly lag on drag-over/rename.
5. Drag-and-drop only supports moving into the root or a folder target; there's no visual "insert before/after" indicator, and dropping onto a *file* silently no-ops (`if (target && target.kind !== "folder") return;`, `components/code/file-tree.tsx:126`) with zero user feedback that the drop was rejected.
6. `moveNode`/`renameNode` re-fetch the entire project's file list (`getProjectFilesOnce`) just to compute descendants (`lib/data/files.ts:101-104,137-140`) — O(n) round-trip per rename/move even for a single leaf file with no descendants.
7. The Monaco editor has no per-file undo-history persistence across tab switches (Monaco's default in-memory model is discarded when `value` prop changes without an explicit model registry), so switching away and back to a file loses Ctrl+Z history for that session.
8. No conflict/staleness indicator when the Build Dock is actively writing to the file currently open in the editor — the user gets a silent content swap with no "AI updated this file" toast if they're not looking at the Build Dock panel.
9. `BinaryViewer`'s SVG inline-render path (`components/code/binary-viewer.tsx:16-19`) creates a Blob URL directly from stored `content` with `image/svg+xml`, but SVG can contain `<script>`; it's rendered via `<img>` (not `<iframe>`/inline SVG), which browsers do NOT execute scripts for — safe — but this safety relies entirely on using `<img>` and would become an XSS vector if ever swapped to `dangerouslySetInnerHTML` or an inline `<svg>` mount.
10. No file search/quick-open (Ctrl+P style) across the project — navigating a large tree requires manual expand/scroll.
11. The IDE's `didAutoSplit` "auto-switch to split view once" (`components/code/ide.tsx:61-66`) uses a `ref` that resets on component remount (e.g., navigating away and back to the project) — "once" is really "once per mount," not once per project, so it can re-trigger and override a user's deliberate switch back to Code-only view.
12. Grid-view breadcrumb reconstruction (`components/code/file-tree.tsx:278-292`) re-walks `files` with a linear `find` per path segment — O(depth × files) on every render while in grid view.

**Fixes:**
1. Add optimistic concurrency (e.g. an `updatedAt`/version check) to `writeFilesByPath` and `updateContent`, or at least detect "changed since last read" and surface a merge/overwrite prompt.
2. Add a small explicit "AI is editing this file" banner in the editor when the Build Dock touches the currently-open path, suppressing autosave until the AI write settles.
3. Enforce the same byte-size ceiling (with a friendly inline error) in `updateContent`/Monaco's `onChange` path as `writeFilesByPath` already does.
4. Virtualize the tree (e.g. windowed rendering) once file counts exceed ~200.
5. Add a visual drop-rejection cue (shake/red outline) when dropping onto a non-folder target.
6. Cache the file list once per drag/rename session instead of re-fetching for every operation, or compute descendants from the already-loaded `files` prop instead of a fresh network call.
7. Register per-file Monaco models keyed by file id so undo history persists across tab switches.
8. Add a toast/inline badge when the Build Dock overwrites the file currently open in the editor.
9. Keep the `<img>`-based SVG rendering path; add an explicit comment/test guarding against ever switching to inline SVG mounting for user content.
10. Add a lightweight fuzzy file-open palette.
11. Key `didAutoSplit` off project id (persist in local storage) rather than a component-lifetime ref.
12. Memoize the breadcrumb path-to-folder lookup with a path→id map instead of repeated linear scans.

---

## Preview & Sandboxing

**What's included:**
- Preview-kind detection from actual file extensions present (`.vue` → vue, `.jsx`/`.tsx` → react, `.html` → web, else none) — `lib/code/preview.ts:10-17`; effective mode prefers a stored mode, falling back to detection so a blank project becomes previewable the moment the AI adds files — `lib/code/preview.ts:21-28`.
- Static web assembly: inlines local `<link rel=stylesheet>` and `<script src>` into one `srcdoc`, resolving relative to the current page — `lib/code/preview.ts:102-146`.
- Multi-page navigation inside the preview: a click-intercept shim posts `{__forgeNav, __forgeFrom}` to the parent, which resolves the target file and re-renders — `lib/code/preview.ts:94-97`, `components/code/preview-pane.tsx:51-61`, `resolveNavTarget` `lib/code/preview.ts:77-92`.
- React/Vue bundling entirely in-browser via `esbuild-wasm`, with a virtual-file-system resolver plugin (`vfs` namespace) and bare imports proxied to `esm.sh` — `lib/code/preview.ts:148-252`.
- React 18 / Vue 3 pinned via an `importmap` pointing at `esm.sh` CDN builds — `lib/code/preview.ts:30-38`.
- `localStorage`/`sessionStorage` shim: since the iframe is sandboxed *without* `allow-same-origin` (deliberately, for origin isolation), storage access throws by default; a tiny inline script probes it and swaps in an in-memory polyfill if it throws, injected as the first thing the document executes — `lib/code/sandbox-shim.ts:1-40`.
- Preview iframe sandbox flags: `allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock`, explicitly no `allow-same-origin` — `components/code/preview-pane.tsx:145`.
- Manual refresh (new iframe via `key={nonce}`), "open in new tab" (writes the assembled doc into a blank window), and a live "URL bar" cosmetic (`localhost:5173/...`) — `components/code/preview-pane.tsx:99-134`.
- Debounced (350ms) rebuild on file-content signature change — `components/code/preview-pane.tsx:63-84`.
- Publish flow assembles a single self-contained HTML snapshot (nav shim disabled for published output) and stores it server-side — `lib/code/export.ts:40-59`, `lib/code/preview.ts:136-137`.

**Strengths:**
1. Deliberately omitting `allow-same-origin` gives generated/AI-written code an opaque origin, so it structurally cannot reach the host app's Firebase session, cookies, or parent DOM — `components/code/preview-pane.tsx:1-16` (comment), `:145`.
2. The storage shim is a defense-in-depth fix for a real, specific failure mode (opaque origin + `localStorage` access throws + uncaught exception kills the whole script) rather than a blanket try/catch band-aid — `lib/code/sandbox-shim.ts:1-16`.
3. `injectStorageShim`/`injectReporterShim` are idempotent (checked via a `MARKER` string) so re-running preview assembly on already-shimmed HTML doesn't double-inject — `lib/code/sandbox-shim.ts:28`, `lib/code/verify/reporter-shim.ts:57`.
4. Multi-page nav resolution tries index-of-folder, trailing-slash, and `.html`-suffix candidates, matching common static-site conventions — `lib/code/preview.ts:87-90`.
5. `esbuild.initialize` is memoized in a module-level promise (`esbuildReady`) so repeated bundling doesn't re-download/re-init the wasm binary — `lib/code/preview.ts:148-158`.
6. The bundler correctly special-cases React/Vue runtime packages as `external` so the app doesn't ship two copies of React (its own bundle plus the CDN one) — `lib/code/preview.ts:40-47,210,222-224`.
7. `buildBundle` is the single code path shared by the live preview *and* the verification harness (`checkBundle`), so "what the user sees" and "what gets verified" can't drift apart — `lib/code/preview.ts:196` docstring, used by `lib/code/verify/static-checks.ts:123-131` and `lib/code/verify/runtime-probe.ts:28`.
8. `errorDoc` HTML-escapes the bundler error message before embedding it in the fallback error page, avoiding self-XSS from an error string that happens to contain markup — `lib/code/preview.ts:189-192`.
9. Preview debounce (350ms) plus a `live` closure flag correctly cancels a stale in-flight bundle if files change again before it resolves — `components/code/preview-pane.tsx:63-84`.
10. Publishing explicitly disables the nav shim (`withNav=false`) since a published snapshot is single-page and doesn't need in-preview link interception — `lib/code/export.ts:47`, `lib/code/preview.ts:102`.
11. The "open in new tab" action writes the already-assembled `srcDoc` directly rather than re-fetching/re-bundling, guaranteeing WYSIWYG parity with the visible iframe — `components/code/preview-pane.tsx:123-131`.

**Weaknesses:**
1. **Unrestricted third-party code fetch at runtime**: any bare import in AI-generated code is silently proxied to `https://esm.sh/<pkg>` with no allowlist, pinning, or integrity check (`lib/code/preview.ts:230-231`) — the model can cause the preview (and the verification harness, which reuses the same bundler) to fetch and execute arbitrary npm packages from a third-party CDN with zero review.
2. React/Vue versions are hardcoded (`react@18.3.1`, `vue@3.4.21`, `lib/code/preview.ts:32-38`) with no update path other than editing source — a security patch to React/Vue never reaches existing or new projects without a code change.
3. The reference-checker / nav-target resolver and the live preview's `<link>`/`<script>` inliner are independent regex-based HTML parsers (`lib/code/preview.ts:114-133`, `lib/code/verify/static-checks.ts:61-77`) rather than a real HTML parse — malformed or unusually-formatted tags (e.g. multi-line attributes, single-quoted mixed with double-quoted) can silently fail to match and produce false "broken reference" verification failures or a preview that doesn't inline a real stylesheet.
4. `assembleWeb`'s script/stylesheet inliner only matches `<script src="...">...</script>` closed on a `<script>...</script>` pair via a single regex (`lib/code/preview.ts:123-125`) — a self-closing or oddly-spaced script tag won't match and will silently render as a dead reference in the live preview with no console warning surfaced to the user (only the verifier would catch it, and only for touched-and-runtime-checked project types).
5. No CSP is applied to the preview `srcdoc` beyond the iframe `sandbox` attribute — combined with the unrestricted esm.sh proxying (#1), a malicious or compromised AI response could load and run any external script the browser would otherwise fetch (mitigated, but not eliminated, by the opaque origin).
6. The "publish" flow bundles React/Vue apps but there is no size/perf ceiling — a large project with heavy CDN deps produces a bundled HTML blob that could be very large for what's meant to be a shareable static page.
7. `resolveNavTarget`/`assembleWeb` don't handle files whose paths contain query strings or fragments already (`clean = href.split(/[?#]/)[0]`, `lib/code/preview.ts:83`) consistently with the static-checks equivalent — two independent implementations of the same "strip query/fragment" logic (`lib/code/verify/static-checks.ts:44`) that could drift.
8. The preview iframe's sandbox includes `allow-popups` (`components/code/preview-pane.tsx:145`) which lets generated code open new (also sandboxed, but still) windows/tabs — a broader surface than strictly required for a "preview," and no popup-blocking toggle exists for the user.
9. `bundleApp`'s error surface (`errorDoc`) only shows the top-level esbuild error message; multi-error builds (several files with issues) collapse to whichever error esbuild reports first, i.e. worse diagnostics than the static-checks path which lists up to 4 (`lib/code/verify/static-checks.ts:111`).
10. There's no timeout on `ensureEsbuild()`/`buildBundle()` in the live preview path — a pathological project (e.g. a circular import that hangs the resolver) could leave the preview stuck on "Bundling…" indefinitely with no user-facing cancel.

**Fixes:**
1. Route bare-import resolution through an allowlist of known-safe packages or at least pin exact versions server-side with SRI-style integrity hashes before proxying to esm.sh.
2. Make React/Vue CDN versions configurable constants with a scheduled review, or bundle them locally instead of via CDN.
3. Replace regex HTML scanning with a lightweight real parser (e.g. `parse5` or the DOM via a detached `document`) shared between preview assembly and static verification.
4. Broaden the script/link regexes to tolerate self-closing tags and attribute order variance, or unify on the parser fix above.
5. Add a minimal `Content-Security-Policy` meta tag to assembled documents restricting fetch/script origins to esm.sh + the app's own asset host.
6. Warn (not block) when a published bundle exceeds a size threshold.
7. Extract the "strip query/fragment, resolve relative path" helper into one shared module used by both preview and verify.
8. Consider dropping `allow-popups` unless a project actually needs it, or gate it behind a per-project toggle.
9. Aggregate and surface all esbuild errors, not just the first output file's message.
10. Add a client-side timeout (e.g. 15s) around `buildBundle` in the live preview with a "Bundling is taking longer than expected — retry?" fallback.

---

## Retrieval-First Context Building

**What's included:**
- Pure, dependency-free relevance ranking of project files against the user's request: explicit path/basename mention (+40), path-token keyword overlap (+6/hit), body keyword overlap (capped, +2/hit up to 8), entry-point boost (+8), config/docs boost (+5), recency boost (up to +4), and reference-graph proximity expansion (+18 decaying by 6/hop) — `lib/code/retrieval.ts:141-237`.
- Byte-budgeted context assembly: full file tree always included (free), most-relevant files inlined in full up to a byte budget and a max-file-count, everything else reduced to a compact "signature" (line/byte count + a few exported/heading lines) with an explicit note it can be requested in full — `lib/code/retrieval.ts:239-266,274-333`.
- Per-effort tuning of the retrieval budget (`retrievalBudgetBytes` 90k→260k, `retrievalMaxFullFiles` 30→140, `retrievalNeighborDepth` 1→3 across low→max effort) — `lib/code/forge-code-config.ts:79-143`.
- Import/require/`href`/`src`/`url()` reference-graph extraction with relative-path resolution and extension guessing — `lib/code/retrieval.ts:94-120`.

**Strengths:**
1. Explicitly designed to replace a naive "dump every file alphabetically until budget runs out" approach that could silently drop the exact file the user is asking about — `lib/code/retrieval.ts:1-16` (doc comment) is a real, verifiable design improvement.
2. camelCase/kebab/snake/path-separator-aware tokenization means `myComponent.tsx` matches a request mentioning "my component" — `lib/code/retrieval.ts:79-92`.
3. Reference-graph expansion means editing `App.jsx` also pulls in `Header.jsx` it imports, even if the request never names `Header.jsx` — `lib/code/retrieval.ts:212-229`.
4. Files that don't fit are never silently dropped — they get a signature plus an explicit instruction to the model that it can ask for the full contents rather than guessing — `lib/code/retrieval.ts:322-325`.
5. Byte-length estimation avoids `Buffer`/`TextEncoder` runtime differences (works identically client- and server-side) — `lib/code/retrieval.ts:258-266`.
6. STOPWORDS list is scoped to genuinely low-signal words (articles, generic verbs like "make"/"build"/"add") rather than over-aggressively filtering domain terms — `lib/code/retrieval.ts:55-62`.
7. `rankFiles` is a pure function, independently unit-testable and tested (`tests/retrieval.test.ts`), decoupled from any network/AI call.
8. Deterministic tie-breaking (`a.path.localeCompare(b.path)`) makes ranking output stable/reproducible for the same inputs — `lib/code/retrieval.ts:236`.
9. Real-file filter (`real = files.filter(f => typeof f.content === "string")`) guards against folder entries (which have `content: undefined`) polluting scoring — `lib/code/retrieval.ts:280`.
10. The budget check happens per-candidate in ranked order, so the highest-value files are always the ones spent on, not whichever happens to iterate first — `lib/code/retrieval.ts:294-305`.

**Weaknesses:**
1. `referencedPaths`/`resolveRef` build candidate paths via string concatenation + a fixed extension list (`lib/code/retrieval.ts:114-120`) but never actually verify the resolved import matches typical bundler resolution rules (e.g. package.json `main`/`exports`, TS path aliases) — a project using `@/` aliases (which this very codebase uses!) would not have its cross-file references detected by the reference-graph boost.
2. Scoring is a hand-tuned, ad hoc sum of magic numbers (40/6/2/8/5/4/18) with no test asserting the *relative* ordering stays sane as the file corpus grows — `tests/retrieval.test.ts` presumably checks specific cases, but there's no guard against silent regressions when someone tweaks one weight.
3. `budgetBytes`/`maxFullFiles` are enforced independently per-call (`makeContext`) — retrieval is re-run from scratch on *every* internal LLM call in a build (plan, main pass, each corrective pass, the verifier) with no caching of the ranked result across a single build run beyond the one-time `retrievalLogged` flag for logging — `components/code/build-dock.tsx:642-654` — meaning ranking work (up to O(files × query-tokens)) repeats redundantly per call.
4. Body-keyword matching does `body.includes(t)` for every token against every file's full lowercased content (`lib/code/retrieval.ts:183-188`) — on a large file this is a linear scan per token; for a big project with many large files this is O(files × tokens × avg-file-size), with no caching of lowercased content across calls.
5. No penalty/exclusion for binary or huge generated files (e.g. a vendored bundle) — if such a file happens to score high via keyword overlap, its raw bytes are inlined into the LLM context up to the budget, wasting the budget on content the model can't usefully act on.
6. The "signature" fallback greps for lines matching a fixed prefix set (`export|import|function|class|const|...`) that is JS/TS/HTML-centric — Python (`def`, `class`) is covered, but e.g. Rust/Go/Java files would get poor signatures.
7. `neighborDepth` expansion only walks *outgoing* references from mentioned files (`refs.get(p)`), never incoming references (who imports the mentioned file) — renaming a shared utility won't surface its call sites via the graph boost, only via generic keyword overlap.
8. There is no logging/telemetry beyond the dev-console trace (`log.retrieval`, `lib/code/agent-log.ts:97-103`) to detect when retrieval is systematically excluding a file the user actually needed — failures here are invisible except as "the AI didn't know about X" bug reports.

**Fixes:**
1. Teach `resolveRef` about the project's actual alias config (read `tsconfig.json`/`vite.config` paths if present) so `@/`-style imports resolve for the reference graph.
2. Add a small property-based or snapshot test asserting monotonic ordering properties (e.g. "a file whose basename is literally in the request always outranks one that isn't").
3. Cache the ranked result (or at least the tokenized query + lowercased file bodies) for the duration of one build run, since the project files rarely change between the plan/execute/verify calls within it.
4. Precompute a lowercased-content index once per `makeContext` call rather than per-token-per-file.
5. Exclude obviously-generated/vendored paths (e.g. `dist/`, `node_modules/`, minified bundles) from full-inline scoring, or cap their score.
6. Add signature patterns for more languages (Rust `fn`/`impl`, Go `func`/`type`, Java `class`/`public`).
7. Build a reverse-reference index too, and give incoming-reference proximity a smaller but nonzero boost.
8. Log ranked-file lists (already captured in `AgentRunSummary.stages`) somewhere queryable for retrospective debugging of "AI missed a file" reports.

---

## Build Pipeline Orchestration (Plan → Execute → Apply → Finalize)

**What's included:** the full client-side agent loop lives in `components/code/build-dock.tsx:592-1357` (the `send` function). See the dedicated **Pipeline flow (verbatim)** section at the end of this document for the exhaustive step-by-step trace — this section covers the orchestration layer's design as a feature.

- Two dock modes: Build (edits files) and Discuss (chat-only, no file writes) — `components/code/build-dock.tsx:74,592-826`.
- Per-request AbortController wiring so Stop cancels the in-flight fetch and any pending plan-approval promise — `components/code/build-dock.tsx:656-657,1359-1362`.
- A visible multi-stage "agent pipeline" rail (Analyze → Retrieve → Plan → Execute → Verify → Fix → Finalize) reflecting the current phase — `components/code/build-dock.tsx:217-308`.
- Plan-approval gate: when `buildAutonomy` is `"plan"`/`"step"`, the plan is shown and the pipeline blocks on a promise resolved by Approve/Cancel — `components/code/build-dock.tsx:777-789,1363-1364`.
- Structured per-run logging (`AgentRunLog`) capturing every stage's timing/outcome, persisted alongside the assistant's build-log message and rendered as a collapsible trace — `lib/code/agent-log.ts`, `components/code/build-dock.tsx:429-467,1342`.
- A running "forge tokens spent" tally (`spentForgeTokens`) used as a hard stop condition for corrective passes and the (dead) self-correction loop — `components/code/build-dock.tsx:662,716,886,1069,1155-1157,1224-1227`.
- Checkpoint-before-write safety net: the very first successful mutation in a build snapshots the pre-build file state — `components/code/build-dock.tsx:870-875`.

**Strengths:**
1. The entire orchestration is client-driven but every actual file mutation still goes through server-authenticated APIs (`writeFilesByPath` → `/api/data/files/bulk`), so a compromised/buggy client loop still can't write to another user's project.
2. Effort truly scales *process depth* (planning, retrieval, corrective-pass budget, token budget) rather than output size — output is always capped at the fixed `FORGE_CODE_MAX_OUTPUT_TOKENS` regardless of effort (`lib/code/forge-code-config.ts:8-18,23`), a deliberate and sound design choice documented in the module.
3. The planning pass is bounded by both a hard timeout (`effortProfile.planTimeoutMs`) and its own AbortController tied to the main abort signal, so a hung/slow plan can never block the build indefinitely — `components/code/build-dock.tsx:743-772`.
4. A checkpoint is created lazily (`ensureCheckpoint`, idempotent via `checkpointCreated`) exactly once, right before the *first* real write of the run, rather than unconditionally on every send — avoids checkpoint spam while still guaranteeing a pre-build restore point — `components/code/build-dock.tsx:870-875,913-914,947`.
5. Streaming UI updates are throttled to ~10/sec (`throttleTrailing`, 90ms) specifically to stop a fast token stream from janking/flashing the panel on every token — `components/code/build-dock.tsx:108-135,747-750,804-808`.
6. The plan-approval flow correctly resolves `false` on Stop (`components/code/build-dock.tsx:1360`) so aborting during the approval wait doesn't leave a dangling unresolved promise.
7. `AgentRunTrace`/`agent-log.ts` deliberately record zero model output or provider details ("It deliberately records NO model output / code and NO provider details, so it is safe to surface" — `lib/code/agent-log.ts:11`) — a clean, verified provider-secrecy boundary.
8. The dev-only console trace (`if (NODE_ENV !== "production")`) means the structured stage log never spams production logs — `lib/code/agent-log.ts:121-131`.
9. Every corrective/backstop pass reuses the *current* file map (`current`, refreshed after each write) rather than the stale pre-build snapshot, so a chain of corrective passes each builds on the last's actual persisted result — `components/code/build-dock.tsx:892,916-917`.
10. The retrieval context is recomputed against `freshFiles`/`current` (post-write) rather than a stale closure, so later passes (fabrication fix, rename fix, runtime heal) see the AI's own prior edits — verified across `runCorrective`'s `mapContents(current)` usage (`components/code/build-dock.tsx:892`).
11. Aborting mid-run correctly distinguishes an intentional Stop (`AbortError` → silent, no error bubble) from a genuine failure (surfaced with a friendly message) — `components/code/build-dock.tsx:1345-1353`.

**Weaknesses:**
1. **The plan's machine-checkable acceptance checklist is never enforced.** `checklist = plan?.checklist ?? impliedChecks` (`components/code/build-dock.tsx:1046`) is passed to `runVerification` **only** inside the dead `shouldRunStrictRequestReview` branch (`components/code/build-dock.tsx:1172`); the one call to `runVerification` that actually executes passes a **hardcoded empty array** instead (`components/code/build-dock.tsx:1055`, `runVerification(codeFiles(), verifyMode, [])`). The Plan card explicitly promises the user "*N* acceptance check(s) will confirm it's done and works" (`components/code/build-dock.tsx:412-416`) — a promise the live code does not keep. See the Pipeline-flow section for full detail.
2. **The strict LLM Verifier/Fixer self-correction loop is fully disabled** via `const shouldRunStrictRequestReview = false;` (`components/code/build-dock.tsx:1049`), making the entire block at `components/code/build-dock.tsx:1151-1285` (diff-aware review, `runVerifier`, `code-verify` mode, `CODE_FIXER_ADDENDUM`-driven fixing, convergence guard, budget-aware cycling) dead code in production. Only a much simpler runtime-only compile/console-error auto-heal loop (`components/code/build-dock.tsx:1051-1100`) actually runs.
3. `showBuildProse = false` (`components/code/build-dock.tsx:590`) means the model's live narration is never rendered during streaming — the corresponding JSX branches (`components/code/build-dock.tsx:1471,1499-1501`) are permanently unreachable dead UI code.
4. **Verification only runs for `web`/`react`/`vue` preview kinds** (`canRuntime = verifyMode === "web" || "react" || "vue"`, `components/code/build-dock.tsx:1045`); any project whose `previewMode` is `"none"` (Python starter, Blank starter, or any project the AI hasn't yet given a recognizable web shape) gets **zero runtime or logic verification** after a build — only the two content-level backstops (fabrication, rename-consistency) and the write-integrity guard apply universally.
5. Duplicated corrective-recovery logic: the "claimed a change but nothing applied" recovery check appears twice, byte-for-byte identical, once inside the `if (mainOps.length)` block and once immediately after it for the zero-ops case (`components/code/build-dock.tsx:999-1004` and `1010-1014`) — a maintenance/DRY smell that risks the two copies drifting if only one is ever edited.
6. `spentForgeTokens` is only incremented from the `"done"` event of each `streamChat` call (`components/code/build-dock.tsx:716`), but the plan-phase call explicitly does *not* flow into this tally check before the main pass begins, and the plan call's own tokens are counted only after the fact — a pathological plan response (e.g. very large due to a runaway generation before hitting its own timeout) is not defended against the `buildTokenBudget` the same way corrective passes are.
7. The single `correctivePasses` counter and `maxCorrectivePasses` budget (`components/code/build-dock.tsx:877,882-885`) is shared across structurally different concerns (failed-op recovery, no-file-ops recovery, fabrication fix, rename fix, and — were it live — verifier fixes) with no per-concern sub-budget, so e.g. three fabrication-detection false-positives in a row can exhaust the entire corrective budget before the rename backstop ever gets a turn.
8. `runCorrective`'s per-call timeout is a flat 150 seconds (`components/code/build-dock.tsx:899`) regardless of effort level — a "low" effort build (which elsewhere gets a much smaller `buildTokenBudget` of 60k, `lib/code/forge-code-config.ts:88`) can still burn 150s on a single corrective pass, working against the "low effort = fast" expectation.
9. The wall-clock loop budget (`LOOP_BUDGET_MS = 240_000`, `components/code/build-dock.tsx:1150`) and per-corrective timeout (150s) are both hardcoded constants inside the component rather than centralized in `forge-code-config.ts` alongside the other effort-tunable knobs — inconsistent with the "single source of truth for tuning" design stated in that file's header comment (`lib/code/forge-code-config.ts:1-6`).
10. `AgentPipeline`'s "Verify" stage node (`components/code/build-dock.tsx:222`) lights up for the cheap runtime-only compile/console check (phases `reviewing`/`validating`/`verifying-strict`/`verifying`) with no visual distinction from what would have been the much stronger adversarial LLM review — a user watching the pipeline rail has no way to tell that "Verify" here means "did it compile," not "was the request actually satisfied."
11. `effortProfile.reviewPass` is defined and documented ("run the automatic self-review pass after executing?", `lib/code/forge-code-config.ts:43`) and asserted `true` in a unit test (`tests/forge-code-config.test.ts:59`) but is **never read anywhere in application code** (confirmed via repo-wide search) — a config field that exists purely to make the test pass, misleading anyone reading the config or the test into believing a review pass is actually gated by it.
12. `BUILD_REVIEW_REQUEST` (`lib/ai/prompts.ts:210-220`) is exported but has zero call sites anywhere in the repository — an orphaned prompt from a previously-removed "standalone review pass," left in the module (the removal is even documented in a nearby comment, `components/code/build-dock.tsx:1006-1009`, but the dead export was never deleted).
13. The Plan phase's own system-prompt injection tells the model "Do NOT write any file blocks in this turn" (`lib/ai/prompts.ts:145`) but nothing double-checks that on the client: if the model ignores the instruction and emits file blocks during the plan call, `planOut` is only ever passed through `parseBuildPlan` (`components/code/build-dock.tsx:759`) which just extracts the `forge-plan` JSON fence and silently ignores any stray file blocks — no warning is logged if the plan turn also emitted (and wasted) real file-write content.
14. `impliedChecksToPrompt` tells the model, in the live system/user prompt, "The verifier will enforce these checks after you write files" (`lib/code/implied-checks.ts:164-165`) — given weakness #1/#2 above, this is now a factually false statement baked into a production prompt (harmless in that it just makes the model try harder, but it is an internally inconsistent claim that should be corrected once the loop is fixed or the wording softened).
15. There is no unit or integration test anywhere in `tests/` that exercises `components/code/build-dock.tsx`'s orchestration logic end-to-end (all existing tests target the pure `lib/code/*` modules in isolation) — none of the dead-code findings above (#1–#4) would be caught by the existing test suite; they were only found by manual trace.

**Fixes:**
1. Route the live `runVerification` call at line 1055 through the same `checklist` variable already computed at line 1046, or explicitly comment why it's intentionally empty (it doesn't appear intentional given the UI promise).
2. Either re-enable `shouldRunStrictRequestReview` (after cost/latency validation) or remove the dead branch, its unused imports (`parseVerdict`, `formatVerdictForFix`, `sortIssues`, `Verdict`, `buildDiffs`, `formatDiffsForPrompt`, `CODE_FIXER_ADDENDUM`), and the now-provably-dead `VerifierPanel`/`reviewNarration`/`issuePhrase` UI, to stop misrepresenting shipped behavior.
3. Remove the `showBuildProse` flag and its dead branches, or wire a real "trusted narration" mode if the intent is to eventually show it once file blocks apply cleanly.
4. Extend runtime verification to cover non-web project kinds too (e.g. a lightweight Python syntax/lint check via the E2B runner) instead of skipping verification entirely for `previewMode: "none"` projects.
5. Collapse the duplicated no-file-ops recovery check into a single guarded call after both branches.
6. Check `spentForgeTokens` against the budget before *and* after the plan call, not just before corrective passes.
7. Give each corrective concern (rewrite-recovery, no-op-recovery, fabrication, rename) its own small sub-budget within `maxCorrectivePasses`.
8. Scale `runCorrective`'s timeout by effort (e.g. via a new `correctiveTimeoutMs` field in `ForgeCodeEffortProfile`).
9. Move `LOOP_BUDGET_MS` and the corrective timeout into `forge-code-config.ts` as effort-scaled values.
10. Visually differentiate "runtime check" from "full review" in the pipeline rail (e.g. a distinct icon/tooltip) until/unless the strict verifier is restored.
11. Either wire `reviewPass` into an actual gate or delete the field and its test assertion.
12. Delete `BUILD_REVIEW_REQUEST` or resurrect its call site.
13. Log a warning (dev-console at least) if the plan-phase response contains a `path=`/`edit=` block despite being told not to.
14. Soften or remove the "the verifier will enforce these checks" claim in `impliedChecksToPrompt` until the enforcement is real.
15. Add integration-level tests (even a scripted mock-fetch harness) around `BuildDock.send`'s core branches — especially the apply/recovery/backstop sequencing — since this is the highest-risk, least-tested file in the whole feature area.

---

## Build Stream Parsing & Edit Protocol

**What's included:**
- Streaming parser that extracts fenced `path=<file>` (full write) and `edit=<file>` (search/replace) blocks from the raw model output while stripping ALL code from the visible narration, including a trailing unterminated fence — `lib/code/build-stream.ts:29-85`.
- SEARCH/REPLACE hunk protocol: `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`, tolerant of marker-length variance (3+ angle/equals chars) — `lib/code/build-edits.ts:16-50`.
- Hunk application: exact match first, then a line-by-line trailing-whitespace-tolerant fallback match — `lib/code/build-edits.ts:55-75`.
- Cumulative resolution: multiple blocks against the same path are resolved in emission order, each building on the previous block's result, then collapsed to one "last op per path" for the actual write — `lib/code/build-stream.ts:188-210`.
- Write-safety heuristics: a full-file write is refused (marked not-ok) if it's truncated (stream cut off mid-block) or "destructive" (collapses a ≥12-non-empty-line file down to ≤3 lines at <20% of its original byte size) — `lib/code/build-stream.ts:153-170`.
- Live per-file status rows for the UI, aggregated one row per path with summed +/− and a "writing"/"done" status, using a lenient partial-hunk parse only for the *live estimate* (never the real write) — `lib/code/build-stream.ts:212-279`, `lib/code/build-edits.ts:25-28,47`.
- LCS-based line diff stats with an O(n·m)-guard fallback to an order-insensitive frequency-count approximation for very large files — `lib/code/build-stream.ts:89-136`.

**Strengths:**
1. Stripping fenced code from the visible narration (`stripFences`) means the chat log never accidentally leaks generated source into the "prose" shown to the user pre-apply — `lib/code/build-stream.ts:29-36`.
2. The truncation/destructive-write guard is a genuinely clever, narrowly-scoped heuristic that directly targets a real observed failure mode ("the classic +1 −762 wipe / garbled rewrite") without being so aggressive it blocks legitimate large deletions (requires *both* a large old file and a near-empty new one) — `lib/code/build-stream.ts:156-169`.
3. Cumulative resolution correctly solves the "19 small edit blocks against one file, only the last one's diff shows" problem that a naive last-write-wins model would suffer — `lib/code/build-stream.ts:190-194,206-210`.
4. The live UI never runs a full diff against a partially-streamed full-file write (it shows lines-written-so-far instead), specifically avoiding "misleading near +1 diff" during streaming — `lib/code/build-stream.ts:239-247`.
5. `applyOneHunk`'s trailing-whitespace-tolerant fallback (`lib/code/build-edits.ts:59-73`) meaningfully increases the odds a hunk lands when the model's copied SEARCH text has trivial whitespace drift, without being so loose it risks matching the wrong block.
6. The empty-SEARCH special case (`search === "" ? (content === "" ? replace : null)`, `lib/code/build-edits.ts:56`) correctly allows a hunk to populate a genuinely empty file while refusing to no-op-match an empty search against non-empty content.
7. `lastOpPerPath` + cumulative resolution together mean multiple edit blocks against one file are applied as one atomic persisted write, not N separate writes — reduces both API calls and the odds of an intermediate half-applied state ever reaching storage.
8. The LCS fallback (`freqCommon`) for huge files avoids the O(n·m) blowup while still giving a reasonable (if order-insensitive) added/removed estimate — `lib/code/build-stream.ts:104-117,134`.
9. All parsing (`parseBuildStream`, `parseEditHunks`, `applyEdits`) is pure and independently tested (`tests/build-stream.test.ts`, `tests/build-edits.test.ts`).
10. The lenient-vs-strict hunk-parsing distinction is explicit in both the type signature and a comment, making it clear which call sites are "for display only" vs. "for the real write" — `lib/code/build-edits.ts:25-28`.

**Weaknesses:**
1. `applyOneHunk`'s exact-match path uses `content.replace(search, replace)` (`lib/code/build-edits.ts:58`) — `String.replace` with a string first argument only replaces the **first** occurrence; if the SEARCH text legitimately appears more than once in the file, only the first instance is changed even when the model intended (or the request implies) all instances change — silently wrong for e.g. "change every occurrence of X".
2. The whitespace-tolerant fallback match (`lib/code/build-edits.ts:60-73`) finds the **first** matching window of lines; if the SEARCH block is short/generic enough to match more than once with different exact content each time, the wrong occurrence can be edited with no ambiguity warning surfaced anywhere (not to the model, not to the user).
3. `parseEditHunks`'s lenient mode (used for the live diff estimate) accepts a hunk whose REPLACE section is still streaming as if it were complete (`lib/code/build-edits.ts:44-47`) — the live "+/−" numbers shown to the user during streaming can visibly over- or under-count relative to the eventual real, strict-mode result, and there is no reconciliation/animation smoothing when the live estimate is replaced by the final number.
4. The "destructive write" heuristic's thresholds (`oldNon >= 12 && newNon <= 3 && f.content.length < old.length * 0.2`, `lib/code/build-stream.ts:167-168`) are hardcoded magic numbers with no configurability and no test asserting they don't produce false positives on legitimate use cases like "strip this file down to a 2-line stub" or false negatives on a 13-line file cut to 4 lines at 21% size.
5. `nextOpen`'s block-boundary detection (`lib/code/build-stream.ts:38-47`) picks whichever of `WRITE_OPEN`/`EDIT_OPEN` occurs first textually — if the model ever emits a plain, unrelated triple-backtick fence (e.g. a markdown example inside its narration, not intended as a file block) that happens to contain the literal substring `path=` or `edit=` right after the fence, it would be misparsed as a real file-write attempt.
6. `lineDiffStats`'s LCS path is `O(n·m)` even under its own 250,000-cell guard (`lib/code/build-stream.ts:134`) — for two ~500-line files this is fine, but the guard threshold is a flat cell-count regardless of available time budget, so on a slow device this could still be a noticeable main-thread stall for moderately large files (this all runs client-side, unthrottled from the render loop, inside `useMemo`, `components/code/build-dock.tsx:577-584`).
7. There is no detection of a hunk whose SEARCH text matches *zero* times **and** whose intended target is ambiguous versus genuinely absent (e.g. the model hallucinated content that was never in the file) — both cases are reported identically as "failed hunk," giving the recovery prompt (`buildFailedOpsRecoveryPrompt`) no way to tailor its guidance to "this text never existed" vs. "this text existed but drifted."
8. `stripFences`'s regex-based fence stripping (`/```[\s\S]*?```/g`, `lib/code/build-stream.ts:32`) is non-greedy but still a single global regex over the whole streamed text on every throttled re-render (`components/code/build-dock.tsx:577-580`) — for a very long build response this re-runs the full strip on the accumulated text each time, rather than incrementally.
9. `buildFileStatuses`'s live path (`components/code/build-stream.ts:229-279`) and `resolveBuildOps`'s persisted path (`lib/code/build-stream.ts:195-202`) are two independently-maintained implementations of "cumulative resolution" that must stay in sync by hand — a future change to one's semantics (e.g. how truncation is detected) could silently diverge from the other, causing the live UI to show different results than what's actually applied.

**Fixes:**
1. Detect multiple occurrences of SEARCH text and either apply to all of them (when a hunk implies "everywhere") or explicitly fail with an "ambiguous match" reason distinct from "not found," rather than silently picking the first.
2. Same fix applied to the whitespace-tolerant fallback path.
3. Reconcile/animate the live estimate to the final strict-mode number rather than a hard jump, or suppress the live number until the hunk closes.
4. Add a few property/unit tests specifically probing the destructive-write boundary conditions (11/12/13 lines, 19%/20%/21% size) to lock in intended behavior.
5. Require a newline immediately before `WRITE_OPEN`/`EDIT_OPEN` (i.e. it must start a fence at line-start) to reduce false-positive matches inside narration examples.
6. Consider a time-budget-based (not just cell-count-based) fallback trigger, or move the diff computation off the main thread (Web Worker) for very large files.
7. Distinguish "no match found" from "multiple candidate matches" as separate failure reasons feeding different recovery prompts.
8. Track a cursor/offset into already-stripped text instead of re-running the fence-strip regex over the full accumulated string each throttled tick.
9. Extract one shared "cumulative resolve" core used by both `buildFileStatuses` and `resolveBuildOps`, parameterized only by strict-vs-lenient hunk parsing.

---

## Integrity Backstops (Truncation Guard, No-Op Recovery, Fabrication, Rename Consistency, Path Safety)

**What's included:**
- Reliable-model pinning: Build mode always executes on `magnum-2.8` regardless of the user's selected chat model — `lib/code/build-integrity.ts:12,17-22`, enforced in the composer (`components/code/build-dock.tsx:530-532`) and at request time (`modelForBuildExecution`, `components/code/build-dock.tsx:676`).
- `claimsBuildChange`: a regex-based heuristic scanning the model's prose for change-claiming verbs (updated/changed/renamed/added/created/…) to detect "said it changed something" — `lib/code/build-integrity.ts:14-15,24-26`.
- No-file-ops / no-applied-diff recovery prompts, tailored to whether any blocks were emitted at all vs. emitted-but-failed — `lib/code/build-integrity.ts:28-44`.
- Truncation-aware failed-op recovery: large existing files (≥250 lines) are recovered via small edit hunks only, never a full re-emit, specifically to avoid re-hitting the same generation time-limit wall — `lib/code/build-integrity.ts:83-111`.
- Honest, non-fabricated summaries for every outcome: applied changes, truncated builds, no-op claims — `lib/code/build-integrity.ts:46-64,113-143`.
- Fabricated/over-claimed bulk-data detection: placeholder-marker regexes (`... more`, `rest omitted`, trailing `// ...`) and a "claimed count vs. present tokens vs. runtime fetch" heuristic — `lib/code/fabrication.ts:7-73`.
- Explicit-rename consistency backstop: extracts an OLD term from rename-shaped requests (quoted, capitalized-brand, or "from X to Y" phrasing) and checks every file for leftovers after the build — `lib/code/consistency.ts:20-58`.
- Path-safety gate: rejects absolute paths, drive letters, URL schemes, home-relative (`~`), parent traversal (`..`), control characters, Windows-reserved filename characters, and absurdly long/deep paths before any write reaches the file system — `lib/code/path-safety.ts:31-76`.

**Strengths:**
1. Pinning Build mode to the "reliable" model independent of the user's chat-model preference is a deliberate, sound reliability trade-off explicitly named as such (`RELIABLE_BUILD_MODEL`) rather than silently overriding user intent without explanation.
2. The recovery-prompt wording is genuinely honest about *why* it's asking for edit hunks vs. a rewrite ("Your previous output was CUT OFF by the generation time limit... re-emitting will hit the same wall") — this is user-facing/model-facing honesty baked into the prompt itself, not just a code comment — `lib/code/build-integrity.ts:93-95,99`.
3. `summarizeTruncatedBuild` explicitly reassures the user "nothing in your project was changed or lost" when a truncation is detected, correctly distinguishing "the platform cut generation off" from "the model lied" (`lib/code/build-integrity.ts:113-128`) — an accurate, non-alarming failure message.
4. The fabrication detector's placeholder-regex list targets the *actual observed failure signatures* (`... more`, `rest omitted`, trailing `// ...`) rather than a generic "looks incomplete" heuristic, minimizing false positives — `lib/code/fabrication.ts:7-14`.
5. The fabrication count-check requires **both** a large claimed count (≥1000) **and** an absence of any runtime-fetch pattern **and** a present-token count under 25% of the claim (`lib/code/fabrication.ts:61-67`) — three independent signals must align before flagging, a conservative design that avoids nagging on legitimately small/representative datasets.
6. Rename-term extraction explicitly excludes a curated stopword list of generic UI nouns ("header", "button", "theme"...) to avoid misfiring on "change the header color" as if it were a brand rename — `lib/code/consistency.ts:9-14`.
7. `path-safety.ts` normalizes backslashes to forward slashes *before* applying its rules, so Windows-style absolute/traversal paths can't sneak past checks written against POSIX conventions — `lib/code/path-safety.ts:38`.
8. The path-safety check runs the same validated path through both `filterSafeOps` call sites (main-pass writes and every corrective-pass write) via one shared function, not two independent copies — `components/code/build-dock.tsx:859-868,912`.
9. All of these modules (`build-integrity.ts`, `fabrication.ts`, `consistency.ts`, `path-safety.ts`) are pure, dependency-free, and independently unit-tested (`tests/build-integrity.test.ts`, `tests/fabrication.test.ts`, `tests/consistency.test.ts`, `tests/path-safety.test.ts`).
10. `staleTermFiles` matches whole-word, case-insensitive (`\\b${term}\\b`, `lib/code/consistency.ts:53`), avoiding false positives like flagging "Forgex" when the rename target is "Forge."
11. `checkWritePath` rejects not just `..` traversal but also `~` home-relative paths and full URL schemes (`http://`, `file://`, etc.) — a broader defensive surface than a minimal "block dotdot" check — `lib/code/path-safety.ts:42-44`.
12. Rejected unsafe paths are never silently dropped without a trace — they're logged with a reason into the structured agent-run log (`components/code/build-dock.tsx:861-867`), making a hallucinated/malicious path attempt forensically visible after the fact.

**Weaknesses:**
1. `claimsBuildChange`'s regex (`lib/code/build-integrity.ts:14-15`) matches on bare verb stems with no negation awareness — a response that says "I did **not** update the config" or "I could**n't** add that feature" is still flagged as `claimsBuildChange === true`, potentially triggering an unnecessary no-op-recovery corrective pass for a turn where the model was being appropriately honest about *not* changing anything.
2. `extractRenames`'s three regex patterns (`lib/code/consistency.ts:26-33`) are all English-phrasing-specific ("rename X to Y", "from X to Y") — a non-English request, or an English request phrased unusually ("swap all mentions of Forge for FireMaker" — no "to/with/into"), won't be detected, silently disabling the rename backstop for that turn with no fallback.
3. The `from\s+X\s+to` pattern (`lib/code/consistency.ts:32`) is broad enough to false-positive on unrelated "from...to" phrasing that has nothing to do with renaming (e.g. "change the hero image from mobile to desktop layout" could extract "mobile" as a rename-from term), triggering a spurious consistency-fix corrective pass hunting for leftover occurrences of "mobile" across the whole project.
4. Fabrication detection's `CODE_FILE` regex (`lib/code/fabrication.ts:16`) doesn't include `.py`, `.md`, `.txt`, or `.csv` — a fabricated large dataset embedded in a Python script or a data file (rather than JS/TS/HTML) is invisible to this backstop entirely.
5. `loadsDataAtRuntime`'s "does it fetch" check (`lib/code/fabrication.ts:38-40`) is satisfied by the mere *presence* of `fetch(`/`axios`/`import(` anywhere in the file — a model could pass this check by writing a `fetch()` call that's never actually invoked, or that fetches something unrelated to the claimed dataset, and the backstop would consider the claim "verified" via the fetch pattern alone with no correlation to what's actually fetched.
6. The path-safety `WIN_RESERVED` regex (`lib/code/path-safety.ts:20`) blocks characters like `<>:"|?*` but does not block the classic Windows *reserved device names* (`CON`, `PRN`, `AUX`, `NUL`, `COM1`...`COM9`, `LPT1`...`LPT9`) as path segments — while this project's storage layer is Firestore/Supabase-backed (not a raw filesystem write), if any downstream tooling (e.g. the ZIP export, or a future local-filesystem sync feature) ever writes these paths to a literal Windows filesystem, a file named e.g. `con.txt` or `nul.js` would fail or behave unexpectedly on that OS.
7. `MAX_PATH_LEN = 400` and `MAX_SEGMENTS = 24` (`lib/code/path-safety.ts:16-17`) are hardcoded with no test asserting they're aligned with any actual downstream storage limit (Supabase/Firestore field-length limits, ZIP/`published` HTML assembly, etc.) — if the real ceiling is lower, a "safe" 399-character path could still fail downstream with a raw DB error surfaced to the user (see Checkpoints/Build-log section below on unfiltered `error.message` passthrough).
8. The destructive-write, fabrication, and rename backstops all run **sequentially, unconditionally** after every build with detected content (`components/code/build-dock.tsx:1016-1033`) even when the build's own request had nothing to do with data or renames — each is a fast, local, pure check, so the cost is low, but there's no early-exit "these backstops don't apply to this class of request" heuristic, meaning every single build pays for three heuristic scans regardless of relevance.
9. There is no cap on how many times the *same* backstop can independently retrigger across a chain of corrective passes within one `maxCorrectivePasses` budget — e.g. if the fabrication corrective pass itself introduces a *new* fabrication-flagged file (unlikely but possible if the fix is also imperfect), the backstop would fire again, consuming another corrective-pass slot with no distinct budget or backoff from the first attempt.

**Fixes:**
1. Add simple negation-awareness to `claimsBuildChange` (e.g. exclude matches immediately preceded by "not"/"n't"/"didn't"/"couldn't" within a short window), or accept the false-positive rate but document it as a known trade-off.
2. Expand `extractRenames`'s phrasing coverage (e.g. "swap X for Y", "replace all X with Y" already partially covered, "call it Y instead of X") and/or add a length/frequency sanity check before trusting an extracted term.
3. Add a stopword/context check to the `from X to Y` pattern to reduce false positives on non-rename "from/to" phrasing (e.g. require the captured term to look like a proper-noun/brand token).
4. Extend `CODE_FILE` to cover `.py`, `.md`, `.csv`, `.json` data files.
5. Strengthen `loadsDataAtRuntime` to require the fetch call's target/variable to correlate with where the claimed data is used (harder, but at least require the fetch to be inside the same function/module scope as the claimed dataset).
6. Add Windows reserved-device-name checks to `checkWritePath` for defense-in-depth, especially before any future local-filesystem export feature.
7. Add an integration test validating `MAX_PATH_LEN`/`MAX_SEGMENTS` against the actual Supabase column limits and ZIP path-length practicalities.
8. Add a lightweight pre-check (e.g. does the request/response even mention data volume or renaming) before running the fuller backstop scans, as a minor perf optimization.
9. Track a per-backstop-type sub-counter within the corrective-pass budget so one flaky backstop can't starve the others.

---

## Runtime Verification Suite (Static Checks, Runtime Probe, Acceptance Checklist)

**What's included:**
- `runVerification` orchestrates: reference checks → compile check (per-file `esbuild.transform` for plain web projects, full `buildBundle` for React/Vue) → runtime probe (only if it compiles) → acceptance-checklist evaluation, deduplicated and capped at 20 issues — `lib/code/verify/index.ts:29-74`.
- `checkReferences`: verifies every local `<link>`/`<script src>`/`<img>`/local-page `<a href>` in every HTML file resolves to a real project file, with folder-index and `.html`-suffix resolution — `lib/code/verify/static-checks.ts:36-79`.
- `checkSyntax`/`checkBundle`: esbuild-backed compile checks, best-effort (skip rather than false-flag if the bundler infra itself is unavailable) — `lib/code/verify/static-checks.ts:91-131`.
- `runtimeProbe`: actually loads the assembled/bundled project in a hidden, off-screen, sandboxed iframe and collects errors + a DOM summary + scripted smoke-test results via `postMessage`, with a hard 4-second timeout — `lib/code/verify/runtime-probe.ts:20-68`.
- `REPORTER_SHIM`: injected before any user script; captures `window.onerror`, unhandled promise rejections, and `console.error` calls (treated as "handled, not blocking"), counts DOM element categories (forms/buttons/canvases/etc.), and executes arbitrary scripted smoke-test code via `new Function(...)` — `lib/code/verify/reporter-shim.ts:8-52`.
- `evaluateChecklist`: evaluates the plan's `PlanCheck` union (`file_exists`, `contains`, `contains_any`, `absent_everywhere`, `page_count`, `dom_has`, `smoke`) against the built files + DOM summary + smoke results — `lib/code/verify/checklist.ts:57-104`.
- Implied checks for interactive/3D games — auto-injected acceptance criteria (canvas presence, `requestAnimationFrame`, Three.js scene objects, WASD/pointer-lock controls, collision/physics/NPC state) plus a bespoke `window.__forgeGameDebug` smoke test — `lib/code/implied-checks.ts:77-149`.

**Strengths:**
1. Static checks run first and cheaply, and the runtime probe is explicitly gated on "does it even compile" (`compiles` flag, `lib/code/verify/index.ts:43,48`) so a broken build never wastes time spinning up an iframe that will just immediately fail.
2. `console.error` calls are treated as "handled, not blocking" (`lib/code/verify/index.ts:55`) — a sound distinction between a caught/logged error and an actual uncaught crash, avoiding false failures on apps that log non-fatal warnings.
3. The reporter shim sends both an "interim" report (on `DOMContentLoaded`/`load`) and a "final" report (after a settle delay), so a fast-failing app's diagnosis doesn't have to wait the full timeout — `lib/code/verify/reporter-shim.ts:43-45`.
4. Smoke-test code runs via `new Function(...)` **inside the sandboxed, opaque-origin iframe** (`lib/code/verify/reporter-shim.ts:37`), not in the host page — arbitrary test code execution is contained to the same sandbox as the app itself.
5. `checkSyntax`/`checkBundle` fail *open* (return no issues) if esbuild itself can't initialize (`lib/code/verify/static-checks.ts:99-101,124-127`) — a bundler infrastructure hiccup never produces a false "your code is broken" verdict.
6. The checklist's `smoke` check type explicitly requires the test to *simulate* real interaction (set input values, dispatch events, call `.click()`) rather than just asserting static content, per the planning prompt's own guidance (`lib/ai/prompts.ts:141`) — a genuinely stronger acceptance-test design than a typical "keyword contains" check.
7. `runtimeProbe`'s `postMessage` handler validates `e.source === iframe.contentWindow` before trusting a message (`lib/code/verify/runtime-probe.ts:58`), preventing an unrelated same-page message (e.g. from a browser extension or another iframe) from being misinterpreted as the verification report.
8. The implied-checks system is a clever, low-cost heuristic layer that gives the model concrete, testable game-development requirements (a named `window.__forgeGameDebug` hook) purely from keyword detection in the request — no LLM call needed to decide these checks apply — `lib/code/implied-checks.ts:77-88`.
9. `evaluateChecklist` wraps each individual check in a `try/catch` so one malformed check (e.g. a bad regex pattern from a hallucinated plan) can't throw and abort evaluation of the rest of the checklist — `lib/code/verify/checklist.ts:70-102`.
10. Reference/syntax/bundle checks are all pure-enough and unit-tested (`tests/verify.test.ts`), and share the exact same `buildBundle` used by the live preview (see Preview section, strength #7), guaranteeing "what's verified" matches "what's shown."
11. The DOM-summary `count()` helper wraps every `querySelectorAll` call in its own try/catch (`lib/code/verify/reporter-shim.ts:19`), so a single malformed selector or DOM state can't take down the whole summary.

**Weaknesses:**
1. **As established in the Pipeline section, `checklist` (including all implied-checks and the plan's own acceptance criteria) is never actually passed to the one `runVerification` call that runs in production** (`components/code/build-dock.tsx:1055` passes `[]`) — every strength described above for `evaluateChecklist`/implied-checks/smoke-tests is currently inert in the live product; only `checkReferences`/`checkSyntax`/`checkBundle`/basic runtime-error capture are actually exercised.
2. The hard 4-second timeout on the entire runtime probe (`lib/code/verify/runtime-probe.ts:63`) is a single fixed constant regardless of project complexity — a React/Vue project bundled via `esbuild-wasm` plus a Three.js scene loaded from `esm.sh` at runtime (exactly the case `implied-checks.ts` targets) may not finish initializing within 4 seconds on a cold cache or slow connection, risking false "runtime OK" (probe times out and returns whatever partial `latest` state existed, `lib/code/verify/runtime-probe.ts:37-42,63`) or missed errors that fire after the timeout.
3. `checkBundle`/`buildBundle` re-fetches from `esm.sh` for every bare import on **every verification run**, not just the live preview — meaning a flaky or slow CDN response can make verification itself intermittently fail or hang, and (per the Preview section's weakness #1) any package the model imports is fetched and executed with no allowlist, now during the *verification* pass too.
4. `dedupe`'s cap of 20 issues (`lib/code/verify/index.ts:12-22,73`) silently truncates anything beyond the 20th distinct issue with no "N more issues not shown" indicator anywhere downstream — a badly broken project could have its real issue count meaningfully understated to both the model and (were it wired up) the user.
5. The smoke-test executor uses `new Function(String(t.code || ''))()` (`lib/code/verify/reporter-shim.ts:37`) with no execution timeout of its own — a smoke test containing an infinite loop or a hung promise-await would stall inside the iframe until the outer 4-second hard timeout fires, but during that window no other diagnostic (DOM summary refresh, later errors) can be captured since the single JS thread is blocked.
6. `checkReferences` and `evaluateChecklist`'s `dom_has` element-type mapping only recognizes a small fixed vocabulary (`form`, `button`, `canvas`, `input`/`field`, `img`/`image`, `a`/`link`, `heading`/`h1`/`title`) — `lib/code/verify/checklist.ts:27-49` — a plan check for e.g. `video`, `audio`, `select`, `table`, or `svg` silently falls through the `default: return false` and is always reported as unmet, regardless of the actual page.
7. `impliedChecksForBuildRequest`'s keyword triggers (`lib/code/implied-checks.ts:79-86`) are broad enough to false-positive on non-game requests that merely mention e.g. "collision" (as in a scheduling-collision feature) or "level" (as in a level meter UI), injecting irrelevant game-specific acceptance criteria (canvas required, `window.__forgeGameDebug` required) into an unrelated build's checklist — though currently moot given weakness #1, this would matter immediately upon fixing that wiring.
8. The reporter shim caps captured errors at 25 (`errors.length<25`, `lib/code/verify/reporter-shim.ts:10`) with no "more errors truncated" signal either.
9. `runtimeProbe`'s iframe sandbox (`allow-scripts allow-forms allow-popups allow-modals`, `lib/code/verify/runtime-probe.ts:33`) omits `allow-pointer-lock`, unlike the live preview's sandbox which includes it (`components/code/preview-pane.tsx:145`) — a pointer-lock-based first-person game (exactly what `implied-checks.ts` targets with "PointerLockControls") cannot actually acquire pointer lock during verification, meaning any smoke test relying on that API behaving normally runs in a meaningfully different environment than the one the user will actually see.
10. There's no telemetry/logging captured anywhere for *which* checklist items pass/fail in aggregate over time — even once wired up, there would be no way to see "implied game checks fail 80% of the time" to know if the heuristic needs tuning.

**Fixes:**
1. Wire the real `checklist` into the live `runVerification` call (see Pipeline-orchestration fix #1) — this is the highest-priority fix in the entire audit.
2. Make the runtime-probe timeout adaptive (e.g. longer when the project bundles heavy CDN dependencies like three.js, shorter for plain HTML/CSS/JS).
3. Cache/pin esm.sh-resolved bundles per verification run (or reuse the already-built live-preview bundle when content hasn't changed) instead of re-fetching every time.
4. Surface a "+N more issues" note when the 20-issue cap is hit, both in logs and (once wired) in any user-facing issue list.
5. Wrap smoke-test execution in its own shorter timeout (e.g. via a Promise.race against a 1.5s timer) so one hung test doesn't consume the entire probe window.
6. Expand `dom_has`'s element vocabulary to match whatever element types plans are actually allowed to request in `BUILD_PLAN_ADDENDUM`.
7. Tighten `implied-checks.ts`'s trigger phrases (e.g. require co-occurrence of at least two game-specific terms, not just one ambiguous word) to reduce false-positive checklist injection.
8. Add a "+N more errors" indicator when the 25-error cap is hit.
9. Align the verification iframe's sandbox flags with the live-preview iframe's (add `allow-pointer-lock`) so verification behavior matches what the user will actually experience.
10. Log aggregate pass/fail rates per check `type` (even just client-side, batched into the existing agent-run log) to make future heuristic tuning data-driven.

---

## Code Execution Runner (E2B Sandbox)

**What's included:**
- Server-only (`"server-only"` import) Python/JavaScript execution via `@e2b/code-interpreter`, gated behind Firebase auth and a per-plan monthly usage counter — `lib/code/runner.ts:1-2`, `app/api/code/run/route.ts:1-55`.
- 30-second hard execution timeout — `lib/code/runner.ts:15,99-103`.
- `stdin` support via language-specific shims that monkeypatch `input()`/`raw_input()` (Python) or `prompt()` (JavaScript) to pull from a pre-supplied line list, raising a clear "input exhausted" error if the script asks for more input than was provided — `lib/code/runner.ts:18-61`.
- Pre-flight detection of scripts that need input but weren't given any (`scriptNeedsInput`), short-circuiting before spending a sandbox execution — `lib/code/run-utils.ts:17-22`, `lib/code/runner.ts:86-94`.
- Graceful "not configured" response (`available: false`) when `E2B_API_KEY` is unset, rather than an error — `lib/code/runner.ts:76-84`.
- Sandbox is always torn down in a `finally` block even on error — `lib/code/runner.ts:122-127`.
- IDE-side "Run" trigger per open file (Python/JS only), force-saving first, wired through `/api/code/run` with a live stdin textarea and formatted stdout/stderr/error panes — `components/code/ide.tsx:143-202`, `components/code/script-runner-pane.tsx`.

**Strengths:**
1. Provider identity (E2B) never reaches the client: the API route and result JSON only ever expose `{stdout, stderr, error, available, inputRequired}` — verified by grep across `components/code/**`, no match for `e2b` (case-insensitive) anywhere client-visible.
2. The `stdin` shims are genuinely well-designed: they preserve the *appearance* of interactive input (echoing the prompt text before returning the canned value, `lib/code/runner.ts:27-28,48`) rather than just monkeypatching silently, so stdout output still reads naturally.
3. `cleanExecutionError` specifically detects the sandbox's generic "frontend does not support input requests" class of error and remaps it to the same friendly, actionable message used for the pre-flight check (`lib/code/runner.ts:63-69,16`) — consistent UX whether the input-need was detected before or discovered during execution.
4. The pre-flight `scriptNeedsInput` check (`lib/code/run-utils.ts:17-22`) avoids burning a monthly-limited sandbox execution on a script that's guaranteed to hang waiting for input that was never supplied.
5. `runCode`'s outer `catch` returns a single generic "Execution failed. Please try again." for any unexpected error (`lib/code/runner.ts:115-121`) — no stack trace, sandbox internals, or provider error text ever reaches the response.
6. The sandbox is unconditionally killed in `finally` (`lib/code/runner.ts:122-127`), even swallowing errors from the kill call itself — no risk of a leaked sandbox process from an execution-path exception.
7. Monthly usage is checked *before* invoking the sandbox and incremented *after* (`app/api/code/run/route.ts:34-53`), correctly gating spend before the expensive call rather than after.
8. `runnableCodeLanguage` accepts both language names and file extensions (`.py`/`.js`/`.mjs`/`.cjs`) so the "Run" button's eligibility check works whether it's classifying by Monaco language id or a raw filename — `lib/code/run-utils.ts:3-15`.
9. The 30-second timeout is applied to both `timeoutMs` and `requestTimeoutMs` (`lib/code/runner.ts:101-102`), covering both the sandbox's internal execution ceiling and the outer request ceiling.

**Weaknesses:**
1. Only Python and JavaScript are supported (`CodeExecutionLanguage = "python" | "javascript"`, `lib/code/runner.ts:5`) — the IDE otherwise supports editing many languages (Go, Rust, Java, C/C++, Ruby, PHP, per `lib/code/languages.ts:22-67`), all of which show no "Run" button at all with no explanation of why, rather than a "language not yet supported" message.
2. `scriptNeedsInput`'s detection is a simple regex for `input(`/`raw_input(`/`prompt(` (`lib/code/run-utils.ts:17-22`) — it cannot detect indirect input calls (e.g. a helper function that itself calls `input()`), so a script needing input via an abstraction layer will not get the pre-flight warning and will instead fail mid-execution with the less-immediate `INPUT_REQUIRED_ERROR` surfaced only after the sandbox already started.
3. The `stdin` shim's Python `input()` replacement (`lib/code/runner.ts:22-41`) reassigns `builtins.input`/`raw_input` globally for the whole process — if the E2B sandbox instance is ever reused across executions (not evidenced in this code, since a fresh `Sandbox.create` is called per run, but not guaranteed by the SDK contract), this global monkeypatch could leak between unrelated runs.
4. There is no per-user concurrent-execution limit — a user could rapidly fire multiple "Run" clicks (or open multiple tabs) launching several concurrent 30-second E2B sandboxes bounded only by the monthly count check, not a concurrency check, which is a potential cost/abuse vector if E2B bills per concurrent sandbox-second.
5. `runCode`'s `apiKey` is read via `process.env.E2B_API_KEY?.trim()` (`lib/code/runner.ts:76`) with no startup-time validation — a misconfigured/empty-but-present env var silently degrades to "not configured" only at first invocation, with no earlier health-check surface for operators.
6. The output size of `stdout`/`stderr` is entirely unbounded on the response side (`lib/code/runner.ts:107-112`) — a script that prints megabytes of output would return the entire blob in one JSON response with no truncation, risking a large payload/slow response or a bloated `ScriptRunResult` held in React state (`components/code/ide.tsx:34`).
7. The client-side `runActiveScript` catches network/auth errors generically ("Script execution failed. Please try again.", `components/code/ide.tsx:195`) — indistinguishable from a legitimate sandbox execution failure surfaced via the same `error` field, so a user can't tell "my script has a bug" from "the request to Forge itself failed."
8. No execution history/log — each Run overwrites the single `runnerResult` state (`components/code/ide.tsx:34,179-188`); there is no way to compare a previous run's output against the current one without keeping it open in another tab.

**Fixes:**
1. Either extend `runnableCodeLanguage` to more languages (if E2B supports them) or show a clear "Run isn't available for this language yet" affordance instead of hiding the button silently.
2. Improve `scriptNeedsInput` with a slightly deeper heuristic (e.g. scan called-function bodies too) or accept the limitation but surface the mid-execution error more prominently as a "add input and retry" flow (which it already does, just reactively).
3. Confirm with the E2B SDK docs whether sandbox instances are ever pooled/reused; if not guaranteed, add a comment noting the assumption explicitly.
4. Add a lightweight per-user concurrency guard (e.g. reject a new Run while one is already in flight for that user).
5. Add a startup/health-check log (server boot) noting whether `E2B_API_KEY` is present, distinct from the per-request lazy check.
6. Truncate `stdout`/`stderr` at a reasonable cap (e.g. 200KB) with a "output truncated" marker.
7. Distinguish network/auth failures from sandbox-reported errors in the client's catch block with a different message.
8. Keep a small (e.g. last-5) run history per file, or at least a way to diff the current result against the prior one.

---

## Checkpoints, Build Log & Agent Run Trace

**What's included:**
- Auto-checkpoint before the first write of any AI build (`Before: <request text>`, kind `"auto"`) and a manual "Save checkpoint now" action — `components/code/build-dock.tsx:870-875`, `components/code/checkpoints-modal.tsx:42-49`.
- Checkpoint size ceiling (900KB total snapshot) — projects too large to snapshot are skipped, and the UI reports "Project is too large to checkpoint" rather than silently failing — `lib/data/checkpoints.ts:9-10,32-33`, `components/code/checkpoints-modal.tsx:48`.
- Server-side history pruning to the 30 most recent checkpoints per project after every insert — `app/api/data/checkpoints/route.ts:9,37-47`.
- Checkpoint list is metadata-only (no file snapshot) for cheap polling; the full snapshot is fetched only when a specific checkpoint is opened/restored — `app/api/data/checkpoints/route.ts:11-12,18-25`, `app/api/data/checkpoints/[id]/route.ts:11-23`.
- Restore rewrites snapshot files and deletes any file that didn't exist at that checkpoint — `lib/data/checkpoints.ts:66-81`.
- Build log: persisted user/assistant turns with attached file-change lists, skills used, and the structured `AgentRunSummary` trace — `lib/data/build-chat.ts:9-42`, `app/api/data/build-log/route.ts`.
- Build-log/checkpoint inserts tolerate a DB that predates the `agent_run` column (drop the field and retry) — `app/api/data/build-log/route.ts:34-41`, `app/api/data/build-log/[id]/route.ts:20-26`.
- `AgentRunTrace` UI: a collapsible per-message trace of every pipeline stage, its timing, and (for verify-capable stages) pass/fail — `components/code/build-dock.tsx:429-467`.

**Strengths:**
1. Checkpoint history correctly separates cheap metadata listing from the expensive full-snapshot fetch, so the history panel's live-polling subscription (`subscribeCheckpoints`) never re-downloads every file snapshot on every poll tick — `lib/data/checkpoints.ts:49-59`, `app/api/data/checkpoints/route.ts:11-12`.
2. The 900KB snapshot ceiling with an honest failure message avoids silently saving a truncated/corrupt checkpoint for an oversized project — `lib/data/checkpoints.ts:32-33`.
3. Server-side pruning (cap 30) runs as a best-effort side-step after every checkpoint insert, bounding storage growth without requiring a separate cron/cleanup job — `app/api/data/checkpoints/route.ts:37-47`.
4. Both `build-log` and `checkpoints` routes verify `user_id` ownership on every query (`GET`/`PATCH`/`DELETE` all filter by `.eq("user_id", user.uid)`), preventing one user from reading/mutating another's history via a guessed id — `app/api/data/build-log/[id]/route.ts:18`, `app/api/data/checkpoints/[id]/route.ts:18-19,29-33`.
5. The `agent_run` column graceful-degradation retry (`app/api/data/build-log/route.ts:34-41`) is a genuinely thoughtful migration-safety pattern — a pending DB migration never breaks the build-log write path, it just temporarily loses the richer trace.
6. The auto-checkpoint's label embeds the actual user request text (`Before: ${text}`, `components/code/build-dock.tsx:874`), giving genuinely useful context when browsing history rather than a generic timestamp-only label.
7. `AgentRunLog`'s design explicitly and verifiably records no model output/code/provider details (see Pipeline-orchestration strength #7) — safe to persist and display without any redaction step.
8. `normalizeFileChanges` tolerates a legacy `string[]` format for the `files` field (`lib/data/build-chat.ts:32-41`), meaning old build-log rows written before diff-stats existed still render without breaking.
9. `addBuildMessage` writes to the server *and* optimistically appends to the local poll cache in the same call (`lib/data/build-chat.ts:65-71`), avoiding a visible gap between the streaming panel clearing and the persisted message appearing.

**Weaknesses:**
1. **`restoreCheckpoint` does not itself create a safety checkpoint of the current state before overwriting** (`lib/data/checkpoints.ts:66-81`) — restoring is a one-way, only-reversible-if-you-happen-to-have-another-earlier-checkpoint operation; a user who restores by mistake loses whatever unsaved-to-checkpoint state existed at that moment, with only a generic confirm dialog (`components/code/checkpoints-modal.tsx:53-61`) standing between them and permanent loss of current work.
2. Both `checkpoints` and `build-log` API routes return raw Supabase error messages directly to the client (`jsonError(error.message, 500)`, `app/api/data/checkpoints/route.ts:24,35`, `app/api/data/build-log/route.ts:20,42`) — while not an AI-provider leak, this can surface internal schema/column details (e.g. exactly the `agent_run` column-name string visible in the special-cased retry logic) to any client able to trigger a DB error, which is an information-disclosure hygiene issue.
3. The checkpoint POST route trusts the client-supplied `id` field verbatim for the insert (`checkpointToInsert`, `lib/supabase/mappers.ts:444-455` — `id: c.id` sourced from client-generated `genId("cp")`, `lib/data/checkpoints.ts:34`) with no server-side regeneration or uniqueness re-check; a client bug (or a maliciously crafted request bypassing the normal UI) reusing an existing id could produce an insert conflict or, depending on the DB's conflict handling, an unintended overwrite of another checkpoint row (mitigated by the `user_id` scoping on other operations, but the insert itself doesn't confirm non-collision).
4. `restoreCheckpoint`'s delete-then-write ordering (`lib/data/checkpoints.ts:72-79`) writes the snapshot files first, then re-fetches the *entire* current file list just to compute which files to delete — an O(n) full-project re-read for what could be computed from the already-known pre-restore file list if it were threaded through instead.
5. There's no "diff this checkpoint against current" view — restoring is all-or-nothing with no preview of exactly what will change, unlike the Build Dock's own live +/- diff tracking for AI edits.
6. The `MAX_CHECKPOINTS = 30` pruning query (`app/api/data/checkpoints/route.ts:9,38-43`) re-fetches *all* checkpoint ids for the project on every single checkpoint creation just to find the tail beyond 30 — an unbounded-growth-shaped query (bounded in practice by the very pruning it performs, but still redundant work triggered on every save).
7. Build-log messages have no pagination — `GET /api/data/build-log` (`app/api/data/build-log/route.ts:9-22`) returns the *entire* history for a project ordered by `created_at` ascending with no `limit`/cursor, so a long-lived, heavily-iterated project's Build Dock will load an ever-growing, unbounded payload on every page visit.
8. No delete-confirmation is required for individual checkpoint deletion (`del`, `components/code/checkpoints-modal.tsx:74-77`) — unlike project deletion and file deletion elsewhere in the app, which both use the shared `confirm()` dialog, checkpoint deletion is instant and irreversible with a single click.
9. The `AgentRunTrace` UI is rendered per persisted build-log message (`components/code/build-dock.tsx:1444`) but there is no way to inspect an *in-progress* run's trace beyond the live pipeline rail — if a build errors out before reaching `log.finish`, no partial trace is ever persisted or shown, losing forensic detail about exactly how far a failed run got.

**Fixes:**
1. Auto-create a checkpoint of the current state immediately before any restore, symmetrically with the auto-checkpoint-before-build pattern already in place.
2. Return a generic "couldn't load/save" message to the client and log the real Supabase error server-side only (matching the pattern already used for AI-provider errors in `app/api/chat/route.ts`'s `friendlyError`).
3. Have the server generate the checkpoint id (or at minimum use an upsert-with-conflict-check) rather than trusting the client-supplied id verbatim.
4. Compute the delete-set from the pre-restore file list already available in the calling context instead of re-fetching.
5. Add a lightweight "N files changed" preview before confirming a restore.
6. Only run the prune query periodically (e.g. every Nth save, or via a scheduled job) rather than on every single checkpoint creation.
7. Add pagination/cursor support to the build-log GET endpoint and load incrementally in the Build Dock.
8. Route checkpoint deletion through the shared `confirm()` dialog like every other destructive action in the app.
9. Persist a partial `AgentRunSummary` (via `log.finish` called from the `catch` branch too, with an "error" outcome) so failed runs still leave a forensic trace.

---

## Export, Publish & Download

**What's included:**
- Full-project ZIP download using the real file tree via `jszip`, with filename-safe project-name sanitization — `lib/code/export.ts:9-28`.
- Publish flow: assembles a self-contained static HTML snapshot (web projects as-is; React/Vue bundled via the shared `buildBundle`) and posts it to a public `published` table, returning a shareable `/p/{id}` link — `lib/code/export.ts:30-59`.
- Unsupported project kinds (Python, Blank) explicitly refuse to publish with a clear error rather than producing a broken snapshot — `lib/code/export.ts:49`, surfaced via `components/code/[id]/page.tsx:60-63`.
- Publish UX: confetti burst, clipboard-copy of the link, a toast, and an automatic new-tab open of the published page — `app/(app)/code/[id]/page.tsx:58-83`.
- Re-publishing reuses the existing `published.id` if the project was already published, rather than minting a new link each time — `lib/code/export.ts:51`.

**Strengths:**
1. ZIP export writes the *real* file tree (paths and all), so a downloaded project preserves the exact folder structure the user sees in the IDE, not a flattened re-derivation — `lib/code/export.ts:19-24`.
2. The download filename is defensively sanitized (`replace(/[^a-z0-9-_]+/gi, "-")`) and falls back to `"project"` for an empty/all-symbol name, avoiding a broken or unsafe filename — `lib/code/export.ts:26`.
3. Publish reuses `assembleWeb`/`bundleApp` — the exact same code path already exercised by the live preview and the verifier — so what gets published is guaranteed WYSIWYG with what the user already saw working, not a separately-implemented export renderer that could drift.
4. Publish explicitly disables the multi-page nav shim for the exported snapshot (`assembleWeb(files, undefined, false)`, `lib/code/export.ts:47`) since a published page is meant to be a single self-contained document — a deliberate, correct behavioral difference from the live in-IDE preview.
5. The publish button's UX correctly handles the clipboard-write failing gracefully (still shows a success toast, just without the "copied" qualifier) rather than treating a clipboard permission failure as a publish failure — `app/(app)/code/[id]/page.tsx:71-76`.
6. Idempotent republish (`project.published?.id ?? genId("pub")`, `lib/code/export.ts:51`) means updating a published project's content doesn't churn its public URL, so previously shared links keep working after an update.

**Weaknesses:**
1. There is no unpublish/delete-published-page action anywhere in the reviewed code — once a project is published, there's no UI path to take the public link down again short of a direct database operation.
2. Publish has no confirmation step before making project content public (`onPublish`, `app/(app)/code/[id]/page.tsx:58-83`) — a single click on "Publish" immediately posts the assembled HTML to a public table and opens it in a new tab; there's no "this will be publicly accessible — continue?" gate, which is a meaningfully different trust level than downloading a private ZIP.
3. `downloadProjectZip` includes every file's content verbatim with no size/streaming consideration — an extremely large project (approaching many individual 900KB-capped files) is fully materialized into memory (`zip.generateAsync`) before the download starts, with no progress indicator for a large export.
4. Publish silently fails to include any file's `content` when a file is binary/Storage-backed (`FileDoc.content` would be undefined for such files per `lib/data/types.ts:177-181`) since `assembleWeb`/`bundleApp` only read the in-memory `content` field — an image or asset referenced via Storage rather than inline content would be missing from both the ZIP (`export.ts:23` uses `f.content ?? ""`, silently writing an empty file) and the published snapshot, with no warning to the user that assets didn't make it into the export.
5. There's no per-plan or rate limit specifically on publish/download visible in this code path (unlike code execution and AI builds, which are all metered) — publish, being a "free" (uncounted) action, has no visible abuse-prevention beyond the general Forge Code plan gate.
6. The published page has no build/versioning metadata (no "published at" timestamp, no way to see version history of what was published when) beyond whatever `project.published.at` may store — not exercised in the reviewed export code path itself.

**Fixes:**
1. Add an "Unpublish" action that clears `project.published` and marks/deletes the corresponding public row.
2. Add a one-time confirm dialog before the first publish of a project (or before every publish, at minimum for projects containing anything that looks like user-entered content vs. a template).
3. Show a progress indicator for ZIP generation on large projects, and/or stream the ZIP rather than fully buffering it.
4. Detect and warn when a project contains binary/Storage-backed files that won't be included in the export/publish, or extend export to fetch and embed those assets.
5. Add a basic per-day publish-count limit consistent with how other Forge Code actions are metered.
6. Show the last-published timestamp in the IDE topbar next to the Publish button.

---

## Chat / Artifact Code-Block Preview (`snippet.ts`)

**What's included:**
- Extension mapping from a fenced code block's language tag to a download filename — `lib/code/snippet.ts:6-60`.
- `isPreviewable`: whether a snippet should render as a live iframe preview (HTML/SVG by tag or by sniffing `<!doctype html`/`<html`/`<svg` in the content) — `lib/code/snippet.ts:63-67`.
- `isArtifactCode`: decides whether a code block renders as a Claude-style "artifact card" vs. inline code, with a one-way (never-reverts) growing threshold during streaming — `lib/code/snippet.ts:73-79`.
- `wrapPreviewDoc`: wraps a bare HTML fragment into a full document with the storage shim injected, reusing the exact same sandbox-safety mechanism as the Forge Code preview pane — `lib/code/snippet.ts:84-89`.

**Strengths:**
1. Reusing `injectStorageShim` here (`lib/code/snippet.ts:4,85,87`) means a plain chat-response HTML snippet gets the same opaque-origin-safe storage polyfill as a full Forge Code project — one consistent security/reliability mechanism, not two.
2. The "never flips back to inline" streaming rule for `isArtifactCode` (`lib/code/snippet.ts:69-72` doc comment) is a deliberate anti-flicker design: a code block that's grown past the inline threshold while streaming won't visually collapse back if a later chunk momentarily looks shorter relative to the running total.
3. The extension map covers a broad, sensible set of common languages with reasonable fallbacks (`json`/`jsonc` both `.json`, `yaml`/`yml` both `.yml`) — `lib/code/snippet.ts:6-50`.
4. `defaultFilename` special-cases HTML to `index.html` rather than a generic `snippet.html`, which matters for it to work as a proper previewable/downloadable page — `lib/code/snippet.ts:56-60`.

**Weaknesses:**
1. `isPreviewable`'s content-sniffing regex (`/<!doctype html|<html[\s>]|<svg[\s>]/i`, `lib/code/snippet.ts:66`) will also match these strings if they appear inside a *string literal* or comment in an otherwise non-HTML snippet (e.g. a JS file that contains a template string building an HTML page) — could misclassify a JS code block as "previewable HTML."
2. The inline-vs-artifact threshold (`code.split("\n").length >= 4`, `lib/code/snippet.ts:78`) is a flat 4-line cutoff regardless of language or content density — a genuinely tiny but semantically important 3-line function could stay inline while a 4-line trivial one/blank-line-padded snippet gets promoted to a full artifact card.
3. There's no shared test file for `snippet.ts` in the `tests/` directory (confirmed by directory listing) — unlike almost every other `lib/code/*` module, this one has zero unit-test coverage.

**Fixes:**
1. Require the sniffed HTML/SVG markers to appear at (or very near) the start of the trimmed content, not merely anywhere in the string, to reduce false-positive previewability.
2. Consider a slightly smarter heuristic (e.g. also require it not look like a single expression/JSON literal) rather than a flat line-count.
3. Add a small unit-test file covering `isPreviewable`/`isArtifactCode`/`langToExt`/`wrapPreviewDoc`.

---

## Agent Run Logging & Diagnostics (`agent-log.ts`)

**What's included:**
- `createAgentRunLog`: a per-build structured log with stage begin/end timing, retrieval summaries, iteration counting, and a final summary object attached to the persisted build-log message — `lib/code/agent-log.ts:77-137`.
- A fixed vocabulary of stage names spanning the whole pipeline (`analyze`, `retrieve`, `plan`, `plan-approval`, `execute`, `apply`, `rewrite`, `recover`, `review`, `fabrication-fix`, `consistency-fix`, `validate`, `verify-strict`, `fix`, `verify`, `heal`, `finalize`) — `lib/code/agent-log.ts:13-30`.
- Dev-only console trace summarizing the whole run as a single readable line — `lib/code/agent-log.ts:121-131`.

**Strengths:**
1. The stage vocabulary is intentionally broader than what currently executes (e.g. `plan-approval`, `verify-strict`, `rewrite`, `recover` are all defined even though some are only reachable via the dead strict-verifier branch) — the type is forward-compatible with re-enabling the fuller loop without a schema change.
2. `begin`/`record` cleanly separate "I'm starting a stage, tell me when it ends" from "here's a stage that's already fully known" (`lib/code/agent-log.ts:82-95`), matching the two different calling patterns actually used in `build-dock.tsx` (long-running phases vs. instantaneous logged facts).
3. Uses `performance.now()` when available, falling back to `Date.now()` (`lib/code/agent-log.ts:75`) — works identically in both browser and any non-browser test/SSR context.
4. The dev trace is a single compact line (`stage msTiming (detail) → stage msTiming (detail) → …`, `lib/code/agent-log.ts:123-127`) — genuinely readable at a glance in the browser console during development, not a verbose JSON dump.
5. Explicitly documented and verified (see Pipeline-orchestration strength #7 and Checkpoints strength #7) to record zero model output/code/provider details — safe to persist and display.

**Weaknesses:**
1. Several stage names in the vocabulary (`plan-approval`, `verify-strict`, `rewrite`, `recover`) are, per the confirmed dead-code findings above, either never emitted at all in the live path or only reachable via corrective-pass call sites that use different stage names (e.g. `fix`/`heal` are used for the *runtime* heal loop, not the strict-verify loop's `fix`) — the type's breadth currently slightly overstates what the running system actually logs.
2. There is no size cap on `stages` array growth (`lib/code/agent-log.ts:79`) — a pathological build with many corrective iterations near the `maxCorrectivePasses` ceiling accumulates an unbounded number of stage records that all get persisted into the build-log message's `agentRun` JSON field with no truncation.
3. `console.info`'s dev-trace log (`lib/code/agent-log.ts:126-128`) is gated only on `NODE_ENV !== "production"`, not on any user-facing debug toggle — every developer running the app locally always sees this on every build, with no way to opt out short of an env var.
4. The `finish` function's outcome string is a loosely-typed free-form string (`outcome: string`, not a union) constructed ad hoc at each call site in `build-dock.tsx` (e.g. `"no-op (generation cut off by time limit)"`, `"no-op (file blocks did not persist)"`) — no compile-time guarantee these strings stay consistent as the surrounding logic evolves, and the `AgentRunTrace` UI's label logic (`components/code/build-dock.tsx:432-437`) pattern-matches on prefixes (`outcome.startsWith("no-op")`) rather than a typed enum.

**Fixes:**
1. Either trim the stage vocabulary to what's actually reachable, or keep it as documented "reserved for the full loop" with a comment explaining the gap.
2. Cap `stages` at a reasonable length (e.g. last 50) before persisting, with an "earlier stages truncated" marker if exceeded.
3. Gate the dev console trace behind an explicit debug flag in addition to `NODE_ENV`.
4. Convert `outcome` to a proper string-literal union type shared between the log module and the UI's label-matching logic.

---

# Pipeline flow (verbatim)

This section traces exactly what happens, call by call, when a user submits a Build-mode request in the Forge Code Build Dock — as the code is actually wired today, not as the module comments describe the intended design. All line numbers reference `components/code/build-dock.tsx` unless otherwise noted.

## 0. Entry point

`send()` (`build-dock.tsx:592`) fires on Enter/click. Guards: non-empty draft, not already streaming, user + project present (`:593`). The user's message is persisted immediately (`addBuildMessage`, `:601`) and the streaming UI state is initialized with `phase: "analyzing"` for Build mode (`:602-607`).

## 1. Analyze (client-only, no LLM call)

- Fetches a fresh Firebase ID token (`:609`); aborts with an "session expired" error bubble if missing (`:610-613`).
- Fetches the *actual current* project files from the server (`getProjectFilesOnce`, `:623`, falling back to the stale `files` prop on error) — this, not the possibly-stale React prop, becomes `beforeMap`/`freshFiles`, the ground truth for the whole run.
- Computes `impliedChecks`/`impliedRequirements` from the raw request text via keyword regexes (`impliedChecksForBuildRequest`, `:625-626`) — purely client-side pattern matching, no model call.
- Resolves the effort-tuning profile (`forgeCodeEffortProfile(settings.effort)`, `:630`) — this one object parameterizes every budget/timeout/depth knob used for the rest of the run.
- Opens the structured `AgentRunLog` and records the `"analyze"` stage with a file count (`:631-637`).

## 2. Retrieve (client-only, no LLM call)

- `makeContext(freshFiles)` (`:643-654`) is warmed once here (phase set to `"retrieving"`, `:728`) purely to populate the dev/agent-run log with the ranked-file summary (`log.retrieval`, `:649-652`) — the actual context string built here is thrown away; every real LLM call below calls `makeContext` again itself.
- `buildRetrievalContext` (`lib/code/retrieval.ts:274`) ranks every project file against the raw request text and returns: the full file tree (always), full contents of the highest-ranked files up to `retrievalBudgetBytes`/`retrievalMaxFullFiles` (both effort-scaled), and compact signatures for the rest.

## 3. Plan (one LLM call — mode `code-plan` — only if `effortProfile.planning` is true, which it is for every effort level)

- Phase set to `"planning"` (`:737`).
- A **separate** AbortController is created, tied to the build's own abort signal, and a hard timeout (`effortProfile.planTimeoutMs`, 15s→35s across effort) is armed (`:743-746`) — this call can never hang the build past that ceiling.
- `streamChat` is invoked with `[...history, {role:"user", content: text}]`, the just-fetched `freshFiles` (for `makeContext`), `effort: "low"` (fixed, regardless of the user's actual selected effort), `thinking: false`, `mode: "code-plan"` (`:751-757`).
- Server-side (`app/api/chat/route.ts`), this assembles the system prompt via `assembleSystemPrompt` with `mode: "code-plan"` → injects `BUILD_MODE_ADDENDUM`? **No** — for `code-plan` it injects `BUILD_PLAN_ADDENDUM` instead (`lib/ai/prompts.ts:412`), plus `WEB_CRAFT_DIRECTIVE` is **not** added for `code-plan` (only `code-build`/`code-discuss`, `lib/ai/prompts.ts:416-417`), plus the fixed `EFFORT_DIRECTIVE["low"]`, model persona, Current-Forge-State block, active skills (if any — same `skills`/`skillCatalog` array is sent for every internal call regardless of whether the phase logically needs it), skill/agent management blocks, and today's date.
- The prompt (`BUILD_PLAN_ADDENDUM`, `lib/ai/prompts.ts:127-145`) instructs the model to emit **only** one ` ```forge-plan ` JSON fence containing `summary`, `steps[]`, `checklist[]` (typed acceptance criteria: `file_exists`/`contains`/`contains_any`/`absent_everywhere`/`page_count`/`dom_has`/`smoke`), and `assumptions[]`, and explicitly **not** to write file blocks this turn.
- Output token ceiling for this call is still the fixed `FORGE_CODE_MAX_OUTPUT_TOKENS` (384,000) since `mode` is a Forge-Code mode (`app/api/chat/route.ts:211`, `lib/code/forge-code-config.ts:23,26-37`) — effort only changed the *reasoning* depth via `EFFORT_DIRECTIVE`/`reasoning_effort`, never the output ceiling.
- Client-side, the streamed content is shown live in a collapsible `PlanningPanel` (`:747-750`, rendered `:1467-1468`).
- On completion, `parseBuildPlan` extracts the JSON (`:759`); on parse failure **or** timeout **or** any error, `plan` stays `null` and the run proceeds with no plan at all — the verify/heal loop is treated as "the real safety net" per the code comment (`:740-742`), which itself is only partially true given the findings below.
- If a plan parsed, the client-computed `impliedChecks` are appended onto `plan.checklist` (`:760-762`).
- **Autonomy gate**: if `profile.buildAutonomy` is `"plan"` or `"step"` (not the default `"auto"`), the plan is shown in a `BuildPlanCard` and the whole pipeline blocks on a `Promise` resolved only by the user clicking Approve/Cancel (`:777-789`) — cancel aborts the entire run with no further calls made.

## 4. Execute — the main generation pass (one LLM call — mode `code-build`)

- `executionText` is assembled as: the plan restated as an instruction block (`planToContext`, if a plan exists) + the implied-checks-as-prompt block (`impliedChecksToPrompt`) + either "Now implement the entire plan... Original request: `<text>`" (if a plan exists) or the raw `text` (`:794-800`).
- `streamChat` is called with `[...history, {role:"user", content: executionText}]`, the model = **always `magnum-2.8`** regardless of the user's selected chat model (`modelForBuildExecution(settings.model, "build")` → `RELIABLE_BUILD_MODEL`, `lib/code/build-integrity.ts:12,17-22`), the user's actual selected `effort`/`thinking`, `mode: "code-build"` (`:809-813`).
- Server-side, `mode: "code-build"` injects `BUILD_MODE_ADDENDUM` (the full write/edit-block protocol, honesty/large-data rules, interactive-game system-state requirements) **plus** `WEB_CRAFT_DIRECTIVE` (the "elite web craft" design-quality bar) — `lib/ai/prompts.ts:410,416-417`.
- Output is streamed live; the UI throttles re-renders to ~10/sec (`throttleTrailing`, `:804-808`) and parses the accumulating text through `parseBuildStream` purely for the live file-status panel (`:576-587`) — the model's actual prose narration is computed (`parsed.prose`) but **never rendered** (`showBuildProse = false`, `:590`).
- If `mode !== "build"` (Discuss mode), the pipeline stops here entirely: the raw content is persisted as the assistant message with no file-parsing, no verification, no checklist — Discuss mode never writes files (`:817-826`).

## 5. Resolve the main pass's output (client-only)

- `parseBuildStream(mainContent)` extracts every ` ```path=<path> ` / ` ```edit=<path> ` block plus the narration (`:829`).
- `resolveBuildOps` (`lib/code/build-stream.ts:195`) resolves each block against `beforeMap`, **cumulatively** (a later block for the same path builds on an earlier ok block's result) — this becomes `mainOps`.
- `truncatedPaths`/`hadTruncatedWrite` flags any block whose closing fence never arrived (generation time-limit cutoff) (`:834-835`).
- `claimedChange = claimsBuildChange(mainProse)` — regex scan for change-claiming verbs in the (never-shown) narration (`:836`).

## 6. Apply (client-only writes, server-authenticated)

- If `mainOps.length`: phase → `"applying"` (`:946`); the **first** checkpoint of the run is created here (`ensureCheckpoint`, snapshotting `freshFiles` as they were *before* this build, `:870-875,947`).
- Ops are filtered through `path-safety.ts`'s `checkWritePath` (rejecting absolute/traversal/junk paths, logged not written, `:859-868`), reduced to only those that are `ok` and have a real content change (`applicableResolvedOps`), then collapsed to one write per path (`lastOpPerPath`) — this is the actual write set (`:958`).
- `writeFilesByPath` performs one read + one batched insert/update call to `/api/data/files/bulk` (`lib/data/files.ts:182-269`); `current` is refreshed from a fresh server read afterward (`:961`).
- `persistedAppliedOps` cross-checks that what's now actually stored matches what was attempted (`lib/code/build-apply.ts:53-64`) — `touchedPaths` (the real changed-path set, driving every later diff/verify/finalize step) is derived only from paths with a genuinely visible before/after difference (`refreshTouchedPaths`, `:842-843`).
- **Failed-op recovery**: any op not `ok` (failed edit-hunk match, or refused truncated/destructive write) triggers `runCorrective` with a truncation-aware prompt — files ≥250 existing lines get a "small edit hunks only" instruction; smaller/new files get a "full re-emit" instruction (`buildFailedOpsRecoveryPrompt`, `lib/code/build-integrity.ts:83-111`, `:981-997`). This is a **second LLM call** (mode unset → defaults server-side to whatever `code-build`/`code-discuss` mapping applies via `opts?.mode`, but since `streamChat`'s default is `dockMode === "build" ? "code-build" : "code-discuss"` and this is invoked from within Build mode, it is another `code-build`-mode call), `effort: "low"`, `thinking: false`, capped at 150 seconds (`:899`).
- **No-file-ops recovery**: if the model claimed a change but zero paths actually changed, and recovery wasn't already attempted, another corrective call is fired with `buildNoAppliedDiffFixPrompt` (`:999-1004` inside the `mainOps.length` branch, and identically again at `:1010-1014` for the `mainOps.length === 0` case).

## 7. Universal content backstops (client-only detection, corrective LLM calls only if triggered)

- **Fabrication backstop**: `detectFabricatedData(mainProse, codeOf(current))` (`lib/code/fabrication.ts:46`) scans for placeholder markers or a large claimed-count with insufficient actual tokens and no runtime fetch; if triggered, one corrective call with `BUILD_FETCH_DATA_FIX` (`:1016-1022`).
- **Rename-consistency backstop**: `extractRenames(text)` pulls candidate old-terms from rename-shaped phrasing; `staleTermFiles` checks every current file for leftovers; if any, one corrective call with `BUILD_CONSISTENCY_FIX` plus the specific leftover locations (`:1024-1033`).

## 8. Verification — what actually runs today

This is the step where the implemented design and the live behavior diverge most sharply.

- `checklist = plan?.checklist ?? impliedChecks` is computed (`:1046`) and `verifyMode`/`canRuntime` are derived from the project's effective preview kind (`:1044-1045`) — **runtime verification only ever runs for `web`/`react`/`vue` preview kinds; any other project type (Python, Blank, or an undetected kind) skips this entire section.**
- **If `canRuntime`**: phase → `"validating"` (`:1052`). `runVerification(codeFiles(), verifyMode, [])` is called **with a hardcoded empty checklist array**, not the `checklist` computed one line above (`:1055`). This runs, in order: broken-local-reference scan, compile check (esbuild transform for plain web, full bundle for React/Vue), and — only if it compiled — a hidden-iframe runtime probe capturing console/window errors (`lib/code/verify/index.ts:29-74`).
- If that reports issues, an **auto-heal loop** runs (bounded by `effortProfile.verifyHeals`, 1–3 across effort, and the token budget): each iteration fires one corrective call with `BUILD_VERIFY_FIX` plus the formatted issue list, then re-runs `runVerification(..., [])` again (still empty checklist) to check progress; stops immediately if a fix pass applies nothing (`:1064-1079`).
- `verifyNote` is set from this runtime-only outcome only — a "verified/fixed N runtime errors" message, a "found N issues I couldn't auto-fix" message, or a "runtime check could not run" message (`:1081-1099`).
- **The strict, adversarial LLM Verifier/Fixer self-correction loop is entirely dead code**: `const shouldRunStrictRequestReview = false;` (`:1049`) gates the entire block at `:1151-1285`. Inside that unreachable block: `runVerifier` would make a **third distinct LLM call type** (mode `code-verify`, server-side injecting `CODE_VERIFIER_ADDENDUM` — an adversarial reviewer prompt that assumes the implementation is wrong until proven otherwise, fed the original request, the plan, unified diffs of every changed file via `buildDiffs`/`formatDiffsForPrompt`, and the runtime findings — and returning a `forge-verdict` JSON verdict), and on `"fail"` a **fourth call type** (the Fixer — same `code-build` mode server-side, but client-side prefixed with `CODE_FIXER_ADDENDUM`, fed the verdict's issues + diffs + the original request, instructed to make surgical `edit=` fixes only) — cycling up to `effortProfile.selfCorrectIterations` (2–4) times with convergence guards (stop after 2 stagnant passes, a 240-second wall-clock budget, or the token budget). **None of this executes in production.** The `checklist` computed at `:1046` (the plan's own acceptance criteria plus all implied-checks, including the game-verification smoke tests) is only ever consumed inside this dead branch (`:1172`) — it is never mechanically evaluated against the built project despite the Plan-approval UI explicitly telling the user "N acceptance checks will confirm it's done and works" (`:412-416`) and the implied-checks prompt telling the model "the verifier will enforce these checks after you write files" (`lib/code/implied-checks.ts:164-165`).
- `reviewDone` is set `true` whenever the runtime-only validate step ran at all (`:1057`), regardless of whether it found or fixed anything — this flag alone drives the "_✓ Reviewed for completeness._" note appended to the final message (`lib/code/build-integrity.ts:61`, consumed at `:1318,1321`), so the user-visible "reviewed" claim is honest only in the narrow sense of "a compile/console-error check ran," not in the sense of "an adversarial review of whether the request was actually satisfied" ran.

## 9. Finalize (client-only)

- Phase → `"finalizing"` (`:1288`).
- `changes` = the final applied-diff set (`buildAppliedChanges(touchedPaths, beforeMap, finalMap)`, `:1291`).
- If any changes landed: `touchProject` bumps the project's file count/updated-at, `previewMode` is auto-detected and persisted if it was previously `"none"`, and a toast confirms N files updated (`:1293-1300`).
- The final assistant message text is chosen by a priority cascade (`:1305-1323`): (a) claimed-change-but-nothing-persisted → an honest truncation or no-op message; (b) fabrication backstop fired → describes the runtime-fetch fix (or its failure); (c) real changes landed → `summarizeAppliedBuild` plus the `verifyNote` from step 8; (d) otherwise → the raw (still never-shown-live) `mainProse` plus a "reviewed" note if applicable.
- The structured `AgentRunSummary` (every stage, timing, files touched, iteration count, and an outcome string) is attached to the persisted message and rendered as a collapsible `AgentRunTrace` (`:1324-1343`).

## Summary: single-shot vs. iterative, today

- **Always exactly one LLM call**: the main Execute pass (step 4) — this is the only call guaranteed to happen for every build.
- **Conditionally one LLM call each** (fire only if triggered): Plan (step 3, on by default for every effort level but skippable on timeout/parse-failure), failed-op recovery, no-file-ops recovery, fabrication fix, rename-consistency fix (step 6–7).
- **Iteratively 0–3 LLM calls**: the runtime-only auto-heal loop (step 8), bounded by `effortProfile.verifyHeals` — this is the *only* corrective loop that actually iterates in production.
- **Never executes at all today, despite being fully implemented, prompted, and unit-tested in isolation**: the strict Verifier (`code-verify` mode / `CODE_VERIFIER_ADDENDUM`), the diff-aware Fixer (`CODE_FIXER_ADDENDUM`), and the whole multi-cycle self-correction loop with its convergence/budget guards — all gated behind the single hardcoded `const shouldRunStrictRequestReview = false;` at `components/code/build-dock.tsx:1049`.
- **Computed but discarded**: the plan's acceptance `checklist` (including auto-injected implied game-verification checks) — built at `:1046`, shown to the user as a promise in the Plan card, referenced in the log detail string, but passed as `[]` to the one `runVerification` call that actually executes (`:1055`), and only ever passed for real inside the dead branch (`:1172`).
- **Never shown live**: the model's own narration text during the Execute pass (`showBuildProse = false`, `:590`) — the user sees only the live per-file write/edit status rows and stage chips during streaming; all prose the user eventually sees is synthesized by the client (`summarizeAppliedBuild` / recovery / fabrication / truncation messages), not the model's own words.
- **Provider secrecy**: verified intact throughout the entire pipeline — every server-only file that knows the real model string (`deepseek-v4-flash`/`deepseek-v4-pro`) or the E2B/Gemini/SiliconFlow provider identities is marked `"server-only"` (`lib/ai/models.ts:10`, `lib/code/runner.ts:1`), every client-visible error path returns a generic, provider-free message (`app/api/chat/route.ts:60-73` `friendlyError`, `lib/code/runner.ts:115-121`), and a full-text search of every client component in scope (`components/code/**`) found zero occurrences of `deepseek`/`gemini`/`siliconflow`/`e2b`/`openai` in any form. No leak found.
