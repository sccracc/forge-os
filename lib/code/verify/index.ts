"use client";

import type { FileDoc } from "@/lib/data/types";
import type { PlanCheck } from "@/lib/ai/build-plan";
import { checkReferences, checkSyntax, checkBundle } from "./static-checks";
import { runtimeProbe } from "./runtime-probe";
import { evaluateChecklist, extractSmokeTests } from "./checklist";
import type { VerifyIssue, VerificationReport, VerifyMode } from "./types";

export type { VerifyIssue, VerificationReport, VerifyMode, DomSummary, SmokeResult } from "./types";

function dedupe(issues: VerifyIssue[]): VerifyIssue[] {
  const seen = new Set<string>();
  const out: VerifyIssue[] = [];
  for (const i of issues) {
    const key = `${i.kind}|${i.path ?? ""}|${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out.slice(0, 20);
}

/**
 * Compile + run the project and report real problems, optionally enforcing a
 * plan's acceptance checklist (including scripted smoke tests). Static checks
 * first (cheap); only probe the runtime if it actually compiles.
 */
export async function runVerification(
  files: FileDoc[],
  mode: VerifyMode,
  checklist: PlanCheck[] = []
): Promise<VerificationReport> {
  const issues: VerifyIssue[] = [];

  // 1. References (broken local stylesheet/script/image/page links).
  issues.push(...checkReferences(files));

  // 2. Compile.
  if (mode === "web") issues.push(...(await checkSyntax(files)));
  else issues.push(...(await checkBundle(files, mode)));

  const compiles = !issues.some((i) => i.kind === "compile");

  // 3. Runtime + smoke — only worth it if it compiles.
  let dom = null;
  let smoke: import("./types").SmokeResult[] = [];
  if (compiles) {
    try {
      const probe = await runtimeProbe(files, mode, extractSmokeTests(checklist));
      dom = probe.dom;
      smoke = probe.smoke;
      for (const e of probe.errors) {
        // A logged console.error means it was handled (no crash) — not blocking.
        if (e.source === "console") continue;
        issues.push({
          kind: "runtime",
          path: e.source || undefined,
          message: e.message,
          line: e.line || undefined,
        });
      }
    } catch {
      /* probe is best-effort */
    }
  }

  // 4. Acceptance checklist (only the dom/smoke checks need a successful render;
  //    static checks run regardless so missing files surface even on a failure).
  if (checklist.length) issues.push(...evaluateChecklist(checklist, files, { dom, smoke }));

  const deduped = dedupe(issues);
  return { ok: deduped.length === 0, issues: deduped, dom };
}

/** Turn a verification report into a precise corrective message for the model. */
export function formatIssuesForFix(issues: VerifyIssue[]): string {
  const lines = issues.map((i) => {
    const loc = i.path ? `[${i.path}${i.line ? `:${i.line}` : ""}] ` : "";
    const label =
      i.kind === "compile"
        ? "Build error"
        : i.kind === "runtime"
          ? "Runtime error"
          : i.kind === "check"
            ? "Unmet requirement"
            : "Broken reference";
    return `- ${loc}${label}: ${i.message}`;
  });
  return `I ran the project and it has the following real problems that MUST be fixed:\n${lines.join("\n")}`;
}
