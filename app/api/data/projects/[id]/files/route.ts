import { NextRequest } from "next/server";
import { requireUser, isResponse, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToFile } from "@/lib/supabase/mappers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id: projectId } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("files")
    .select("*")
    .eq("user_id", user.uid)
    .eq("project_id", projectId);
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToFile));
}
