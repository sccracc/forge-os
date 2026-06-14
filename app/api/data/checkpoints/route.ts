import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToCheckpoint, checkpointToInsert } from "@/lib/supabase/mappers";
import type { CheckpointDoc } from "@/lib/data/types";

export const runtime = "nodejs";

const MAX_CHECKPOINTS = 30;

// List is metadata-only (no `files` snapshot) so polling stays light; the full
// snapshot is fetched per-checkpoint via GET /checkpoints/[id] on restore.
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required", 400);
  const { data, error } = await supabaseAdmin
    .from("checkpoints")
    .select("id, project_id, label, kind, at, file_count")
    .eq("user_id", user.uid)
    .eq("project_id", projectId)
    .order("at", { ascending: false });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToCheckpoint));
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const cp = await readJson<CheckpointDoc>(req);
  const { error } = await supabaseAdmin
    .from("checkpoints")
    .insert(checkpointToInsert(cp, user.uid));
  if (error) return jsonError(error.message, 500);

  // Prune oldest beyond the cap so history stays bounded (best-effort).
  const { data: all } = await supabaseAdmin
    .from("checkpoints")
    .select("id")
    .eq("user_id", user.uid)
    .eq("project_id", cp.projectId)
    .order("at", { ascending: false });
  if (all && all.length > MAX_CHECKPOINTS) {
    const extras = all.slice(MAX_CHECKPOINTS).map((r) => String(r.id));
    await supabaseAdmin.from("checkpoints").delete().in("id", extras);
  }
  return Response.json({ id: cp.id });
}
