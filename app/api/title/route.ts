import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { generateText, ProviderNotConfiguredError } from "@/lib/ai/provider";
import {
  buildChatTitlePrompt,
  CHAT_TITLE_EFFORT,
  CHAT_TITLE_MODEL,
  CHAT_TITLE_SYSTEM_PROMPT,
  CHAT_TITLE_THINKING,
  cleanChatTitle,
} from "@/lib/ai/title";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    return jsonError("auth", 500);
  }
  if (!user) return jsonError("unauthorized", 401);
  if (!checkRateLimit(user.uid)) return jsonError("Forge is busy, try again shortly.", 429);

  let body: { firstUserMessage?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid request", 400);
  }

  const firstUserMessage = (body.firstUserMessage ?? "").slice(0, 2000).trim();
  if (!firstUserMessage) return jsonError("missing first user message", 400);

  try {
    const rawTitle = await generateText({
      modelId: CHAT_TITLE_MODEL,
      effort: CHAT_TITLE_EFFORT,
      thinking: CHAT_TITLE_THINKING,
      systemPrompt: CHAT_TITLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildChatTitlePrompt(firstUserMessage) }],
      signal: req.signal,
    });

    return Response.json({ title: cleanChatTitle(rawTitle) });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return Response.json({ title: cleanChatTitle(firstUserMessage) });
    }
    return Response.json({ title: cleanChatTitle(firstUserMessage) });
  }
}
