import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { skillPatchToUpdate } from "@/lib/supabase/mappers";
import { validateSkillInput } from "@/lib/data/validate";
import type { Skill } from "@/lib/data/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const patch = await readJson<Partial<Skill>>(req);
  const invalid = validateSkillInput(patch);
  if (invalid) return jsonError(invalid, 400);
  const update = skillPatchToUpdate(patch);
  if (Object.keys(update).length) {
    const { error } = await supabaseAdmin
      .from("skills")
      .update(update)
      .eq("user_id", user.uid)
      .eq("id", id);
    if (error) return jsonError(error.message, 500);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin
    .from("skills")
    .delete()
    .eq("user_id", user.uid)
    .eq("id", id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
