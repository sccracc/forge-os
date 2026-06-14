import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToFile, filePatchToUpdate } from "@/lib/supabase/mappers";
import type { FileDoc } from "@/lib/data/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("files")
    .select("*")
    .eq("user_id", user.uid)
    .eq("id", id)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  return Response.json(data ? rowToFile(data) : null);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const update = filePatchToUpdate(await readJson<Partial<FileDoc>>(req));
  if (Object.keys(update).length) {
    const { error } = await supabaseAdmin
      .from("files")
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
    .from("files")
    .delete()
    .eq("user_id", user.uid)
    .eq("id", id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
