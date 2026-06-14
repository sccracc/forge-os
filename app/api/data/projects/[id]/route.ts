import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToProject, projectPatchToUpdate } from "@/lib/supabase/mappers";
import type { ProjectDoc } from "@/lib/data/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("user_id", user.uid)
    .eq("id", id)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  return Response.json(data ? rowToProject(data) : null);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const update = projectPatchToUpdate(await readJson<Partial<ProjectDoc>>(req));
  if (Object.keys(update).length) {
    const { error } = await supabaseAdmin
      .from("projects")
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
  // files.project_id is ON DELETE SET NULL, so remove the project's files first
  // (matches the original behavior). checkpoints/build_log cascade via FK.
  await supabaseAdmin.from("files").delete().eq("user_id", user.uid).eq("project_id", id);
  const { error } = await supabaseAdmin
    .from("projects")
    .delete()
    .eq("user_id", user.uid)
    .eq("id", id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
