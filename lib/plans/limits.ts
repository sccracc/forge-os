// Plan limits reference. All plan enforcement (next step) reads from here.
// `null` means "no limit on this axis for this plan" (e.g. paid plans have no
// daily cap; the free plan has no rolling windows).

export const PLAN_LIMITS = {
  free: {
    daily_forge_tokens: 7500,
    window_5h_forge_tokens: null,
    weekly_forge_tokens: null,
    images: 0,
    vision: 0,
    searches: 0,
    documents: 3,
    voice_input_minutes: 0,
    voice_output_chars: 0,
    code_executions: 0,
  },
  starter: {
    daily_forge_tokens: null,
    window_5h_forge_tokens: 150000,
    weekly_forge_tokens: 750000,
    images: 20,
    vision: 30,
    searches: 50,
    documents: 20,
    voice_input_minutes: 45,
    voice_output_chars: 0,
    code_executions: 0,
  },
  pro: {
    daily_forge_tokens: null,
    window_5h_forge_tokens: 500000,
    weekly_forge_tokens: 2500000,
    images: 60,
    vision: 180,
    searches: 400,
    documents: 80,
    voice_input_minutes: 250,
    voice_output_chars: 40000,
    code_executions: 40,
  },
  max: {
    daily_forge_tokens: null,
    window_5h_forge_tokens: 1250000,
    weekly_forge_tokens: 6000000,
    images: 250,
    vision: 400,
    searches: 1500,
    documents: 300,
    voice_input_minutes: 500,
    voice_output_chars: 100000,
    code_executions: 300,
  },
  ultra: {
    daily_forge_tokens: null,
    window_5h_forge_tokens: 2500000,
    weekly_forge_tokens: 12000000,
    images: 600,
    vision: 800,
    searches: 3000,
    documents: 1000,
    voice_input_minutes: 600,
    voice_output_chars: 300000,
    code_executions: 600,
  },
} as const;

export type PlanId = keyof typeof PLAN_LIMITS;

/** Resolve any plan string to a known plan, defaulting unknown values to free. */
export function resolvePlanId(plan: string | null | undefined): PlanId {
  return plan && plan in PLAN_LIMITS ? (plan as PlanId) : "free";
}
