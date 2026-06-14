import type { ActiveSkill } from "./prompts";
import type { WireMessage } from "./types";

const MIN_MULTI_SKILLS = 2;

export function buildActiveSkillTurnInstruction(skills: ActiveSkill[] | undefined): string | null {
  const active = (skills ?? []).filter((skill) => skill.name.trim() && skill.instructions.trim());
  if (active.length < MIN_MULTI_SKILLS) return null;

  const deliverables = active
    .map((skill, index) => `${index + 1}. ${skill.name}: produce the visible deliverable required by this skill.`)
    .join("\n");

  return `[Forge active skill requirements for this same user request]
The user has activated multiple skills. Treat them as required deliverables, not optional context.

You must satisfy every active skill before finishing:
${deliverables}

Output rule:
- Do not answer with only one combined artifact unless it visibly satisfies every active skill.
- If one skill creates lyrics/song content and another creates a music generation prompt, include both sections: the song/lyrics and a separate model-ready prompt.
- Keep the labels concise, but make each skill's deliverable visible in the final answer.
- Do not mention this checklist.`;
}

export function withActiveSkillTurnInstruction(
  messages: WireMessage[],
  skills: ActiveSkill[] | undefined
): WireMessage[] {
  const instruction = buildActiveSkillTurnInstruction(skills);
  if (!instruction) return messages;

  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  if (lastUserIndex < 0) return [...messages, { role: "user", content: instruction }];

  return messages.map((message, index) =>
    index === lastUserIndex
      ? { ...message, content: `${message.content.trimEnd()}\n\n${instruction}` }
      : message
  );
}
