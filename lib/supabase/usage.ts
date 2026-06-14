import "server-only";
import { supabaseAdmin, supabaseConfigured } from "./server";

/**
 * Best-effort Forge-token deduction via the `deduct_forge_tokens` RPC (§15).
 * Rolls the 5h / weekly / daily windows and resets monthly counters server-side
 * and atomically. NEVER throws — usage tracking must never block a response.
 */
export async function deductForgeTokens(
  uid: string,
  forgeTokens: number,
  isFreePlan = false
): Promise<void> {
  if (
    !supabaseConfigured ||
    !uid ||
    !Number.isFinite(forgeTokens) ||
    forgeTokens <= 0
  ) {
    return;
  }
  try {
    await supabaseAdmin.rpc("deduct_forge_tokens", {
      p_user_id: uid,
      p_forge_tokens: Math.round(forgeTokens),
      p_is_free_plan: isFreePlan,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Records a completed chat generation's token spend against the user's usage
 * windows, picking the free/daily vs paid windows from the user's plan. Designed
 * to be fire-and-forget (not awaited) so it never adds latency. Never throws.
 */
export async function recordChatUsage(uid: string, tokens: number): Promise<void> {
  if (!supabaseConfigured || !uid || !Number.isFinite(tokens) || tokens <= 0) return;
  try {
    const { data } = await supabaseAdmin
      .from("users")
      .select("plan")
      .eq("id", uid)
      .maybeSingle();
    const isFree = (data?.plan ?? "free") === "free";
    await deductForgeTokens(uid, tokens, isFree);
  } catch {
    /* best-effort */
  }
}

/** Per-feature monthly counters to bump in one atomic call. */
export interface UsageDeltas {
  images?: number;
  vision?: number;
  searches?: number;
  documents?: number;
  voiceInputMinutes?: number;
  voiceOutputChars?: number;
  codeExecutions?: number;
}

/**
 * Atomically increments the per-feature monthly counters via the
 * `increment_usage` RPC (handles row-creation + monthly reset). Best-effort —
 * never throws and is a no-op when all deltas are zero.
 *
 * If the RPC isn't present (schema.sql not re-run yet) or errors, it falls back
 * to a direct read-modify-write so the counters still move and show up in
 * settings. The fallback isn't perfectly atomic, but a single user's own
 * feature usage doesn't race meaningfully.
 */
export async function incrementUsage(uid: string, deltas: UsageDeltas): Promise<void> {
  if (!supabaseConfigured || !uid) return;
  // Images can be fractional: a fallback to the standard model counts as 0.5.
  // Round to the nearest half so the monthly counter stays clean (numeric col).
  const images = Math.round((deltas.images ?? 0) * 2) / 2;
  const vision = Math.round(deltas.vision ?? 0);
  const searches = Math.round(deltas.searches ?? 0);
  const documents = Math.round(deltas.documents ?? 0);
  const voiceInputMinutes = deltas.voiceInputMinutes ?? 0;
  const voiceOutputChars = Math.round(deltas.voiceOutputChars ?? 0);
  const codeExecutions = Math.round(deltas.codeExecutions ?? 0);
  if (
    images === 0 &&
    vision === 0 &&
    searches === 0 &&
    documents === 0 &&
    voiceInputMinutes === 0 &&
    voiceOutputChars === 0 &&
    codeExecutions === 0
  ) {
    return;
  }
  try {
    const { error } = await supabaseAdmin.rpc("increment_usage", {
      p_user_id: uid,
      p_images: images,
      p_vision: vision,
      p_searches: searches,
      p_documents: documents,
      p_voice_input_minutes: voiceInputMinutes,
      p_voice_output_chars: voiceOutputChars,
      p_code_executions: codeExecutions,
    });
    if (!error) return;
    // RPC missing/failed (e.g. schema not re-run) — fall through to manual path.
    console.error("[usage] increment_usage RPC failed, falling back", error.message);
  } catch (err) {
    console.error("[usage] increment_usage RPC threw, falling back", err);
  }

  // ---- Fallback: read-modify-write with monthly reset -----------------------
  try {
    const now = Date.now();
    const { data: row } = await supabaseAdmin
      .from("usage")
      .select(
        "images_this_month, vision_this_month, searches_this_month, documents_this_month, voice_input_minutes_this_month, voice_output_chars_this_month, code_executions_this_month, month_reset_at"
      )
      .eq("user_id", uid)
      .maybeSingle();

    const resetMs = row?.month_reset_at ? Date.parse(String(row.month_reset_at)) : 0;
    const monthOver = !row || !resetMs || now >= resetMs;
    // Base = current counters, or 0 when the month rolled over / row is new.
    const base = monthOver
      ? { images: 0, vision: 0, searches: 0, documents: 0, vmin: 0, vchars: 0, code: 0 }
      : {
          images: Number(row?.images_this_month ?? 0),
          vision: Number(row?.vision_this_month ?? 0),
          searches: Number(row?.searches_this_month ?? 0),
          documents: Number(row?.documents_this_month ?? 0),
          vmin: Number(row?.voice_input_minutes_this_month ?? 0),
          vchars: Number(row?.voice_output_chars_this_month ?? 0),
          code: Number(row?.code_executions_this_month ?? 0),
        };

    // First day of next month, UTC — mirrors the RPC's date_trunc('month')+1mo.
    const d = new Date(now);
    const nextMonthReset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const monthResetAt = monthOver
      ? new Date(nextMonthReset).toISOString()
      : new Date(resetMs).toISOString();

    await supabaseAdmin.from("usage").upsert(
      {
        user_id: uid,
        images_this_month: base.images + images,
        vision_this_month: base.vision + vision,
        searches_this_month: base.searches + searches,
        documents_this_month: base.documents + documents,
        voice_input_minutes_this_month: base.vmin + voiceInputMinutes,
        voice_output_chars_this_month: base.vchars + voiceOutputChars,
        code_executions_this_month: base.code + codeExecutions,
        month_reset_at: monthResetAt,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch (err) {
    console.error("[usage] increment fallback failed", err);
  }
}
