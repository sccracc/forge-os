# Forge OS Code Execution Setup

Forge OS can execute Python and JavaScript files through E2B Code Interpreter sandboxes.

## Steps

1. Go to https://e2b.dev
2. Create or log into your account.
3. Open your E2B Dashboard and go to API keys.
4. Create a new API key.
5. Add `E2B_API_KEY` to your Vercel environment variables.
6. Do not use `NEXT_PUBLIC_`.
7. Add `E2B_API_KEY` to `.env.local` for local development.
8. Redeploy on Vercel after changing the environment variable.
9. Test in Forge Code:
   - Create or open a `.py` file.
   - Add `print(2 + 2)`.
   - Click the `Run` button in the editor toolbar.
   - Confirm the output pane shows `4`.

## Notes

- The app works normally when `E2B_API_KEY` is missing.
- When the key is missing, Forge shows: `Code execution is not configured in this environment.`
- E2B API keys usually start with `e2b_`.
- Code execution is an explicit Forge Code editor action. It is not an AI chat tool and does not change assistant response/file-write logic.
- Code execution is available to authenticated users when configured. There is no plan gate yet.

## Common Errors

- Missing key: add `E2B_API_KEY` in Vercel and redeploy.
- Invalid key: copy the raw E2B key only, with no quotes, no variable name, and no `Bearer` prefix.
- Timeout: long-running code may exceed Forge's 30 second execution limit.
- Unsupported language: only `python` and `javascript` are supported.

## Files Created Or Modified

- `package.json`
- `package-lock.json`
- `.env.local.example`
- `SETUP_INSTRUCTIONS_CODE.md`
- `app/api/code/run/route.ts`
- `app/globals.css`
- `components/code/ide.tsx`
- `components/code/script-runner-pane.tsx`
- `lib/code/runner.ts`
- `tests/code-runner.test.ts`
