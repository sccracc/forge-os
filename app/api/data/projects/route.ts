import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToProject, projectToInsert, fileToInsert } from "@/lib/supabase/mappers";
import type { ProjectDoc, FileDoc } from "@/lib/data/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("user_id", user.uid)
    .order("updated_at", { ascending: false });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToProject));
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { project, files } = await readJson<{ project: ProjectDoc; files?: FileDoc[] }>(req);
  if (!project) return jsonError("missing project", 400);

  const { error: pErr } = await supabaseAdmin
    .from("projects")
    .insert(projectToInsert(project, user.uid));
  if (pErr) return jsonError(pErr.message, 500);

  if (files && files.length) {
    const { error: fErr } = await supabaseAdmin
      .from("files")
      .insert(files.map((f) => fileToInsert(f, user.uid)));
    if (fErr) return jsonError(fErr.message, 500);
  }
  return Response.json({ id: project.id });
}
