"use client";

// Browser Supabase client — the app's AUTH layer (Google OAuth via Supabase).
//
// Sign-in switched from Firebase popup auth to Supabase's Google provider
// because the Firebase popup/redirect handler lives on <project>.firebaseapp.com
// and storage-partitioned mobile browsers (iOS Safari/Chrome) can't carry auth
// state across that origin — the "missing initial state" dead end. Supabase's
// flow is a plain full-page redirect with PKCE: no popups, no cross-origin
// sessionStorage, works everywhere.
//
// App DATA still never flows through this client: all tables are accessed via
// server routes using the service-role key (RLS is enabled with no policies,
// so this anon-key client cannot read or write app tables). This client exists
// ONLY for authentication (session + access token).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the browser auth client can be created (env vars present). */
export const supabaseAuthConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** Lazy singleton — browser only. Returns null when unconfigured or on SSR. */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (!supabaseAuthConfigured || typeof window === "undefined") return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        flowType: "pkce",
        autoRefreshToken: true,
        persistSession: true,
        // The /auth/callback page performs the code exchange explicitly, so
        // automatic URL detection stays off (avoids double-exchange races).
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Current access token (JWT) for Authorization: Bearer headers, or null. */
export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
