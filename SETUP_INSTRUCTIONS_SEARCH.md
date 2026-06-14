# Web search setup - Forge OS

Forge can search the web in real time when it needs current information or when
the user explicitly asks it to search. The model popup still has a Web search
toggle, on by default.

Search is now Serper-first:

- Primary: Serper.dev (`SERPER_API_KEY`)
- Fallback: Brave Search (`BRAVE_SEARCH_API_KEY`)

If both keys are missing, Forge simply does not offer the `web_search` tool.

## 1. Add Serper

1. Create or log into a Serper account at <https://serper.dev>.
2. Copy your API key from the dashboard.
3. Add it to Vercel as a server-only environment variable:
   ```bash
   SERPER_API_KEY=your-serper-key
   ```
4. Add the same value to `.env.local` for local development.
5. Restart `npm run dev` locally, and redeploy on Vercel for production.

Do not use a `NEXT_PUBLIC_` prefix.

## 2. Optional Brave fallback

If you already have Brave configured, keep it:

```bash
BRAVE_SEARCH_API_KEY=your-brave-key
```

Forge will try Serper first, then Brave if Serper is not configured or returns no
usable results.

## 3. Supabase message search chips

Search results are saved on messages so source chips remain visible after reload.
Run this once in Supabase SQL Editor, or re-run `supabase/schema.sql`:

```sql
alter table messages add column if not exists searches jsonb;
```

## 4. Test

1. Start a new chat.
2. Make sure Web search is on in the model popup.
3. Ask: `what happened in the news today?`
4. You should see an inline search chip and source pills, then an answer grounded
   in the returned links.

## Common Errors

- No chip appears: `SERPER_API_KEY` is missing, the Web search toggle is off, or
  you did not restart/redeploy after adding the key.
- `[serper] search failed: 401`: the Serper key is invalid or set in the wrong
  environment.
- `[serper] search failed: 429`: Serper quota/rate limit. Add credits, slow down,
  or rely on Brave fallback if configured.
