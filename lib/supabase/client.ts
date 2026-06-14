import { createClient } from "@supabase/supabase-js";

// Public (anon) Supabase client — created per the migration brief.
//
// NOTE: all app data is accessed exclusively through server routes using the
// service-role client (`lib/supabase/server.ts`). Row Level Security is enabled
// on every table with NO policies, so this anon client cannot read or write app
// tables. It is kept for the brief's contract and any future public,
// RLS-policied use.
//
// The `|| ""`-style fallbacks keep `next build` working before the env vars are
// set; real values are required at runtime (see SETUP_INSTRUCTIONS_SUPABASE.md).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-not-set";

export const supabase = createClient(url, anonKey);
