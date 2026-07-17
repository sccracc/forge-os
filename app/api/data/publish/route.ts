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
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return jsonError("invalid id", 400);
  if (typeof html !== "string" || html.length > 4_000_000) {
    return jsonError("invalid html", 400);
  }

  // Ownership gate: a published id is public (it's in the share URL), so an
  // upsert without this check would let any signed-in user overwrite someone
  // else's published page and hijack their link.
  const { data: existing } = await supabaseAdmin
    .from("published")
    .select("owner")
    .eq("id", id)
    .maybeSingle();
  if (existing && existing.owner !== user.uid) {
    return jsonError("not found", 404);
  }

  // The project being published must belong to the caller too.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("user_id", user.uid)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return jsonError("not found", 404);

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
