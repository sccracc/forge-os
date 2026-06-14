// Pure, client-safe usage math shared by the composer indicator and the
// settings usage section. No server-only imports, no React — usable anywhere.

import { PLAN_LIMITS, resolvePlanId, type PlanId } from "@/lib/plans/limits";
import type { UsageSnapshot } from "./types";

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function isFreePlan(plan: string): boolean {
  return resolvePlanId(plan) === "free";
}

export interface TokenStatus {
  /** Bar width — clamped 0..100, rounded. */
  pct: number;
  /** Unclamped percentage, for threshold logic (can exceed 100). */
  pctRaw: number;
  /** Whole-percent remaining (0 when full). */
  remaining: number;
  /** Whether the binding window is at/over its limit. */
  full: boolean;
  /** Which window is full (5h takes priority), else null. */
  blocking: "5h" | "weekly" | "daily" | null;
  /** Epoch-ms reset time of the most relevant window (binding when full). */
  resetsAt: number | null;
}

function pctOf(used: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0;
  return (used / limit) * 100;
}

/**
 * Token-window status for the indicator + settings. Free plans use the daily
 * cap; paid plans use max(5h, weekly). A window only counts while it is open
 * (the stored counter is stale once its reset time has passed — the next
 * deduction resets it server-side).
 */
export function tokenStatus(
  plan: string,
  usage: UsageSnapshot,
  now: number = Date.now()
): TokenStatus {
  const planKey: PlanId = resolvePlanId(plan);
  const limits = PLAN_LIMITS[planKey];

  if (planKey === "free") {
    const limit = limits.daily_forge_tokens;
    const reset = usage.dailyResetAt;
    const active = reset != null && now < reset;
    const used = active ? usage.dailyForgeTokens : 0;
    const pctRaw = pctOf(used, limit);
    return finalize(pctRaw, pctRaw >= 100 ? "daily" : null, reset);
  }

  const reset5h =
    usage.window5hOpenedAt != null ? usage.window5hOpenedAt + FIVE_HOURS_MS : null;
  const active5h = reset5h != null && now < reset5h;
  const pct5h = pctOf(active5h ? usage.window5hForgeTokens : 0, limits.window_5h_forge_tokens);

  const resetWeek =
    usage.weeklyOpenedAt != null ? usage.weeklyOpenedAt + WEEK_MS : null;
  const activeWeek = resetWeek != null && now < resetWeek;
  const pctWeek = pctOf(activeWeek ? usage.weeklyForgeTokens : 0, limits.weekly_forge_tokens);

  const blocking = pct5h >= 100 ? "5h" : pctWeek >= 100 ? "weekly" : null;
  const pctRaw = Math.max(pct5h, pct5h >= pctWeek ? pct5h : pctWeek);
  // resetsAt = the binding window when full, else whichever has the higher pct.
  const resetsAt =
    blocking === "5h" ? reset5h : blocking === "weekly" ? resetWeek : pct5h >= pctWeek ? reset5h : resetWeek;
  return finalize(pctRaw, blocking, resetsAt);
}

function finalize(pctRaw: number, blocking: TokenStatus["blocking"], resetsAt: number | null): TokenStatus {
  return {
    pct: Math.min(100, Math.max(0, Math.round(pctRaw))),
    pctRaw,
    remaining: Math.max(0, Math.round(100 - pctRaw)),
    full: pctRaw >= 100,
    blocking,
    resetsAt: resetsAt ?? null,
  };
}

/** Composer indicator level from the unclamped percentage. */
export type IndicatorLevel = "hidden" | "amber" | "orange" | "full";
export function indicatorLevel(pctRaw: number): IndicatorLevel {
  if (pctRaw >= 100) return "full";
  if (pctRaw >= 95) return "orange";
  if (pctRaw >= 80) return "amber";
  return "hidden";
}

/** Progress-bar color (settings): 0-60 green, 61-80 amber, 81-95 orange, 96-100 red. */
export function progressColor(pct: number): string {
  if (pct <= 60) return "var(--ok)";
  if (pct <= 80) return "var(--amber)";
  if (pct <= 95) return "#f97316";
  return "var(--danger)";
}

/** "2hr 14min" (drops the hour when zero). */
export function formatHrMin(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h <= 0) return `${m}min`;
  return `${h}hr ${m}min`;
}

/** "3 days 5hr" (drops days when zero → falls back to hr/min). */
export function formatDaysHr(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  if (d <= 0) return formatHrMin(ms);
  return `${d} day${d === 1 ? "" : "s"} ${h}hr`;
}

/** Integer with thousands separators. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Whole percent label for usage UI. Clamped because bars cap visually at 100%. */
export function formatUsagePercent(pct: number): string {
  const safe = Number.isFinite(pct) ? pct : 0;
  return `${Math.min(100, Math.max(0, Math.round(safe)))}%`;
}

/**
 * Rough token estimate (~4 chars/token) used to bill ONLY a user's own input —
 * their typed message (plus any merged image analysis) — never the fixed system
 * prompt / memory / skills / project context / resent history they don't control.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
