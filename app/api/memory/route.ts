import { NextRequest } from "next/server";
import { z } from "zod";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/supabase/profile-server";
import { MEMORY_DISTILL_PROMPT } from "@/lib/ai/prompts";
import { generateText } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ conversationId: z.string().min(1) });

/**
 * Session-boundary memory distillation (§12). Reads a conversation's transcript
 * server-side, merges durable facts into the user's memory profile via a cheap
 * Spark call, and persists it. Best-effort and silent on no-op.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    return jsonError("unauthorized", 401);
  }
  if (!user) return jsonError("unauthorized", 401);

  let body;
  try {
    body = schema.parse(await req.json());
  } catch {
    return jsonError("invalid request", 400);
  }

  if (!supabaseConfigured) return Response.json({ ok: true, skipped: "not-configured" });

  try {
    const profile = await loadProfile(user.uid);
    if (!profile || !profile.memoryEnabled) return Response.json({ ok: true, skipped: "disabled" });

    const { data: msgRows } = await supabaseAdmin
      .from("messages")
      .select("role, content")
      .eq("user_id", user.uid)
      .eq("conversation_id", body.conversationId)
      .order("created_at", { ascending: true });
    const msgs = (msgRows ?? [])
      .map((m) => ({ role: String(m.role), content: m.content ? String(m.content) : "" }))
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content);
    if (msgs.length < 4) return Response.json({ ok: true, skipped: "too-short" });

    const transcript = msgs
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n")
      .slice(0, 40_000);

    const existing = profile.memoryProfile?.trim() || "(none yet)";
    const result = await generateText({
      modelId: "spark-2.5",
      effort: "low",
      systemPrompt: MEMORY_DISTILL_PROMPT,
      messages: [
        {
          role: "user",
          content: `Existing memory profile:\n${existing}\n\n---\n\nNew conversation:\n${transcript}\n\n---\n\nReturn the FULL updated memory profile: merge any new durable facts into the existing profile, keep what's still relevant, and remove duplicates. If there is nothing durable to record, output exactly: NO_MEMORY.`,
        },
      ],
    });

    const clean = result.trim();
    if (clean && clean.toUpperCase() !== "NO_MEMORY" && clean !== existing) {
      await supabaseAdmin
        .from("user_settings")
        .update({ memory_profile: clean, updated_at: new Date().toISOString() })
        .eq("user_id", user.uid);
      return Response.json({ ok: true, updated: true });
    }
    return Response.json({ ok: true, updated: false });
  } catch {
    return Response.json({ ok: true, skipped: "error" });
  }
}
