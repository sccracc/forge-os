import "server-only";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

/** The caller's plan + current monthly feature counts, for server-side gating. */
export interface UsageContext {
  plan: string;
  searches: number;
  images: number;
  vision: number;
  documents: number;
  voiceInputMinutes: number;
  voiceOutputChars: number;
  codeExecutions: number;
}

const FALLBACK: UsageContext = {
  plan: "free",
  searches: 0,
  images: 0,
  vision: 0,
  documents: 0,
  voiceInputMinutes: 0,
  voiceOutputChars: 0,
  codeExecutions: 0,
};

/** Standard 403 plan-gate response consumed by the client's "Feature Locked" modal. */
export function planGateResponse(opts: {
  feature: string;
  message: string;
  requiredPlan: string;
}): Response {
  return Response.json(
    { error: "plan_gate", feature: opts.feature, message: opts.message, requiredPlan: opts.requiredPlan },
    { status: 403 }
  );
}

/** Fetch plan + monthly usage counts. Fails open to a free/zero context. */
export async function getUsageContext(uid: string): Promise<UsageContext> {
  if (!supabaseConfigured || !uid) return { ...FALLBACK };
  try {
    const [{ data: u }, { data: row }] = await Promise.all([
      supabaseAdmin.from("users").select("plan").eq("id", uid).maybeSingle(),
      supabaseAdmin.from("usage").select("*").eq("user_id", uid).maybeSingle(),
    ]);
    return {
      plan: (u?.plan as string | undefined) ?? "free",
      searches: Number(row?.searches_this_month ?? 0),
      images: Number(row?.images_this_month ?? 0),
      vision: Number(row?.vision_this_month ?? 0),
      documents: Number(row?.documents_this_month ?? 0),
      voiceInputMinutes: Number(row?.voice_input_minutes_this_month ?? 0),
      voiceOutputChars: Number(row?.voice_output_chars_this_month ?? 0),
      codeExecutions: Number(row?.code_executions_this_month ?? 0),
    };
  } catch {
    return { ...FALLBACK };
  }
}
