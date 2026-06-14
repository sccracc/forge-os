import { NextRequest } from "next/server";
import { requireUser, isResponse, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToCheckpoint } from "@/lib/supabase/mappers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Full checkpoint incl. the `files` snapshot — used by restore.
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("checkpoints")
    .select("*")
    .eq("user_id", user.uid)
    .eq("id", id)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  return Response.json(data ? rowToCheckpoint(data) : null);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin
    .from("checkpoints")
    .delete()
    .eq("user_id", user.uid)
    .eq("id", id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
