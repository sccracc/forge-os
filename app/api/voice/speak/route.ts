import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { getUsageContext, planGateResponse } from "@/lib/usage/server";
import { getFeatureLimit, getUpgradeMessage, getRequiredPlan } from "@/lib/plans/gates";
import { incrementUsage } from "@/lib/supabase/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const MAX_TTS_CHARS = 4096;

/**
 * POST /api/voice/speak — text-to-speech for reading AI messages aloud.
 *
 * Accepts JSON `{ text }`, verifies the Firebase ID token, and proxies the text
 * to OpenAI's TTS endpoint, streaming the MP3 audio straight back to the client.
 * OPENAI_API_KEY is used ONLY here (TTS) — never for chat/completions — and is
 * read server-side only, never exposed to the browser.
 */
export async function POST(req: NextRequest) {
  // --- auth: verify the Firebase ID token; 401 if missing/invalid ---
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    user = null;
  }
  if (!user) return jsonError("unauthorized", 401);

  // --- configuration check ---
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("Voice output is not configured.", 500);

  // --- read + bound the text ---
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("No text provided.", 400);
  }
  const text = (typeof body.text === "string" ? body.text : "")
    .slice(0, MAX_TTS_CHARS)
    .trim();
  if (!text) return jsonError("No text provided.", 400);

  // --- plan gate: voice output (§STEP 2) ---
  const ctx = await getUsageContext(user.uid);
  const voiceLimit = getFeatureLimit(ctx.plan, "voice_output_chars");
  if (voiceLimit === 0) {
    return planGateResponse({
      feature: "voice_output",
      message: getUpgradeMessage(ctx.plan, "Voice output"),
      requiredPlan: getRequiredPlan("Voice output"),
    });
  }
  if (ctx.voiceOutputChars >= voiceLimit) {
    return planGateResponse({
      feature: "voice_output",
      message: "You've reached your monthly voice output limit.",
      requiredPlan: "max",
    });
  }

  // --- proxy to OpenAI TTS and stream the audio back ---
  try {
    const res = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "tts-1", input: text, voice: "alloy" }),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      console.error("[voice/speak] OpenAI error", res.status, detail);
      return jsonError("Voice generation failed.", 500);
    }

    await incrementUsage(user.uid, { voiceOutputChars: text.length }); // §STEP 3
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[voice/speak] request failed", err);
    return jsonError("Voice generation failed.", 500);
  }
}
