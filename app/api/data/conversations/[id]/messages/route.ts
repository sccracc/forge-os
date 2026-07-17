import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToMessage, messageToInsert } from "@/lib/supabase/mappers";
import type { MessageDoc } from "@/lib/data/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id: conversationId } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("user_id", user.uid)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return jsonError(error.message, 500);
  return Response.json((data ?? []).map(rowToMessage));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { id: conversationId } = await ctx.params;
  // Parent-ownership check: never insert into a conversation the caller
  // doesn't own (the insert row is uid-scoped, but the parent id is not).
  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("user_id", user.uid)
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo) return jsonError("not found", 404);
  const msg = await readJson<MessageDoc>(req);
  const { error } = await supabaseAdmin
    .from("messages")
    .insert(messageToInsert(msg, user.uid, conversationId));
  if (error) return jsonError(error.message, 500);
  return Response.json({ id: msg.id });
}
