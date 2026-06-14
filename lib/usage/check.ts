import "server-only";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { PLAN_LIMITS, resolvePlanId } from "@/lib/plans/limits";
import { FIVE_HOURS_MS, WEEK_MS, formatHrMin, formatDaysHr } from "./compute";

export interface TokenCheck {
  allowed: boolean;
  reason?: "daily_limit" | "window_5h" | "weekly";
  message?: string;
  resetsAt?: Date;
}

const parseTs = (v: unknown): number | null => {
  if (!v) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/**
 * Pre-request token-limit check (§STEP 1). Fails OPEN on any infra error — usage
 * tracking must never block a response. The window-rolling semantics mirror the
 * `deduct_forge_tokens` RPC: a stored counter only counts while its window is
 * still open (the next deduction resets a window once its reset time passes).
 */
export async function checkTokenLimit(userId: string, plan: string): Promise<TokenCheck> {
  if (!supabaseConfigured || !userId) return { allowed: true };

  const planKey = resolvePlanId(plan);
  const limits = PLAN_LIMITS[planKey];

  try {
    const { data: row } = await supabaseAdmin
      .from("usage")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // No row yet → provision it and allow.
    if (!row) {
      await supabaseAdmin.from("usage").upsert({ user_id: userId }, { onConflict: "user_id" });
      return { allowed: true };
    }

    const now = Date.now();

    if (planKey === "free") {
      const limit = limits.daily_forge_tokens;
      const reset = parseTs(row.daily_reset_at);
      const active = reset != null && now < reset;
      const used = active ? Number(row.daily_forge_tokens ?? 0) : 0;
      if (limit != null && used >= limit) {
        return {
          allowed: false,
          reason: "daily_limit",
          message: "You have reached your daily token limit. Resets at midnight UTC.",
          resetsAt: reset != null ? new Date(reset) : undefined,
        };
      }
      return { allowed: true };
    }

    // Paid: 5-hour window.
    const limit5h = limits.window_5h_forge_tokens;
    const opened5h = parseTs(row.window_5h_opened_at);
    if (limit5h != null && opened5h != null) {
      const resetsAt = opened5h + FIVE_HOURS_MS;
      if (now < resetsAt && Number(row.window_5h_forge_tokens ?? 0) >= limit5h) {
        return {
          allowed: false,
          reason: "window_5h",
          message: `Your 5-hour window is full. Resets in ${formatHrMin(resetsAt - now)}.`,
          resetsAt: new Date(resetsAt),
        };
      }
    }

    // Paid: weekly window.
    const limitWeek = limits.weekly_forge_tokens;
    const openedWeek = parseTs(row.weekly_opened_at);
    if (limitWeek != null && openedWeek != null) {
      const resetsAt = openedWeek + WEEK_MS;
      if (now < resetsAt && Number(row.weekly_forge_tokens ?? 0) >= limitWeek) {
        return {
          allowed: false,
          reason: "weekly",
          message: `Your weekly limit is reached. Resets in ${formatDaysHr(resetsAt - now)}.`,
          resetsAt: new Date(resetsAt),
        };
      }
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
