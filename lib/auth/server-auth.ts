import "server-only";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export interface AuthedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

// Small TTL cache: verifying a token costs a Supabase auth round trip plus the
// canonical-uid lookup; the same token arrives on every polling request.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const tokenCache = new Map<string, { user: AuthedUser; exp: number }>();

function cachePut(token: string, user: AuthedUser) {
  if (tokenCache.size >= CACHE_MAX) {
    // Drop the oldest entries (Map preserves insertion order).
    const drop = Math.ceil(CACHE_MAX / 5);
    let i = 0;
    for (const key of tokenCache.keys()) {
      tokenCache.delete(key);
      if (++i >= drop) break;
    }
  }
  tokenCache.set(token, { user, exp: Date.now() + CACHE_TTL_MS });
}

function metaStr(meta: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

/**
 * Verifies the Supabase access token (JWT) from the Authorization header.
 * Returns the user, or null if missing/invalid. Never trusts a client-sent uid.
 *
 * Canonical-uid resolution: sign-in moved from Firebase to Supabase Google
 * OAuth, so new sessions carry a Supabase user id — but legacy accounts (and
 * all their rows) are keyed by their original Firebase uid. The bridge is the
 * VERIFIED, confirmed email: if a `users` row exists for this email, that
 * row's id is the canonical uid (email is server-controlled — sync-user writes
 * it from the verified token and the profile PATCH cannot change it).
 */
export async function verifyRequest(req: Request): Promise<AuthedUser | null> {
  if (!supabaseConfigured) return null;
  const header =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return null;
    const su = data.user;
    const email = su.email ?? undefined;
    const meta = (su.user_metadata ?? {}) as Record<string, unknown>;

    // Only a CONFIRMED email may map to an existing account — an unconfirmed
    // signup must never inherit someone else's data.
    let uid = su.id;
    if (email && su.email_confirmed_at) {
      const { data: row } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (row?.id) uid = String(row.id);
    }

    const user: AuthedUser = {
      uid,
      email,
      name: metaStr(meta, "full_name", "name"),
      picture: metaStr(meta, "avatar_url", "picture"),
    };
    cachePut(token, user);
    return user;
  } catch {
    return null;
  }
}

export function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
