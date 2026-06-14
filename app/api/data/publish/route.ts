import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Publishes a static project snapshot to the public `published` table and
 *  records the link on the project. */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id, projectId, name, html } = await readJson<{
    id: string;
    projectId: string;
    name: string;
    html: string;
  }>(req);
  if (!id || !projectId) return jsonError("id and projectId required", 400);

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("published")
    .upsert({ id, owner: user.uid, name, html, at: nowIso }, { onConflict: "id" });
  if (error) return jsonError(error.message, 500);

  await supabaseAdmin
    .from("projects")
    .update({ published: { id, at: Date.now() }, updated_at: nowIso })
    .eq("user_id", user.uid)
    .eq("id", projectId);

  return Response.json({ id });
}
