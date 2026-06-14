import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToConversation, conversationToInsert } from "@/lib/supabase/mappers";
import type { ConversationDoc } from "@/lib/data/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("user_id", user.uid)
    .order("updated_at", { ascending: false });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToConversation));
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const conv = await readJson<ConversationDoc>(req);
  const { error } = await supabaseAdmin
    .from("conversations")
    .insert(conversationToInsert(conv, user.uid));
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: conv.id });
}
