import { NextRequest } from "next/server";
import { requireUser, isResponse } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isoToMs } from "@/lib/supabase/mappers";
import type { UsagePayload, UsageSnapshot } from "@/lib/usage/types";

export const runtime = "nodejs";

const EMPTY: UsageSnapshot = {
  window5hForgeTokens: 0,
  window5hOpenedAt: null,
  weeklyForgeTokens: 0,
  weeklyOpenedAt: null,
  dailyForgeTokens: 0,
  dailyResetAt: null,
  imagesThisMonth: 0,
  visionThisMonth: 0,
  searchesThisMonth: 0,
  documentsThisMonth: 0,
  voiceInputMinutesThisMonth: 0,
  voiceOutputCharsThisMonth: 0,
  codeExecutionsThisMonth: 0,
  monthResetAt: null,
};

const tsOrNull = (v: unknown): number | null => (v == null ? null : isoToMs(v));

/** GET /api/data/usage — the caller's plan + current usage snapshot (camelCase, ms). */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const [{ data: userRow }, { data: row }] = await Promise.all([
    supabaseAdmin.from("users").select("plan").eq("id", user.uid).maybeSingle(),
    supabaseAdmin.from("usage").select("*").eq("user_id", user.uid).maybeSingle(),
  ]);

  const plan = (userRow?.plan as string | undefined) ?? "free";
  const usage: UsageSnapshot = row
    ? {
        window5hForgeTokens: Number(row.window_5h_forge_tokens ?? 0),
        window5hOpenedAt: tsOrNull(row.window_5h_opened_at),
        weeklyForgeTokens: Number(row.weekly_forge_tokens ?? 0),
        weeklyOpenedAt: tsOrNull(row.weekly_opened_at),
        dailyForgeTokens: Number(row.daily_forge_tokens ?? 0),
        dailyResetAt: tsOrNull(row.daily_reset_at),
        imagesThisMonth: Number(row.images_this_month ?? 0),
        visionThisMonth: Number(row.vision_this_month ?? 0),
        searchesThisMonth: Number(row.searches_this_month ?? 0),
        documentsThisMonth: Number(row.documents_this_month ?? 0),
        voiceInputMinutesThisMonth: Number(row.voice_input_minutes_this_month ?? 0),
        voiceOutputCharsThisMonth: Number(row.voice_output_chars_this_month ?? 0),
        codeExecutionsThisMonth: Number(row.code_executions_this_month ?? 0),
        monthResetAt: tsOrNull(row.month_reset_at),
      }
    : EMPTY;

  const payload: UsagePayload = { plan, usage };
  return Response.json(payload);
}
