// Structured per-run logging for the Forge Code agent.
//
// The build dock orchestrates a real multi-stage run (plan → execute → review →
// backstops → verify → heal). This module gives that run a single structured
// trail: every stage, the files it touched, verification results, corrective
// passes, and the final outcome — with timings. It is used for:
//   - dev-time diagnostics (a concise console trace, gated to non-production),
//   - a machine-readable summary that can be attached to the build message.
//
// It deliberately records NO model output / code and NO provider details, so it
// is safe to surface. Pure + dependency-free.

export type AgentStageName =
  | "analyze"
  | "retrieve"
  | "plan"
  | "plan-approval"
  | "execute"
  | "apply"
  | "rewrite"
  | "recover"
  | "review"
  | "fabrication-fix"
  | "consistency-fix"
  | "validate"
  | "verify-strict"
  | "fix"
  | "verify"
  | "heal"
  | "finalize";

export interface AgentStageRecord {
  stage: AgentStageName;
  detail?: string;
  startedAt: number;
  endedAt?: number;
  ms?: number;
  /** Files touched during this stage. */
  files?: string[];
  /** Verification outcome captured at this stage, if any. */
  verify?: { ok: boolean; issues: number };
  ok?: boolean;
}

export interface AgentRunMeta {
  projectId: string;
  effort: string;
  mode: string;
  request: string;
}

export interface AgentRunSummary extends AgentRunMeta {
  startedAt: number;
  endedAt: number;
  ms: number;
  stages: AgentStageRecord[];
  iterations: number;
  outcome: string;
  filesTouched: string[];
}

export interface AgentRunLog {
  /** Open a stage; returns a handle to close it (with optional results). */
  begin(stage: AgentStageName, detail?: string): (result?: Partial<AgentStageRecord>) => void;
  /** Convenience: record a fully-formed stage in one call. */
  record(stage: AgentStageName, result?: Partial<AgentStageRecord>): void;
  /** Record retrieval ranking (top files + how many were summarized). */
  retrieval(includedFull: string[], summarized: string[]): void;
  /** Mark a corrective/heal iteration boundary (for the iteration counter). */
  iteration(): void;
  /** Close the run and emit the dev trace; returns the structured summary. */
  finish(outcome: string, filesTouched: string[]): AgentRunSummary;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createAgentRunLog(meta: AgentRunMeta): AgentRunLog {
  const startedAt = now();
  const stages: AgentStageRecord[] = [];
  let iterations = 0;

  const begin: AgentRunLog["begin"] = (stage, detail) => {
    const rec: AgentStageRecord = { stage, detail, startedAt: now() };
    stages.push(rec);
    return (result) => {
      rec.endedAt = now();
      rec.ms = Math.round(rec.endedAt - rec.startedAt);
      if (result) Object.assign(rec, result);
    };
  };

  const record: AgentRunLog["record"] = (stage, result) => {
    const t = now();
    stages.push({ stage, startedAt: t, endedAt: t, ms: 0, ...result });
  };

  const retrieval: AgentRunLog["retrieval"] = (includedFull, summarized) => {
    record("retrieve", {
      detail: `${includedFull.length} inlined, ${summarized.length} summarized`,
      files: includedFull.slice(0, 12),
      ok: true,
    });
  };

  const iteration = () => {
    iterations++;
  };

  const finish: AgentRunLog["finish"] = (outcome, filesTouched) => {
    const endedAt = now();
    const summary: AgentRunSummary = {
      ...meta,
      startedAt,
      endedAt,
      ms: Math.round(endedAt - startedAt),
      stages,
      iterations,
      outcome,
      filesTouched,
    };
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      try {
        const trail = stages
          .map((s) => `${s.stage}${s.ms != null ? ` ${s.ms}ms` : ""}${s.detail ? ` (${s.detail})` : ""}`)
          .join(" → ");
        console.info(
          `[forge-code] run ${summary.ms}ms · ${outcome} · ${filesTouched.length} files · ${iterations} iters\n  ${trail}`
        );
      } catch {
        /* logging is best-effort */
      }
    }
    return summary;
  };

  return { begin, record, retrieval, iteration, finish };
}
