import { NextRequest } from "next/server";
import { requireUser, isResponse, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  rowToConversation,
  rowToMessage,
  rowToFile,
  rowToProject,
  rowToSkill,
  type Row,
} from "@/lib/supabase/mappers";
import { loadProfile } from "@/lib/supabase/profile-server";
import type { MessageDoc } from "@/lib/data/types";

export const runtime = "nodejs";

/** Assembles all of a user's data for the "download all my data" export. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const uid = user.uid;

  const [convs, msgs, files, projects, skills] = await Promise.all([
    supabaseAdmin.from("conversations").select("*").eq("user_id", uid).order("updated_at", { ascending: false }),
    supabaseAdmin.from("messages").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
    supabaseAdmin.from("files").select("*").eq("user_id", uid),
    supabaseAdmin.from("projects").select("*").eq("user_id", uid),
    supabaseAdmin.from("skills").select("*").eq("user_id", uid),
  ]);

  const firstErr = convs.error || msgs.error || files.error || projects.error || skills.error;
  if (firstErr) return jsonError(firstErr.message, 500);

  const byConv = new Map<string, MessageDoc[]>();
  for (const row of (msgs.data ?? []) as Row[]) {
    const cid = String(row.conversation_id);
    const arr = byConv.get(cid) ?? [];
    arr.push(rowToMessage(row));
    byConv.set(cid, arr);
  }

  const conversations = ((convs.data ?? []) as Row[]).map((c) => {
    const conversation = rowToConversation(c);
    return { conversation, messages: byConv.get(conversation.id) ?? [] };
  });

  const profile = await loadProfile(uid);

  return Response.json({
    conversations,
    files: ((files.data ?? []) as Row[]).map(rowToFile),
    projects: ((projects.data ?? []) as Row[]).map(rowToProject),
    skills: ((skills.data ?? []) as Row[]).map(rowToSkill),
    profile,
  });
}
