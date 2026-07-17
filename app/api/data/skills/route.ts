import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToSkill, skillToInsert } from "@/lib/supabase/mappers";
import { validateSkillInput } from "@/lib/data/validate";
import type { Skill } from "@/lib/data/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { data, error } = await supabaseAdmin
    .from("skills")
    .select("*")
    .eq("user_id", user.uid)
    .order("name", { ascending: true });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToSkill));
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const skill = await readJson<Skill>(req);
  const invalid = validateSkillInput(skill);
  if (invalid) return jsonError(invalid, 400);
  const { error } = await supabaseAdmin.from("skills").insert(skillToInsert(skill, user.uid));
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: skill.id });
}
