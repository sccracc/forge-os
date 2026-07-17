import { NextRequest } from "next/server";
import { z } from "zod";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { assembleSystemPrompt } from "@/lib/ai/prompts";
import {
  loadUserPromptContext,
  loadProjectPromptContext,
  loadAgentInstructions,
} from "@/lib/ai/context-server";

export const runtime = "nodejs";

const schema = z.object({
  forgeModelId: z.enum(["spark-2.5", "magnum-2.8"]),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  thinking: z.boolean(),
  mode: z.enum(["chat", "code-build", "code-discuss"]).default("chat"),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
  toolsEnabled: z.boolean().optional(),
  skillSlugs: z.array(z.string()).optional(),
  skills: z.array(z.object({ name: z.string(), instructions: z.string() })).optional(),
  skillCatalog: z
    .array(z.object({ name: z.string(), slug: z.string(), description: z.string().optional() }))
    .optional(),
});

/** Instruction Inspector — returns the exact merged system prompt for the
 *  current context so the user can see why Forge behaves as it does.
 *
 *  Debug tool: exposes the full internal prompt stack (skills, memory, project
 *  rules, hidden directives), so it ships DISABLED and must be explicitly
 *  enabled per-deployment via NEXT_PUBLIC_FORGE_INSPECTOR=1 (the same flag
 *  hides/shows the command-palette entry). */
export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_FORGE_INSPECTOR !== "1") {
    return jsonError("not found", 404);
  }
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    return jsonError("unauthorized", 401);
  }
  if (!user) return jsonError("unauthorized", 401);

  let p;
  try {
    p = schema.parse(await req.json());
  } catch {
    return jsonError("invalid request", 400);
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const userCtx = await loadUserPromptContext(user.uid);
  const projectCtx = p.projectId ? await loadProjectPromptContext(user.uid, p.projectId) : {};
  const agentInstructions = p.agentId ? await loadAgentInstructions(user.uid, p.agentId) : undefined;

  const systemPrompt = assembleSystemPrompt({
    effort: p.effort,
    mode: p.mode,
    date: today,
    toolsEnabled: p.toolsEnabled,
    skills: p.skills,
    skillCatalog: p.skillCatalog,
    agentInstructions,
    customInstructions: userCtx.customInstructions,
    memory: userCtx.memory,
    projectInstructions: projectCtx.projectInstructions,
    forgeMd: projectCtx.forgeMd,
    currentState: {
      model: p.forgeModelId,
      effort: p.effort,
      thinking: p.thinking,
      mode: p.mode,
      toolsEnabled: p.toolsEnabled,
      activeSkillSlugs: p.skillSlugs,
      activeAgentId: p.agentId,
      projectId: p.projectId,
    },
  });

  return Response.json({ systemPrompt });
}
