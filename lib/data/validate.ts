// Server-side validation for user-authored skills and agents. The editors
// enforce friendlier limits client-side; these are the hard caps a direct API
// call cannot bypass. Both skill instructions and agent system prompts are
// injected verbatim into every future system prompt, so unbounded content here
// is a cost/abuse vector as well as a data-quality problem.

import { isEffortId } from "@/lib/ai/effort";
import { FORGE_MODEL_IDS } from "@/lib/ai/models.public";
import type { AgentDoc, Skill } from "@/lib/data/types";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const bad = (msg: string) => msg;

/** Validate a skill insert/patch. Returns an error message, or null when ok. */
export function validateSkillInput(s: Partial<Skill>): string | null {
  if (s.name !== undefined && (typeof s.name !== "string" || !s.name.trim() || s.name.length > 120))
    return bad("skill name must be 1-120 characters");
  if (s.slug !== undefined && (typeof s.slug !== "string" || !SLUG_RE.test(s.slug)))
    return bad("skill slug must be kebab-case (a-z, 0-9, -), max 64 characters");
  if (s.description !== undefined && typeof s.description === "string" && s.description.length > 500)
    return bad("skill description too long (max 500 characters)");
  if (s.instructions !== undefined && (typeof s.instructions !== "string" || s.instructions.length > 24_000))
    return bad("skill instructions too long (max 24,000 characters)");
  if (s.icon !== undefined && typeof s.icon === "string" && s.icon.length > 8)
    return bad("skill icon must be a single emoji");
  if (s.category !== undefined && typeof s.category === "string" && s.category.length > 60)
    return bad("skill category too long (max 60 characters)");
  return null;
}

/** Validate an agent insert/patch. Returns an error message, or null when ok. */
export function validateAgentInput(a: Partial<AgentDoc>): string | null {
  if (a.name !== undefined && (typeof a.name !== "string" || !a.name.trim() || a.name.length > 120))
    return bad("agent name must be 1-120 characters");
  if (a.avatar !== undefined && typeof a.avatar === "string" && a.avatar.length > 8)
    return bad("agent avatar must be a single emoji");
  if (a.description !== undefined && typeof a.description === "string" && a.description.length > 500)
    return bad("agent description too long (max 500 characters)");
  if (a.systemPrompt !== undefined && (typeof a.systemPrompt !== "string" || a.systemPrompt.length > 16_000))
    return bad("agent system prompt too long (max 16,000 characters)");
  if (a.defaultModel !== undefined && !FORGE_MODEL_IDS.includes(a.defaultModel))
    return bad("invalid default model");
  if (a.defaultEffort !== undefined && !isEffortId(a.defaultEffort))
    return bad("invalid default effort");
  if (a.skillSlugs !== undefined) {
    if (!Array.isArray(a.skillSlugs) || a.skillSlugs.length > 50) return bad("too many skill slugs");
    if (a.skillSlugs.some((s) => typeof s !== "string" || !SLUG_RE.test(s)))
      return bad("invalid skill slug in skillSlugs");
  }
  return null;
}
