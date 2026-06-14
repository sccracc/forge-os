import { NextRequest } from "next/server";
import { requireUser, isResponse } from "@/lib/supabase/route-helpers";
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
