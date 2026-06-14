// Lightweight, dependency-free intent detection for the chat composer.
// Used to AUTO-ENABLE the right creator skill (no asking) when the user clearly
// wants to create/edit a Forge skill or agent.

const VERB = "(?:creat\\w*|mak\\w*|build\\w*|design\\w*|generat\\w*|set\\s*up|new|add|updat\\w*|chang\\w*|renam\\w*|edit\\w*)";

// "create an agent", "build me a new agent that…", "rename this agent"
const AGENT_RE = new RegExp(`\\b${VERB}\\b[^.?!\\n]{0,60}\\bagents?\\b`, "i");
// "create a skill", "make a skill that…", "update this skill"
// (negative lookahead avoids "skill tree / set / level / gap / issue").
const SKILL_RE = new RegExp(
  `\\b${VERB}\\b[^.?!\\n]{0,60}\\bskills?\\b(?!\\s*(?:tree|set|level|point|gap|issue))`,
  "i"
);

export type CreatorIntent = "skill" | "agent";

/**
 * Returns "agent" or "skill" when the message is clearly asking to create or
 * edit a Forge agent/skill, else null. Agent is checked first so "agent" wins
 * over an incidental "skill" mention in the same sentence.
 */
export function detectCreatorIntent(text: string): CreatorIntent | null {
  if (!text) return null;
  if (AGENT_RE.test(text)) return "agent";
  if (SKILL_RE.test(text)) return "skill";
  return null;
}
