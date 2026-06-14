import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToConversation, conversationPatchToUpdate } from "@/lib/supabase/mappers";
import type { ConversationDoc } from "@/lib/data/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("user_id", user.uid)
    .eq("id", id)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  return Response.json(data ? rowToConversation(data) : null);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const update = conversationPatchToUpdate(await readJson<Partial<ConversationDoc>>(req));
  if (Object.keys(update).length) {
    const { error } = await supabaseAdmin
      .from("conversations")
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
  // messages are removed by the ON DELETE CASCADE FK.
  const { error } = await supabaseAdmin
    .from("conversations")
    .delete()
    .eq("user_id", user.uid)
    .eq("id", id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
