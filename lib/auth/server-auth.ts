import "server-only";
import { getAdminAuth, adminConfigured } from "@/lib/firebase/admin";

export interface AuthedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Verifies the Firebase ID token from the Authorization header.
 * Returns the user, or null if missing/invalid. Never trusts a client-sent uid.
 */
export async function verifyRequest(req: Request): Promise<AuthedUser | null> {
  if (!adminConfigured) return null;
  const header =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const auth = getAdminAuth();
  if (!auth) return null;
  try {
    const decoded = await auth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name as string | undefined,
      picture: decoded.picture as string | undefined,
    };
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
