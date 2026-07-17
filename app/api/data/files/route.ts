import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError, projectsOwnedBy } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fileToInsert } from "@/lib/supabase/mappers";
import { checkWritePath } from "@/lib/code/path-safety";
import type { FileDoc } from "@/lib/data/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const file = await readJson<FileDoc>(req);
  // Server-side path gate (the client validates too, but this is the boundary).
  const check = checkWritePath(file.path);
  if (!check.ok) return jsonError(`invalid path: ${check.reason}`, 400);
  // Parent-ownership check: never attach a file to someone else's project.
  if (file.projectId && !(await projectsOwnedBy(user.uid, [file.projectId]))) {
    return jsonError("not found", 404);
  }
  const { error } = await supabaseAdmin
    .from("files")
    .insert(fileToInsert({ ...file, path: check.path }, user.uid));
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: file.id });
}
