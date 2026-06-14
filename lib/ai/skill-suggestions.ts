export interface SkillSuggestionCandidate {
  slug: string;
  name: string;
  description?: string;
}

export interface SuggestedSkill {
  slug: string;
  name: string;
  reason: string;
}

export const MAX_SUGGESTED_SKILLS = 3;

export const SUGGEST_SKILLS_SYSTEM = `You route a user's message to the user's skills, but only when a skill would clearly and materially improve the response. Be conservative: most ordinary messages need no skill.

You may select up to 3 skills. Select multiple skills only when each one clearly helps a different part of the request.

Respond with only a compact JSON object and nothing else:
{"skills":[{"slug":"<exact slug from the list>","reason":"<8 words or fewer why it helps>"}]}

Never invent a slug. If no listed skill is clearly relevant, return {"skills":[]}.`;

function extractJsonObject(text: string): unknown | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function cleanReason(reason: unknown): string {
  return String(reason ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function parseSuggestedSkillsOutput(
  output: string,
  candidates: SkillSuggestionCandidate[],
  limit = MAX_SUGGESTED_SKILLS
): SuggestedSkill[] {
  const parsed = extractJsonObject(output);
  if (!parsed || typeof parsed !== "object") return [];

  const data = parsed as {
    skills?: unknown;
    slug?: unknown;
    reason?: unknown;
  };

  const rawItems = Array.isArray(data.skills)
    ? data.skills
    : data.slug
      ? [{ slug: data.slug, reason: data.reason }]
      : [];

  const bySlug = new Map(candidates.map((skill) => [skill.slug, skill]));
  const seen = new Set<string>();
  const picked: SuggestedSkill[] = [];

  for (const item of rawItems) {
    const rawSlug =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "slug" in item
          ? (item as { slug?: unknown }).slug
          : "";
    const slug = String(rawSlug ?? "").trim();
    if (!slug || slug === "none" || seen.has(slug)) continue;

    const candidate = bySlug.get(slug);
    if (!candidate) continue;

    const reason =
      typeof item === "object" && item !== null && "reason" in item
        ? cleanReason((item as { reason?: unknown }).reason)
        : "";
    picked.push({ slug: candidate.slug, name: candidate.name, reason });
    seen.add(slug);

    if (picked.length >= limit) break;
  }

  return picked;
}

export function formatSuggestedSkillNames(skills: SuggestedSkill[]): string {
  const names = skills.map((skill) => skill.name).filter(Boolean);
  if (names.length === 0) return "the suggested skill";
  if (names.length === 1) return `the ${names[0]} skill`;
  if (names.length === 2) return `the ${names[0]} and ${names[1]} skills`;
  return `the ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} skills`;
}

export function buildSkillSuggestionPrompt(skills: SuggestedSkill[]): string {
  const target = formatSuggestedSkillNames(skills);
  const pronoun = skills.length === 1 ? "it" : "them";
  return `I think my response could be better if I use ${target}. Should I go ahead and use ${pronoun}?`;
}
