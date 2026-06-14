import "server-only";
import { generateText } from "./provider";
import type { WireMessage } from "./types";

// §3.5 — once a conversation grows past this many turns, collapse the older
// ones into a dense summary and keep only the most recent verbatim.
export const COLLAPSE_THRESHOLD = 10;
export const KEEP_RECENT = 4;

const SUMMARY_PROMPT = `You compress the earlier part of a conversation into a dense memory block the assistant will use to stay consistent. Capture key facts, decisions, names, file/code references, stated user preferences, and unresolved threads. Omit pleasantries and filler. Output only the summary as tight bullet points.`;

/** Pure split used to decide what to collapse vs. keep verbatim. */
export function splitForCollapse(
  messages: WireMessage[]
): { older: WireMessage[]; recent: WireMessage[] } | null {
  if (messages.length <= COLLAPSE_THRESHOLD) return null;
  const cut = messages.length - KEEP_RECENT;
  return { older: messages.slice(0, cut), recent: messages.slice(cut) };
}

/**
 * Collapses long histories: summarizes older turns via a cheap Spark call and
 * returns the working list (recent turns) + the summary to inject as context.
 * Best-effort — on any failure it falls back to the full history.
 */
export async function maybeCollapse(
  messages: WireMessage[],
  signal?: AbortSignal
): Promise<{ working: WireMessage[]; summary?: string }> {
  const split = splitForCollapse(messages);
  if (!split) return { working: messages };
  const transcript = split.older
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n")
    .slice(0, 60_000);
  try {
    const summary = await generateText({
      modelId: "spark-2.5",
      effort: "medium",
      systemPrompt: SUMMARY_PROMPT,
      messages: [{ role: "user", content: transcript }],
      signal,
    });
    const clean = summary.trim();
    return clean ? { working: split.recent, summary: clean } : { working: messages };
  } catch {
    return { working: messages };
  }
}
