// Effort levels. Client-safe (no provider identifiers). Each level enforces
// behavior via (a) a system-prompt directive (see ./prompts.ts), (b) a
// max_tokens ceiling, and (c) a provider effort hint passed as a secondary cue.

export const EFFORT = {
  low: { providerEffort: "low", maxTokens: 32000, tempNoThink: 0.8, label: "Low" },
  medium: {
    providerEffort: "medium",
    maxTokens: 64000,
    tempNoThink: 0.7,
    label: "Medium",
  },
  high: {
    providerEffort: "high",
    maxTokens: 128000,
    tempNoThink: 0.55,
    label: "High",
  },
  xhigh: {
    providerEffort: "xhigh",
    maxTokens: 256000,
    tempNoThink: 0.45,
    label: "Extra High",
  },
  max: { providerEffort: "max", maxTokens: 384000, tempNoThink: 0.35, label: "Max" },
} as const;

export type EffortId = keyof typeof EFFORT;

export const EFFORT_IDS = Object.keys(EFFORT) as EffortId[];

export const DEFAULT_EFFORT: EffortId = "low";

export function isEffortId(v: unknown): v is EffortId {
  return typeof v === "string" && v in EFFORT;
}

export function effortLabel(id: EffortId): string {
  return EFFORT[id].label;
}
