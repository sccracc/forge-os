import type { EffortId } from "./effort";
import type { ForgeModelId } from "./models.public";

export const CHAT_TITLE_MODEL: ForgeModelId = "spark-2.5";
export const CHAT_TITLE_EFFORT: EffortId = "low";
export const CHAT_TITLE_THINKING = false;

export const CHAT_TITLE_SYSTEM_PROMPT = `You write concise chat titles.

Given only the user's first message, return a short title of 3 to 6 words that describes the chat.

Rules:
- Return only the title.
- No quotation marks.
- No trailing punctuation.
- Use Title Case.
- Do not mention "chat" unless it is central to the request.`;

export function buildChatTitlePrompt(firstUserMessage: string): string {
  return `First user message:\n${firstUserMessage.trim()}`;
}

export function cleanChatTitle(raw: string, fallback = "New chat"): string {
  const withoutCodeFence = raw.replace(/```[\s\S]*?```/g, " ");
  const firstLine = withoutCodeFence
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const cleaned = (firstLine ?? "")
    .replace(/^["'`]+|["'`.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  const title = words.join(" ").slice(0, 70).trim();
  return title || fallback;
}
