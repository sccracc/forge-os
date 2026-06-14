// Plan feature gates. Pure + client-safe (no server-only / React) so the same
// rules run on the server (enforcement) and the client (UI locks). The gate map
// is the single source of truth for "what does each plan unlock".

import { PLAN_LIMITS, resolvePlanId, type PlanId } from "./limits";
import type { EffortId } from "@/lib/ai/effort";

type FeatureLimitKey = keyof typeof PLAN_LIMITS.free;

const PLAN_NAMES: Record<PlanId, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  max: "Max",
  ultra: "Ultra",
};

const PAID: PlanId[] = ["pro", "max", "ultra"];

// Effort levels unlocked per plan.
const EFFORT_ALLOWED: Record<PlanId, EffortId[]> = {
  free: ["low", "medium"],
  starter: ["low", "medium", "high"],
  pro: ["low", "medium", "high", "xhigh"],
  max: ["low", "medium", "high", "xhigh", "max"],
  ultra: ["low", "medium", "high", "xhigh", "max"],
};

// ---- model / effort / thinking ----
export function canUseModel(plan: string, modelId: string): boolean {
  if (modelId === "magnum-2.8") return PAID.includes(resolvePlanId(plan));
  return true; // spark-2.5 on every plan
}

export function canUseEffort(plan: string, effort: string): boolean {
  return EFFORT_ALLOWED[resolvePlanId(plan)].includes(effort as EffortId);
}

export function canUseThinking(plan: string, modelId: string): boolean {
  const p = resolvePlanId(plan);
  if (p === "free") return false;
  if (p === "starter") return modelId === "spark-2.5"; // no Magnum thinking
  return true; // pro / max / ultra
}

// ---- workspace surfaces ----
export function canUseForgeCode(plan: string): boolean {
  return PAID.includes(resolvePlanId(plan));
}

export function canUseFileSystem(plan: string): boolean {
  return PAID.includes(resolvePlanId(plan));
}

export function canUseProjects(plan: string): boolean {
  return getProjectLimit(plan) !== 0;
}

export function getProjectLimit(plan: string): number | null {
  const p = resolvePlanId(plan);
  if (p === "free" || p === "starter") return 0;
  if (p === "pro") return 20;
  if (p === "max") return 50;
  return null; // ultra — unlimited
}

/** Monthly limit for a per-feature counter (images/vision/searches/…). */
export function getFeatureLimit(plan: string, feature: FeatureLimitKey): number {
  return PLAN_LIMITS[resolvePlanId(plan)][feature] ?? 0;
}

// ---- upgrade messaging ----
// Canonical "minimum plan" for each gateable feature (keyed by lowercased label,
// with aliases). Drives both getRequiredPlan and getUpgradeMessage.
const FEATURE_REQUIRED: Record<string, PlanId> = {
  "magnum 2.8": "pro",
  magnum: "pro",
  model: "pro",
  "thinking mode": "starter",
  thinking: "starter",
  "high effort": "starter",
  "extra high effort": "pro",
  "max effort": "max",
  effort: "pro",
  "forge code": "pro",
  "file system": "pro",
  "file storage": "pro",
  projects: "pro",
  skills: "starter",
  memory: "starter",
  "web search": "starter",
  "image generation": "starter",
  "image understanding": "starter",
  vision: "starter",
  "document analysis": "starter",
  "voice input": "starter",
  "voice output": "pro",
  "code execution": "pro",
  "mcp connectors": "pro",
  "google workspace": "pro",
  "api access": "max",
};

/** Minimum plan id that unlocks a feature (defaults to "pro" if unknown). */
export function getRequiredPlan(feature: string): PlanId {
  return FEATURE_REQUIRED[feature.trim().toLowerCase()] ?? "pro";
}

/** "Web search is available on Starter and above." */
export function getUpgradeMessage(plan: string, feature: string): string {
  const required = getRequiredPlan(feature);
  return `${feature} is available on ${PLAN_NAMES[required]} and above.`;
}

export { PLAN_NAMES };
