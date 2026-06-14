# Supabase setup — Forge OS

Structured data (conversations, messages, users, projects, file metadata, skills,
agents, memory, settings, usage) now lives in **Supabase Postgres**. Firebase
**Auth** (Google login) and Firebase **Storage** (file blobs) are unchanged.

Do these steps **in order**. You only need to do steps 1–4 once.

---

## 1. Create a Supabase account and project

1. Go to <https://supabase.com> and sign up / log in.
2. Click **New project**. Pick your org, a **name** (e.g. `forge-os`), and a
   strong **database password** (save it; you won't need it for this app, but
   Supabase requires one).
3. Choose the region closest to your users and click **Create new project**.
4. Wait ~1–2 minutes for it to finish provisioning.

---

## 2. Run the schema

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file [`supabase/schema.sql`](supabase/schema.sql) from this repo,
   **copy its entire contents**, and paste into the editor.
3. Click **Run** (or press Ctrl/Cmd+Enter).
4. You should see **Success. No rows returned**.

> **Important:** run the **whole file**. It has two parts — *Section 1* (the base
> tables + the `deduct_forge_tokens` function) and *Section 2* ("Forge OS
> additions": extra columns and the `agents`, `checkpoints`, `build_log`,
> `file_chunks`, and `published` tables). If you run only Section 1, the app will
> error with *"column … does not exist"* and Forge Code / publishing will break.
> The script is idempotent (`if not exists` everywhere), so it's safe to re-run.

To verify: open **Table Editor** — you should see `users`, `user_settings`,
`usage`, `conversations`, `messages`, `projects`, `files`, `skills`, `memory`,
`agents`, `checkpoints`, `build_log`, `file_chunks`, and `published`.

---

## 3. Get the three environment variable values

In your Supabase project, go to **Project Settings → API Keys** (and
**Project Settings → API** for the URL):

