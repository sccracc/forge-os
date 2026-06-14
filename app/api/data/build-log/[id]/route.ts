import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildMessagePatchToUpdate } from "@/lib/supabase/mappers";
import type { BuildMessage } from "@/lib/data/build-chat";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const update = buildMessagePatchToUpdate(await readJson<Partial<BuildMessage>>(req));
  if (Object.keys(update).length) {
    const run = (q: Record<string, unknown>) =>
      supabaseAdmin.from("build_log").update(q).eq("user_id", user.uid).eq("id", id);
    let { error } = await run(update);
    // Tolerate a DB that predates the `agent_run` column (migration pending).
    if (error && /agent_run/.test(error.message)) {
      const { agent_run: _drop, ...rest } = update as Record<string, unknown>;
      void _drop;
      if (Object.keys(rest).length) ({ error } = await run(rest));
      else error = null;
    }
    if (error) return jsonError(error.message, 500);
  }
  return Response.json({ ok: true });
}
