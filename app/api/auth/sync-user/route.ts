import { NextRequest } from "next/server";
import { requireUser, isResponse } from "@/lib/supabase/route-helpers";
import { ensureUserRows } from "@/lib/supabase/profile-server";

export const runtime = "nodejs";

/**
 * STEP 3 — user sync on login. Called after every successful Google sign-in
 * (via `ensureProfile`, which runs in the auth provider's session callback).
 * Upserts the user's `users` / `user_settings` / `usage` rows and returns the
 * merged profile. The uid comes from the verified access token (with legacy
 * accounts resolved by verified email in verifyRequest), never the body.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    avatar_url?: string;
  };

  const profile = await ensureUserRows({
    uid: user.uid,
    email: user.email ?? body.email,
    name: user.name ?? body.name,
    avatar: user.picture ?? body.avatar_url,
  });
  return Response.json(profile);
}
