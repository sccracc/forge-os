# Forge Vision Setup

Forge Vision lets authenticated users attach an image to a chat message. Gemini describes the image server-side, then Forge passes that hidden text context to DeepSeek while the chat UI shows only the user's original message and thumbnail.

## Add `GEMINI_API_KEY`

1. Go to [Google AI Studio](https://aistudio.google.com).
2. Sign in with your Google account.
3. Click **Get API key**.
4. Click **Create API key in new project**.
5. Copy the API key.
6. Add `GEMINI_API_KEY` to Vercel environment variables.
7. Keep it server-only. Do not use a `NEXT_PUBLIC_` prefix.
8. Add `GEMINI_API_KEY` to `.env.local` for local development.
9. Redeploy on Vercel after adding the variable.

## Test

1. Open Forge OS.
2. Start or open a chat.
3. Use the `+` button and choose **Attach image**.
4. Select a JPEG, PNG, WebP, or GIF under 10MB.
5. Send a message like `what do you see?`.
6. Confirm the user message shows the thumbnail and Forge responds using details from the image.

## Files Created Or Modified

- `.env.local.example`
- `SETUP_INSTRUCTIONS_VISION.md`
- `app/api/chat/route.ts`
- `app/globals.css`
- `components/chat/chat-view.tsx`
- `components/chat/composer.tsx`
- `components/chat/message.tsx`
- `hooks/use-chat-send.ts`
- `lib/ai/types.ts`
- `lib/data/attachments.ts`
- `lib/data/types.ts`
- `lib/store/stream-store.ts`
- `lib/supabase/mappers.ts`
- `lib/vision/gemini.ts`
- `tests/vision-attachments.test.ts`

## Common Errors

- `400`: invalid API key or invalid image payload. Recheck `GEMINI_API_KEY` and make sure the client is sending raw base64 without the `data:image/...;base64,` prefix.
- `403`: API not enabled in Google Cloud or the key is blocked for this API. Enable Gemini API access for the Google Cloud project behind the key.
- Image not showing: check FileReader base64 conversion in `components/chat/composer.tsx`, then confirm `messages.attachments` contains `{ type: "image", base64, mimeType }`.
