import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { generateText, ProviderNotConfiguredError } from "@/lib/ai/provider";
import {
  parseSuggestedSkillsOutput,
  SUGGEST_SKILLS_SYSTEM,
  type SkillSuggestionCandidate,
} from "@/lib/ai/skill-suggestions";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Lightweight pre-pass: do any of the user's skills clearly fit this message? */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    return jsonError("auth", 500);
  }
  if (!user) return jsonError("unauthorized", 401);
  if (!checkRateLimit(user.uid)) return Response.json({ skills: [] });

  let body: { message?: string; skills?: SkillSuggestionCandidate[] };
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid request", 400);
  }

  const message = (body.message ?? "").slice(0, 4000).trim();
  const skills = Array.isArray(body.skills) ? body.skills.slice(0, 25) : [];
  if (!message || skills.length === 0) return Response.json({ skills: [] });

  const list = skills
    .map((s) => `- ${s.slug}: ${s.name}${s.description ? ` - ${s.description}` : ""}`)
    .join("\n");

  try {
    const out = await generateText({
      modelId: "spark-2.5",
      effort: "low",
      systemPrompt: SUGGEST_SKILLS_SYSTEM,
      messages: [{ role: "user", content: `Available skills:\n${list}\n\nUser message:\n${message}` }],
      signal: req.signal,
    });
    return Response.json({ skills: parseSuggestedSkillsOutput(out, skills) });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return Response.json({ skills: [] });
    return Response.json({ skills: [] });
  }
}
