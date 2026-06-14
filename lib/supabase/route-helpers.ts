import "server-only";
import { verifyRequest, jsonError, type AuthedUser } from "@/lib/auth/server-auth";
import { supabaseConfigured } from "./server";

export { jsonError };

/**
 * Verifies the Firebase ID token and that Supabase is configured. Returns the
 * authenticated user, or a `Response` to return early. The verified `uid` is the
 * sole source of truth — never trust a client-sent uid.
 *
 *   const user = await requireUser(req);
 *   if (isResponse(user)) return user;
 *   // ...use user.uid
 */
export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  if (!supabaseConfigured) return jsonError("Supabase is not configured", 503);
  const user = await verifyRequest(req);
  if (!user) return jsonError("unauthorized", 401);
  return user;
}

export function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Map a Supabase error to a 500 Response (or null when there's no error). */
export function dbError(error: { message: string } | null): Response | null {
  return error ? jsonError(error.message, 500) : null;
}
