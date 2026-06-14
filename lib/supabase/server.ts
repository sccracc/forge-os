import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only Supabase admin client (service role — full DB access, bypasses
// RLS). Used by every /api/data/* route AFTER the Firebase ID token is verified
// and the uid is derived server-side. NEVER import this from client code.
//
// Fallbacks keep `next build` working before the env vars are set; real values
// are required at runtime (see SETUP_INSTRUCTIONS_SUPABASE.md).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "service-role-key-not-set";

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Whether real Supabase server credentials are present. Lets routes degrade
 *  gracefully with a clean error instead of throwing, mirroring the Firebase
 *  `adminConfigured` / `firebaseConfigured` pattern. */
export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
