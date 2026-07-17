import { NextRequest } from "next/server";
import { requireUser, isResponse, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/supabase/profile-server";
import { profilePatchToRows } from "@/lib/supabase/mappers";
import type { UserProfile } from "@/lib/data/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  return Response.json(await loadProfile(user.uid));
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const patch = (await req.json().catch(() => ({}))) as Partial<UserProfile>;
  // Hard caps on free-text fields that get injected into every future system
  // prompt (uncapped, they'd be an unmetered cost vector).
  if (typeof patch.customAbout === "string" && patch.customAbout.length > 4_000)
    return jsonError("customAbout too long (max 4,000 characters)", 400);
  if (typeof patch.customStyle === "string" && patch.customStyle.length > 4_000)
    return jsonError("customStyle too long (max 4,000 characters)", 400);
  if (typeof patch.memoryProfile === "string" && patch.memoryProfile.length > 24_000)
    return jsonError("memoryProfile too long (max 24,000 characters)", 400);
  const { users, settings } = profilePatchToRows(patch);
  const now = new Date().toISOString();

  if (Object.keys(users).length) {
    await supabaseAdmin
      .from("users")
      .update({ ...users, updated_at: now })
      .eq("id", user.uid);
  }
  // The settings row may not exist yet on an early update → upsert.
  await supabaseAdmin
    .from("user_settings")
    .upsert({ user_id: user.uid, ...settings, updated_at: now }, { onConflict: "user_id" });

  return Response.json(await loadProfile(user.uid));
}
