# Image generation setup — Forge OS

Forge can generate and edit images via SiliconFlow, and understand attached
images via Google Gemini. Generated images are **re-hosted to Supabase
Storage** so they stay visible after generation and across reloads.

Public model names shown to users and the AI:
- Starter and Pro: Forge Image
- Max and Ultra: Forge Image Pro

Internal provider routing:
- Starter and Pro text-to-image: `Tongyi-MAI/Z-Image-Turbo`
- Max and Ultra text-to-image: `black-forest-labs/FLUX.2-pro`
- Attached-image edits: `black-forest-labs/FLUX.1-Kontext-dev`

The AI calls the `generate_image` tool on its own when you ask it to create,
draw, design, make, visualize, or edit an image. If the user uploads an image
and asks for a change, Forge automatically uses the image editing model with the
attached image as input. The tool is only offered when `SILICONFLOW_API_KEY` is
set and the user's plan includes image generation.

---

## 1. Image generation key (required for generation)
1. Create an account at <https://siliconflow.com> (or siliconflow.cn) and make an API key.
2. Add it to `.env.local` and to Vercel → Settings → Environment Variables
   (**server-only — no `NEXT_PUBLIC_` prefix**), then redeploy:
   ```bash
   SILICONFLOW_API_KEY=your-siliconflow-key
   ```

## 2. Supabase Storage bucket (required for images to persist)
SiliconFlow returns a **temporary** URL that expires, so Forge copies each image
into a Supabase Storage bucket and stores that permanent URL on the message.
Create the bucket once:

1. Supabase dashboard → **Storage** → **New bucket**.
2. Name it exactly **`generated-images`**.
3. Toggle **Public bucket = ON**, then create it.

That's it — uploads use the service-role key (already set), and the public bucket
makes the stored image URLs load in the chat. **Without this bucket**, generation
still works but falls back to the temporary URL (the image may vanish later).

## 3. Image understanding (optional)
For analyzing images the user attaches, add a Gemini key (server-only):
```bash
GEMINI_API_KEY=your-gemini-key
```
When unset, ordinary image understanding is unavailable; attached-image editing
can still work through SiliconFlow.

---

## How to test
1. Restart `npm run dev` (or redeploy) after setting the keys.
2. New chat → "generate a logo for a coffee shop" → you should see the loading
   animation, then the image, then it stays after the reply finishes and after a
   page reload.
3. In Supabase → Storage → `generated-images` you should see the uploaded file.

## Files changed in this pass
- `lib/ai/prompts.ts` — removed the stale "you cannot see images" line; added an
  "Image generation: available (Forge Image/Forge Image Pro)" state line + capability note so the model stops
  falsely refusing. (Injected only when the key is set.)
- `app/api/chat/route.ts` — offers `generate_image` only when configured; passes
  `imageGenAvailable` to the prompt; threads the uid into the executor.
- `lib/ai/tools.ts` — `executeGenerateImage` now re-hosts the image to Supabase.
- `lib/supabase/storage.ts` — new: downloads the temp image and uploads it to the
  `generated-images` bucket, returning a permanent public URL (falls back to the
  temp URL if the bucket/keys are missing).
- (Persistence + rendering of the image on the message were already wired via
  `messages.attachments`.)

## Common errors
- **AI says it can't generate images:** `SILICONFLOW_API_KEY` not set (the tool
  isn't offered), or you didn't restart/redeploy after adding it.
- **Image box is blank / disappears after reload:** the `generated-images` bucket
  doesn't exist or isn't public — create it (step 2).
- **401 from SiliconFlow:** wrong or quote-wrapped key; paste the raw key, redeploy.
- **429:** SiliconFlow rate limit — wait and retry.
