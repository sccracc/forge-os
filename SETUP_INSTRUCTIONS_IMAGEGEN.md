# Forge Image Generation Setup

Forge OS generates and edits images through SiliconFlow.

Public model names shown to users and the AI:

- Starter and Pro: Forge Image
- Max and Ultra: Forge Image Pro

Internal provider routing:

- Starter and Pro text-to-image: `Tongyi-MAI/Z-Image-Turbo`
- Max and Ultra text-to-image: `black-forest-labs/FLUX.2-pro`
- Attached-image edits: `black-forest-labs/FLUX.1-Kontext-dev`

Image generation and image editing share the same monthly image limit for the
user's plan.

## Add `SILICONFLOW_API_KEY`

1. Go to <https://siliconflow.com>.
2. Create an account or log in.
3. Open Dashboard -> API Keys.
4. Create a new API key.
5. Add `SILICONFLOW_API_KEY` to Vercel environment variables.
6. Do not use a `NEXT_PUBLIC_` prefix.
7. Add `SILICONFLOW_API_KEY` to `.env.local` for local development.
8. Restart locally or redeploy on Vercel.

```env
SILICONFLOW_API_KEY=your_siliconflow_key_here
```

The value should be the raw key only, not `SILICONFLOW_API_KEY=...`, quotes, or
`Bearer ...`.

## Test generation

Ask Forge:

```text
generate an image of a futuristic city at night
```

## Test editing

Upload an image and ask:

```text
edit this so the background is a sunset
```

Forge should route the request through the image editing model automatically.
In user-facing answers, Forge should call the available model Forge Image or
Forge Image Pro, not the provider model name.

## Notes

- SiliconFlow image URLs may expire after about 1 hour.
- Forge re-hosts generated images to the Supabase `generated-images` bucket when
  that public bucket exists.
- `GEMINI_API_KEY` is still used for ordinary image understanding questions, but
  attached-image editing does not require Gemini.
