import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { messagePatchToUpdate } from "@/lib/supabase/mappers";
import type { MessageDoc } from "@/lib/data/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const update = messagePatchToUpdate(await readJson<Partial<MessageDoc>>(req));
  if (Object.keys(update).length) {
    const { error } = await supabaseAdmin
      .from("messages")
      .update(update)
      .eq("user_id", user.uid)
      .eq("id", id);
    if (error) return jsonError(error.message, 500);
  }
  return Response.json({ ok: true });
}
