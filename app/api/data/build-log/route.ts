import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToBuildMessage, buildMessageToInsert } from "@/lib/supabase/mappers";
import type { BuildMessage } from "@/lib/data/build-chat";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required", 400);
  const { data, error } = await supabaseAdmin
    .from("build_log")
    .select("*")
    .eq("user_id", user.uid)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToBuildMessage));
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { projectId, message } = await readJson<{
    projectId: string;
    message: BuildMessage;
  }>(req);
  if (!projectId || !message) return jsonError("projectId and message required", 400);
  const row = buildMessageToInsert(message, user.uid, projectId);
  let { error } = await supabaseAdmin.from("build_log").insert(row);
  // Graceful degradation: if the DB predates the `agent_run` column (migration
  // not applied yet), drop that field and retry so the build message still saves
  // — persistence of the agent-run trace simply waits for the migration.
  if (error && /agent_run/.test(error.message)) {
    const { agent_run: _drop, ...rest } = row as Record<string, unknown>;
    void _drop;
    ({ error } = await supabaseAdmin.from("build_log").insert(rest));
  }
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: message.id });
}
