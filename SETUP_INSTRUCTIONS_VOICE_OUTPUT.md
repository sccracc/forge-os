# Voice Output Setup (OpenAI Text-to-Speech)

Forge OS can read AI responses aloud. Hover a completed AI message and click the
**speaker icon** — the response is spoken back using **OpenAI's `tts-1`** model
(voice: `alloy`). The OpenAI key is used **only** for this text-to-speech
feature — never for AI chat or completions — and lives only on the server.

No plan gating yet — every authenticated user can use voice output.

---

## 1–2. Create / sign in to an OpenAI account

Go to **[platform.openai.com](https://platform.openai.com)** and create an
account (or log in to an existing one).

## 3. Add a payment method

TTS is a paid API. Open **Settings → Billing → Payment methods** and add a card.

## 4. Add credit

Add about **$10** of pay-as-you-go credit (**Billing → Add to credit balance**).
That covers a very large amount of speech — see the cost note below.

## 5. Create an API key

Go to **API Keys → Create new secret key**. Name it (e.g. `forge-os-tts`).

## 6. Copy the key

Copy it **now** — OpenAI shows the secret key only once. It looks like `sk-...`.

## 7. Add `OPENAI_API_KEY` to Vercel

In your Vercel project: **Settings → Environment Variables**. Add:

| Name             | Value           | Environments                     |
| ---------------- | --------------- | -------------------------------- |
| `OPENAI_API_KEY` | `sk-…your key…` | Production, Preview, Development |

> **Server-only.** Do **not** prefix it with `NEXT_PUBLIC_`. It is read only in
> `app/api/voice/speak/route.ts`.

## 8. Add `OPENAI_API_KEY` to `.env.local`

For local development add the same line to `.env.local`:

```bash
OPENAI_API_KEY=sk-your_key_here
```

(See `.env.local.example` for the placeholder.)

## 9. Redeploy on Vercel

Environment variables only take effect on a new deployment. Trigger a redeploy
(push a commit, or **Deployments → ⋯ → Redeploy**). Restart `npm run dev`
locally so the new value is picked up.

## 10. How to test

1. Open a chat and send a message so the AI replies.
2. Once the response is **fully finished**, hover over it.
3. Click the **speaker icon** in the actions row (next to Copy).
4. A brief spinner shows while the audio is generated (1–3 s), then you'll
   **hear the message read aloud**. The icon turns into an amber, gently pulsing
   **stop** button — click it to stop early. Starting playback on another
   message automatically stops the current one.

If `OPENAI_API_KEY` is missing you'll get a *"Voice playback failed"* toast —
add the key and redeploy.

## 11. Files created or modified

**Created**

- `app/api/voice/speak/route.ts` — POST route: verifies the Firebase ID token,
  bounds the text to 4096 chars, proxies it to OpenAI TTS, and streams the MP3
  back as `audio/mpeg`.
- `hooks/use-tts.ts` — client playback hook: fetch → Blob → `Audio` → play/stop,
  with a module-level singleton so only one message plays at a time.
- `SETUP_INSTRUCTIONS_VOICE_OUTPUT.md` — this file.

**Modified**

- `components/chat/message.tsx` — speaker button in the AI message actions row
  (idle speaker / loading spinner / amber pulsing stop), shown only on completed
  non-empty AI messages.
- `app/globals.css` — speaker button styles (`.tts-action.playing`,
  `.tts-spinner`) and a `.msg-actions.tts-active` rule that keeps the actions row
  visible while audio is playing (playback outlives hover).
- `.env.local.example` — added the `OPENAI_API_KEY` placeholder.

## 12. Cost

OpenAI `tts-1` is **$0.015 per 1,000 characters**. A typical 500-character reply
costs about **$0.0075** (three-quarters of a cent). $10 of credit is roughly
**650,000 characters** of speech. Messages are capped at 4,096 characters per
request.

## 13. Common errors

- **No audio plays** — the browser blocked autoplay. Playback is triggered by
  your click, which normally satisfies autoplay policies, but if the tab is
  muted or the OS volume is down you'll hear nothing. Check the tab isn't muted
  and the system volume is up. (A *"Voice playback failed"* toast means the
  `Audio` element itself errored.)
- **401 from OpenAI** — the `OPENAI_API_KEY` is invalid, revoked, or mistyped.
  Recreate it on platform.openai.com and update Vercel + `.env.local`, then
  redeploy.
- **Slow to start** — TTS generation takes ~1–3 seconds before audio begins;
  the spinner is shown during this time. Longer messages take a little longer.
- **"Voice output is not configured."** — `OPENAI_API_KEY` isn't set in that
  environment. Add it and redeploy.
- **"Voice generation failed."** — OpenAI returned an error (e.g. no billing /
  out of credit, or rate-limited). Confirm billing is active and you have credit.