| Env var | Where to find it | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → **Project URL** (e.g. `https://abcd1234.supabase.co`) | Yes (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API Keys → **anon** / **public** key (newer dashboards call it the **publishable** key) | Yes (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API Keys → **service_role** key (newer dashboards: **secret** key). Click *Reveal* | **NO — server only, full DB access** |

> Treat `SUPABASE_SERVICE_ROLE_KEY` like a password. It bypasses Row Level
> Security. It is only read in server code and must never be committed or shipped
> to the client.

---

## 4. Add the variables to your environment

### Local development (`.env.local`)
Add these three lines to `.env.local` in the project root (keep all your existing
Firebase / DeepSeek vars — **do not remove any of them**). See
[`.env.local.example`](.env.local.example) for the full template.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Then **restart** the dev server (`npm run dev`) so the new env vars load.

### Vercel (production / preview)
**Project → Settings → Environment Variables**, add the same three (select all
environments — Production, Preview, Development):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Then **redeploy** (env var changes don't apply to existing deployments).

Or with the Vercel CLI:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

---

## 5. Test that it works

1. Start the app (`npm run dev`) and **sign in with Google**.
2. In Supabase → **Table Editor**:
   - `users` has a row whose `id` is your Firebase UID, with your email/name.
   - `user_settings` and `usage` each have a matching row (created on sign-in).
3. **Send a chat message.** Refresh `conversations` → a row appears; `messages`
   → your message + the assistant reply. The sidebar list should update within a
   moment (live within the same tab, and on a ~10s poll across devices).
4. **Forge Code:** create a project → `projects` gets a row and `files` gets the
   scaffolded files. Edit/rename/delete files and watch `files` update.
5. **Skills/Agents:** the built-in skills seed into `skills` on first load;
   create a skill/agent and confirm rows appear.
6. **Publish** a web project → a `published` row appears and the `/p/{id}` link
   opens the published page (works signed-out, in a private window).
7. **Usage:** after a few chats, the `usage` row's token counters increment.

Sanity checks before all this: `npm run typecheck`, `npm run build`, `npm test`
should all pass (they do in this repo).

---

## 6. Files changed in this migration

### New — Supabase plumbing (`lib/supabase/`)
- `client.ts` — public anon client (created per brief; app data does **not** use it).
- `server.ts` — server-only **service-role** admin client + `supabaseConfigured`.
- `mappers.ts` — camelCase↔snake_case row mappers; epoch-ms ↔ `timestamptz`.
- `route-helpers.ts` — `requireUser` (verifies Firebase token), JSON/error helpers.
- `profile-server.ts` — `loadProfile` (merges `users`+`user_settings`), `ensureUserRows`.
- `usage.ts` — `deductForgeTokens` / `recordChatUsage` (wraps the `deduct_forge_tokens` RPC).

### New — client data plumbing (`lib/data/`)
- `authed-fetch.ts` — fetch wrapper that attaches the current Firebase ID token.
- `realtime.ts` — event-bus + polling subscription that replaces Firestore `onSnapshot`.

### New — API routes (`app/api/`) — all verify the Firebase token, then use the service-role client
- `auth/sync-user` — upserts `users`/`user_settings`/`usage` on login (STEP 3).
- `data/profile` — GET/PATCH the merged profile.
- `data/conversations` (+ `/[id]`, `/[id]/messages`) and `data/messages/[id]`.
- `data/projects` (+ `/[id]`, `/[id]/files`).
- `data/files` (+ `/[id]`, `/bulk`, `/chunks`).
- `data/skills` (+ `/[id]`), `data/agents` (+ `/[id]`).
- `data/checkpoints` (+ `/[id]`), `data/build-log` (+ `/[id]`).
- `data/export` — assembles a full data export. `data/publish` — publishes a snapshot.
- `published/[id]` — **public** read for `/p/[id]` (no auth).

### New — other
- `supabase/schema.sql` — the database schema (base + Forge OS additions).

### Modified — data modules (same exported functions/signatures; bodies now call the API)
- `lib/data/{profile,chat,skills,projects,files,agents,checkpoints,build-chat}.ts`
- `lib/export.ts` (exports via `/api/data/export`), `lib/code/export.ts` (publish via `/api/data/publish`)
- `lib/files/filestore.ts` — **Firebase Storage path unchanged**; only the blob
  fallback moved from Firestore chunks → Supabase `file_chunks`.
- `app/p/[id]/page.tsx` — reads the public `/api/published/[id]` route.

### Modified — server consumers
- `app/api/memory/route.ts` — reads/writes memory via Supabase.
- `lib/ai/context-server.ts` — loads agent/profile/project prompt context via Supabase.
- `app/api/chat/route.ts` — records token usage (best-effort) after each generation.

### Modified — config (Firestore removed; **Auth + Storage untouched**)
- `lib/firebase/client.ts` — removed `getDb()` + `firebase/firestore` import.
- `lib/firebase/admin.ts` — removed `getAdminDb()` + `firebase-admin/firestore` import.
- `package.json` — added `@supabase/supabase-js`.
- `.env.local.example` — added the three Supabase variable names.

> `firestore.rules` is left in the repo but is now unused (data is no longer in
> Firestore). You can delete it later if you like. `storage.rules` is still in
> use by Firebase Storage — keep it.

---

## 7. Common errors and fixes

**`Supabase is not configured` (HTTP 503) on every data request**
The three env vars aren't loaded. Check spelling, that they're in `.env.local`
(local) or Vercel (deployed), and that you **restarted/redeployed** after adding
them.

**`column "…" does not exist` or `relation "agents"/"checkpoints"/… does not exist`**
You ran only part of `schema.sql`. Re-run the **entire** file (it's idempotent),
making sure Section 2 ("Forge OS additions") executed.

**`401 unauthorized` on data routes**
The Firebase ID token wasn't accepted. Make sure you're signed in, and that the
Firebase **Admin** env vars (`FIREBASE_ADMIN_*`) are set — the server uses them to
verify the token. (These are separate from the Supabase keys.)

**Reads come back empty / `new row violates row-level security policy`**
Every table has RLS **enabled with no policies on purpose** — the anon key can't
touch app data; everything goes through the server using the **service-role** key.
Make sure `SUPABASE_SERVICE_ROLE_KEY` is set on the server and you haven't added
client-side queries with the anon client.

**`insert or update on table "messages" violates foreign key constraint` (user_id)**
The `users` row must exist first. It's created automatically on sign-in via
`/api/auth/sync-user`; if you hit this, finish signing in (so the sync runs)
before writing other data.

**Published page `/p/{id}` shows "doesn't exist"**
Either the project wasn't published, or Supabase isn't configured (the public
route returns 503/404). Publish again after confirming env vars.

**Re-running `schema.sql` — is it safe?**
Yes. It uses `create table if not exists` and `add column if not exists`
throughout, so running it multiple times won't error or drop data.

**Did this change Google login or file uploads?**
No. Firebase Auth and Firebase Storage are untouched. If login or uploads break,
it's a Firebase config issue, not Supabase.
