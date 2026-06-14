# Forge OS

A premium, production-grade AI workspace. Two modes share one account, one file
system, and one design language:

- **Forge Chat** — a polished conversational assistant (chat, artifacts, files, projects, memory, skills).
- **Forge Code** — an AI coding workspace (project gallery, file manager + IDE, live preview, build dock).

Built with Next.js 16 (App Router), TypeScript, Tailwind v4, Firebase, and a
custom streaming AI layer. Theme: **Molten** — warm, amber-accented, light + dark.

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Create a Firebase project** (Auth + Firestore + Storage).
   - Enable **Google** as a sign-in provider in Authentication.
   - Create a Firestore database and a Storage bucket.
   - Create a service account (Project settings → Service accounts) for the Admin SDK.

3. **Configure environment** — copy `.env.local.example` to `.env.local` and fill
   in the Firebase web config, the Firebase Admin credentials, and your AI
   provider key (`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`). On Vercel, set the
   same variables in the project settings.
   - For production mobile sign-in, set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to
     the domain that serves Forge OS, for example `ai-forge-os.vercel.app`.
     The app proxies `/__/auth/*` back to Firebase so mobile browsers do not
     lose sign-in state in a storage-partitioned helper domain.
   - In Firebase Authentication settings, add your production domain to
     authorized domains and add
     `https://<your-domain>/__/auth/handler` as an authorized OAuth redirect URI
     for the Google provider.

4. **Deploy security rules**
   ```bash
   npx firebase deploy --only firestore:rules,storage:rules
   ```

5. **Run**
   ```bash
   npm run dev      # http://localhost:3000
   ```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm test` | Vitest unit tests |

## Deploy

Deploy to Vercel. Set all environment variables from `.env.local.example` in the
Vercel project. The app is deployable the moment the variables are configured.

## Notes

- The AI models surface as **Spark 2.5** and **Magnum 2.8**. Provider details are
  server-only and never reach the browser.
- Security rules scope every document and file to its owning user (`users/{uid}/…`).
- See `CLAUDE.md` for architecture and build-phase status.
