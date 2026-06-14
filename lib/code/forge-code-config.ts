// Centralized Forge Code agent configuration.
//
// This is the single source of truth for how the Forge Code coding agent is
// tuned. It is intentionally provider-free (just numbers / booleans) so it can
// be imported by BOTH the server (the chat route) and the client (the build
// dock orchestrator) without leaking any implementation details.
//
// OUTPUT TOKEN POLICY (non-negotiable):
//   Forge Code ALWAYS generates with the maximum output budget, regardless of
//   the user's effort level. A coding agent must be free to emit a complete,
//   untruncated file or set of files in one pass; throttling output by effort
//   produces half-written code and broken builds. Effort therefore controls how
//   HARD the agent works (planning depth, verification depth, iteration count,
//   retrieval aggressiveness) — never how MUCH it is allowed to write.
//
//   Every Forge Code model call inherits FORGE_CODE_MAX_OUTPUT_TOKENS. See
//   lib/ai/provider.ts (max_tokens) and app/api/chat/route.ts (where the cap is
//   applied for any code-* mode).

import type { EffortId } from "@/lib/ai/effort";

/** The fixed output-token ceiling for ALL Forge Code model calls. */
export const FORGE_CODE_MAX_OUTPUT_TOKENS = 384_000;

/** Forge Code chat-route modes (everything that should get the fixed cap). */
export const FORGE_CODE_MODES = ["code-build", "code-discuss", "code-plan", "code-verify"] as const;
export type ForgeCodeMode = (typeof FORGE_CODE_MODES)[number];

/** True when a chat-route `mode` is a Forge Code mode (gets the fixed cap). */
export function isForgeCodeMode(mode: string | undefined | null): mode is ForgeCodeMode {
  return (
    mode === "code-build" ||
    mode === "code-discuss" ||
    mode === "code-plan" ||
    mode === "code-verify"
  );
}

/**
 * Per-effort tuning for the coding agent. Effort scales DEPTH, not output size:
 *  - planning:        run the dedicated planning pass before executing?
 *  - planTimeoutMs:   hard ceiling on the (bounded, best-effort) planning pass.
 *  - reviewPass:      run the automatic self-review pass after executing?
 *  - selfCorrectIterations: max Verifier → Fixer → re-verify cycles. Each cycle
 *                     is several model calls, so this is the single biggest cost
 *                     driver — kept deliberately small (2–4) and backed by a
 *                     convergence guard + a hard token budget so a build can
 *                     never run away with your usage.
 *  - buildTokenBudget: HARD ceiling on forge tokens a single build may spend.
 *                     The self-correction loop stops the moment a build crosses
 *                     it, even mid-review — your usage is protected over
 *                     squeezing out one more fix.
 *  - verifyHeals:     max compile/run → fix → re-verify iterations (legacy inner
 *                     runtime-only heal budget, used within a cycle).
 *  - maxCorrectivePasses: ceiling on total corrective/self-correction passes in
 *                     a single run (no-file-ops recovery, fabrication, rename,
 *                     review — shared budget so a run can't spin forever).
 *  - retrievalBudgetBytes: how much file CONTENT (bytes) retrieval may spend on
 *                     fully-included relevant files. The file TREE is always
 *                     included on top of this, for free.
 *  - retrievalMaxFullFiles: cap on how many files get their full contents
 *                     inlined; the rest are summarized as signatures.
 *  - retrievalNeighborDepth: how far to expand along the import/reference graph
 *                     from files the request points at.
 */
export interface ForgeCodeEffortProfile {
  planning: boolean;
  planTimeoutMs: number;
  reviewPass: boolean;
  selfCorrectIterations: number;
  buildTokenBudget: number;
  verifyHeals: number;
  maxCorrectivePasses: number;
  retrievalBudgetBytes: number;
  retrievalMaxFullFiles: number;
  retrievalNeighborDepth: number;
}

const PROFILES: Record<EffortId, ForgeCodeEffortProfile> = {
  // Iteration counts are kept SMALL on purpose: each self-correction cycle is
  // several model calls, and an unbounded loop is what blew through a 5-hour
  // usage window. The convergence guard + buildTokenBudget are the hard stops.
  low: {
    planning: true,
    planTimeoutMs: 15_000,
    reviewPass: true,
    selfCorrectIterations: 2,
    buildTokenBudget: 60_000,
    verifyHeals: 1,
    maxCorrectivePasses: 3,
    retrievalBudgetBytes: 90_000,
    retrievalMaxFullFiles: 30,
    retrievalNeighborDepth: 1,
  },
  medium: {
    planning: true,
    planTimeoutMs: 20_000,
    reviewPass: true,
    selfCorrectIterations: 2,
    buildTokenBudget: 90_000,
    verifyHeals: 2,
    maxCorrectivePasses: 4,
    retrievalBudgetBytes: 120_000,
    retrievalMaxFullFiles: 45,
    retrievalNeighborDepth: 1,
  },
  high: {
    planning: true,
    planTimeoutMs: 25_000,
    reviewPass: true,
    selfCorrectIterations: 3,
    buildTokenBudget: 140_000,
    verifyHeals: 2,
    maxCorrectivePasses: 5,
    retrievalBudgetBytes: 160_000,
    retrievalMaxFullFiles: 65,
    retrievalNeighborDepth: 2,
  },
  xhigh: {
    planning: true,
    planTimeoutMs: 30_000,
    reviewPass: true,
    selfCorrectIterations: 3,
    buildTokenBudget: 180_000,
    verifyHeals: 2,
    maxCorrectivePasses: 6,
    retrievalBudgetBytes: 200_000,
    retrievalMaxFullFiles: 90,
    retrievalNeighborDepth: 2,
  },
  max: {
    planning: true,
    planTimeoutMs: 35_000,
    reviewPass: true,
    selfCorrectIterations: 4,
    buildTokenBudget: 250_000,
    verifyHeals: 3,
    maxCorrectivePasses: 8,
    retrievalBudgetBytes: 260_000,
    retrievalMaxFullFiles: 140,
    retrievalNeighborDepth: 3,
  },
};

/** Resolve the agent tuning profile for an effort level. */
export function forgeCodeEffortProfile(effort: EffortId): ForgeCodeEffortProfile {
  return PROFILES[effort] ?? PROFILES.low;
}
