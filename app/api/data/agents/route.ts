import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToAgent, agentToInsert } from "@/lib/supabase/mappers";
import { validateAgentInput } from "@/lib/data/validate";
import type { AgentDoc } from "@/lib/data/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("user_id", user.uid)
    .order("name", { ascending: true });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToAgent));
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const agent = await readJson<AgentDoc>(req);
  const invalid = validateAgentInput(agent);
  if (invalid) return jsonError(invalid, 400);
  const { error } = await supabaseAdmin.from("agents").insert(agentToInsert(agent, user.uid));
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: agent.id });
}
