import "server-only";
import { supabaseAdmin } from "./server";
import { rowsToProfile } from "./mappers";
import type { UserProfile } from "@/lib/data/types";

/** Loads + merges the `users` + `user_settings` rows into one UserProfile. */
export async function loadProfile(uid: string): Promise<UserProfile | null> {
  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", uid)
    .maybeSingle();
  if (!userRow) return null;
  const { data: settingsRow } = await supabaseAdmin
    .from("user_settings")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();
  return rowsToProfile(userRow, settingsRow ?? null);
}

/**
 * Idempotently provisions the per-user rows on sign-in (§STEP 3): upserts
 * `users` (identity), `user_settings` and `usage` (defaults come from the column
 * definitions). Identity fields are refreshed only when provided.
 */
export async function ensureUserRows(args: {
  uid: string;
  email?: string;
  name?: string;
  avatar?: string;
}): Promise<UserProfile | null> {
  const now = new Date().toISOString();
  const userUpsert: Record<string, unknown> = {
    id: args.uid,
    email: args.email || `${args.uid}@placeholder.forge`,
    updated_at: now,
  };
  if (args.name !== undefined) userUpsert.name = args.name;
  if (args.avatar !== undefined) userUpsert.avatar_url = args.avatar;

  await supabaseAdmin.from("users").upsert(userUpsert, { onConflict: "id" });
  await supabaseAdmin
    .from("user_settings")
    .upsert({ user_id: args.uid }, { onConflict: "user_id" });
  await supabaseAdmin
    .from("usage")
    .upsert({ user_id: args.uid }, { onConflict: "user_id" });

  return loadProfile(args.uid);
}
