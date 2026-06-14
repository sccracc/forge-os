# Voice Input Setup (Groq Whisper)

Forge OS turns speech into text right in the composer. Click the mic, speak,
click again — your words appear in the message box. Transcription runs on
**Groq's `whisper-large-v3`** model (fast, accurate). The Groq key lives only on
the server; it is never sent to the browser.

No plan gating yet — every authenticated user can use voice input.

---

## 1. Create a Groq account

Go to **[console.groq.com](https://console.groq.com)** and sign up (or log in).

## 2. Create an API key

In the console, open **API Keys → Create API Key**. Give it a name
(e.g. `forge-os-voice`).

## 3. Copy the key

Copy the key **immediately** — Groq shows the full value only once. It looks
like `gsk_...`.

## 4. Add `GROQ_API_KEY` to Vercel

In your Vercel project: **Settings → Environment Variables**. Add:

| Name           | Value            | Environments                     |
| -------------- | ---------------- | -------------------------------- |
| `GROQ_API_KEY` | `gsk_…your key…` | Production, Preview, Development |

> **Server-only.** Do **not** prefix it with `NEXT_PUBLIC_`. The key must stay
> on the server — it is read only inside `app/api/voice/transcribe/route.ts`.

## 5. Add `GROQ_API_KEY` to `.env.local`

For local development, add the same line to your `.env.local`:

```bash
GROQ_API_KEY=gsk_your_key_here
```

(See `.env.local.example` for the placeholder.)

## 6. Redeploy on Vercel

Environment variables only take effect on a new deployment. Trigger a redeploy
(push a commit, or **Deployments → ⋯ → Redeploy**). Restart `npm run dev`
locally so the new value is picked up.

## 7. How to test

1. Open a chat in Forge OS.
2. Click the **mic** button in the composer (right of the model picker).
3. The browser asks for microphone permission the first time — click **Allow**.
4. The mic turns into a **red pulsing stop button** with a running timer
   (`0:03`, `0:04`, …). Recording auto-stops at **1:00**.
5. Speak a sentence, then **click the mic again** to stop.
6. The button shows a **spinner** while transcribing, then your spoken words
   appear in the composer at the cursor.

If `GROQ_API_KEY` is missing, the mic still records, but you'll see
*"Transcription failed. Please try again."* — add the key and redeploy.

## 8. Browser compatibility

Voice input uses the browser `MediaRecorder` API:

| Browser          | Support                                          |
| ---------------- | ------------------------------------------------ |
| Chrome / Edge    | ✅ Full                                           |
| Firefox          | ✅ Full                                           |
| Safari (macOS)   | ⚠️ Limited — recording works on recent versions but is less reliable |
| Safari (iOS)     | ⚠️ Limited — may require a user gesture and recent iOS |

On an unsupported browser the mic shows
*"Voice recording isn't supported in this browser."* and nothing breaks.

## 9. Files created or modified

**Created**

- `app/api/voice/transcribe/route.ts` — POST route: verifies the Firebase ID
  token, forwards the audio blob to Groq Whisper, returns `{ text }`.
- `SETUP_INSTRUCTIONS_VOICE_INPUT.md` — this file.

**Modified**

- `components/chat/composer.tsx` — replaced the old Web-Speech mic with a
  `MediaRecorder`-based recorder (record → stop → upload → insert transcript),
  recording timer, and transcribing spinner.
- `app/globals.css` — recording / transcribing / timer styles
  (`.mic-btn.recording`, `.mic-stop`, `.mic-spinner`, `.rec-timer`, `.rec-dot`).
- `.env.local.example` — added the `GROQ_API_KEY` placeholder.

## 10. Common errors

- **Mic button does nothing / no permission prompt** — the browser blocked
  microphone access. Check the site permissions (the 🔒/camera icon in the
  address bar) and allow the microphone, then reload. On an insecure origin
  (plain `http://`, not `localhost`) browsers disable `getUserMedia` entirely —
  use `https://` or `localhost`.
- **Empty transcription / "No speech detected"** — the audio blob was empty or
  silent. Make sure the right input device is selected and that `ondataavailable`
  is producing chunks (speak for at least a second before stopping). Some ad/
  privacy extensions can interfere with `MediaRecorder`.
- **401 from Groq** — the `GROQ_API_KEY` is invalid, revoked, or has a typo.
  Recreate the key in the Groq console and update Vercel + `.env.local`, then
  redeploy.
- **"Voice transcription is not configured."** — `GROQ_API_KEY` isn't set in
  that environment. Add it and redeploy.
- **413 / request too large** — recordings are capped at 60 seconds, which stays
  well under Groq's limit; if you raised the cap, shorten the clip.
