import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { getUsageContext, planGateResponse } from "@/lib/usage/server";
import { getFeatureLimit, getUpgradeMessage, getRequiredPlan } from "@/lib/plans/gates";
import { incrementUsage } from "@/lib/supabase/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

/**
 * POST /api/voice/transcribe — speech-to-text for the composer mic.
 *
 * Accepts multipart FormData with an `audio` blob, verifies the Firebase ID
 * token (Authorization: Bearer …), and forwards the audio to Groq's Whisper
 * endpoint. Returns `{ text }`. The provider key (GROQ_API_KEY) is read only
 * here, server-side — never exposed to the client.
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
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonError("Voice transcription is not configured.", 500);
  }

  // --- plan gate: voice input (§STEP 2) ---
  const ctx = await getUsageContext(user.uid);
  const voiceLimit = getFeatureLimit(ctx.plan, "voice_input_minutes");
  if (voiceLimit === 0) {
    return planGateResponse({
      feature: "voice_input",
      message: getUpgradeMessage(ctx.plan, "Voice input"),
      requiredPlan: getRequiredPlan("Voice input"),
    });
  }
  if (ctx.voiceInputMinutes >= voiceLimit) {
    return planGateResponse({
      feature: "voice_input",
      message: "You've reached your monthly voice input limit.",
      requiredPlan: "pro",
    });
  }

  // --- read the uploaded audio blob ---
  let audio: Blob | null = null;
  try {
    const form = await req.formData();
    const value = form.get("audio");
    if (value && typeof value !== "string") audio = value;
  } catch {
    return jsonError("Transcription failed. Please try again.", 500);
  }
  if (!audio || audio.size === 0) {
    return jsonError("Transcription failed. Please try again.", 500);
  }

  // --- forward to Groq Whisper ---
  try {
    const groqForm = new FormData();
    // Preserve the client's filename (it encodes the real container — Safari
    // records mp4, not webm); only fall back to a webm name when absent.
    const uploadName =
      audio instanceof File && /^audio\.(webm|m4a|ogg|mp3)$/.test(audio.name)
        ? audio.name
        : "audio.webm";
    groqForm.append("file", audio, uploadName);
    groqForm.append("model", GROQ_MODEL);
    groqForm.append("response_format", "verbose_json");

    const res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
      signal: req.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[voice/transcribe] Groq error", res.status, detail);
      return jsonError("Transcription failed. Please try again.", 500);
    }

    const data = (await res.json()) as { text?: string; duration?: number };
    // verbose_json returns the clip duration (seconds) → monthly minute counter.
    const minutes = typeof data.duration === "number" ? data.duration / 60 : 0;
    if (minutes > 0) await incrementUsage(user.uid, { voiceInputMinutes: minutes });
    return Response.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    console.error("[voice/transcribe] request failed", err);
    return jsonError("Transcription failed. Please try again.", 500);
  }
}
