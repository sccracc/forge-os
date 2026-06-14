import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rowToAgent } from "@/lib/supabase/mappers";
import { loadProfile } from "@/lib/supabase/profile-server";

/** Loads an agent's system prompt for injection (executes before skills, §Agents). */
export async function loadAgentInstructions(uid: string, agentId: string): Promise<string | undefined> {
  try {
    const { data } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("user_id", uid)
      .eq("id", agentId)
      .maybeSingle();
    if (!data) return undefined;
    const a = rowToAgent(data);
    if (!a.enabled) return undefined;
    const body = a.systemPrompt?.trim();
    if (!body) return undefined;
    return `You are acting as the "${a.name}" agent.\n${body}`;
  } catch {
    return undefined;
  }
}

export interface UserPromptContext {
  customInstructions?: string;
  memory?: string;
}

/**
 * Loads the user's personalization + memory (Supabase, server-side) for prompt
 * assembly. Server-side so we never trust the client for memory content.
 */
export async function loadUserPromptContext(uid: string): Promise<UserPromptContext> {
  try {
    const p = await loadProfile(uid);
    if (!p) return {};
    const ci: string[] = [];
    if (p.customAbout?.trim()) ci.push(`About the user:\n${p.customAbout.trim()}`);
    if (p.customStyle?.trim()) ci.push(`How the user wants you to respond:\n${p.customStyle.trim()}`);
    const memory = p.memoryEnabled && p.memoryProfile?.trim() ? p.memoryProfile.trim() : undefined;
    return { customInstructions: ci.length ? ci.join("\n\n") : undefined, memory };
  } catch {
    return {};
  }
}

export interface ProjectPromptContext {
  projectInstructions?: string;
  forgeMd?: string;
}

/**
 * Loads a project's instructions + root FORGE.md (if present) for prompt
 * assembly in project-scoped chats and Forge Code sessions.
 */
export async function loadProjectPromptContext(
  uid: string,
  projectId: string
): Promise<ProjectPromptContext> {
  try {
    const out: ProjectPromptContext = {};
    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("description, forge_md")
      .eq("user_id", uid)
      .eq("id", projectId)
      .maybeSingle();
    if (proj) {
      const desc = proj.description ? String(proj.description).trim() : "";
      const fmd = proj.forge_md ? String(proj.forge_md).trim() : "";
      if (desc) out.projectInstructions = desc;
      if (fmd) out.forgeMd = fmd;
    }
    // FORGE.md may also live as a real file at the project root.
    if (!out.forgeMd) {
      const { data: files } = await supabaseAdmin
        .from("files")
        .select("path, content")
        .eq("user_id", uid)
        .eq("project_id", projectId);
      const md = (files ?? [])
        .map((f) => ({
          path: f.path ? String(f.path) : "",
          content: f.content ? String(f.content) : "",
        }))
        .find((f) => f.path.toLowerCase() === "forge.md");
      if (md?.content?.trim()) out.forgeMd = md.content.trim();
    }
    return out;
  } catch {
    return {};
  }
}
