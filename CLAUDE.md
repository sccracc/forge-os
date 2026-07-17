# Forge OS — build notes for Claude

Forge OS is a premium, production-grade AI workspace with two modes sharing one
account, one file system, one design language:

- **Forge Chat** — Claude.ai-style conversational assistant.
- **Forge Code** — Base44/Lovable-style AI coding workspace (gallery + IDE + preview + build dock).

## Non-negotiable invariants

1. **Provider secrecy.** The underlying provider must NEVER be named or implied in
   anything client-visible (UI, prompts, errors, network payloads, logs, model
   metadata). Users only ever see **Spark 2.5** and **Magnum 2.8**.
   - The ONLY file that knows real provider model strings is
     `lib/ai/models.ts` — server-only.
   - Client code imports `lib/ai/models.public.ts` (no provider info).
   - `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` are read only in server handlers.
2. **No placeholder/demo/fake data.** Every screen is real functionality with
   polished empty states. No seeded chats/projects/files. Deployable the moment
   env vars are set.
3. **Build in the spec's phase order (§17).** Each phase ships fully working and
   visually finished in BOTH themes before the next.

## Stack

Next.js 16 (App Router, RSC) · TypeScript strict · Tailwind v4 (CSS-first) ·
**Supabase Auth (Google OAuth, PKCE redirect — replaced Firebase popup auth,
which broke on storage-partitioned mobile browsers)** · Firebase retained only
as a legacy binary-blob Storage fallback · **Supabase/Postgres is
the primary data store** (conversations, messages, projects, files, skills,
agents, checkpoints, usage, billing — all via server-only service-role routes
under `app/api/data/**`; `supabase/schema.sql`) · AI SDK v6 deps present, but
the core chat path uses a custom server-only streaming client
(`lib/ai/provider.ts`) for full control over thinking, continuation, and
reasoning replay · Framer Motion · Zustand + TanStack Query · Shiki ·
react-markdown + KaTeX · Vitest.

> Design-system note: the spec calls for restyled shadcn/ui. We ship a bespoke
> Molten component set (menus, switches, modals, toasts, command palette) instead
> — fewer deps, exact visual control. Accessibility primitives get hardened in
> Phase 7. `// FORGE-NOTE` markers flag other intentional deviations.

## Conventions

- Molten design system lives in `app/globals.css` (tokens for both themes via
  `[data-theme]`, atmosphere, all component classes). Theme is cookie-driven with
  a pre-paint inline script (no flash); default LIGHT.
- Data model: Supabase/Postgres rows scoped by `user_id` on every table; the
  client never talks to Supabase directly (all access via `requireUser`-gated
  `/api/data/*` routes with the service-role key). Messages form a tree
  (`parent_id`) so branching needs no migration. See `lib/data/` +
  `lib/supabase/`. `firestore.rules` is legacy (Firestore itself is unused);
  `storage.rules` is still live for Firebase Storage blobs.
- Client engine: composer settings (`lib/store/composer-store.ts`), streaming
  state that survives navigation (`lib/store/stream-store.ts`), and the
  send/stop/regenerate controller (`hooks/use-chat-send.ts`).
- Run `npm run typecheck`, `npm run build`, and `npm test` before declaring a
  phase done. Visually QA both themes (a temporary unguarded `/preview` route is
  the pattern for screenshotting UI without real Firebase creds — remove after).

## Phase status

- **Phase 1 — Foundation & Chat: COMPLETE.** Molten + theming, Supabase Google
  auth + gate (legacy uids resolved by verified email in `verifyRequest`),
  shell (sidebar, mode-switcher scaffold, command palette, shortcuts),
  streaming chat (both models, thinking, 5 efforts, continuation loop, sampling),
  composer + §5.7 menu, persistence, branching/edit/regenerate, settings, tests.
- Phases 2–7: file system, Forge Code IDE, artifacts/docgen/exec, projects/memory,
  tools/skills/agents, export/polish. See the master spec.

## Env

Copy `.env.local.example`. Security rules: `firestore.rules`, `storage.rules`.
