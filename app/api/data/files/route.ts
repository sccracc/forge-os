import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fileToInsert } from "@/lib/supabase/mappers";
import type { FileDoc } from "@/lib/data/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const file = await readJson<FileDoc>(req);
  const { error } = await supabaseAdmin.from("files").insert(fileToInsert(file, user.uid));
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: file.id });
}
