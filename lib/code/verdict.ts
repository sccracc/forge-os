// The Verifier agent's machine-readable verdict.
//
// The Verifier is a SEPARATE, stricter agent pass (mode "code-verify"). It is
// given the original request, the plan, the unified diffs of what changed, and
// the current contents of the touched files, and it returns a structured
// verdict: PASS, or FAIL with a concrete issue list. The Fixer consumes those
// issues. This is what turns "review" from a vibe into an enforceable gate.
//
// Protocol: the model emits one ```forge-verdict JSON fence:
//   {
//     "status": "pass" | "fail",
//     "summary": "one line",
//     "issues": [
//       { "severity": "critical"|"major"|"minor",
//         "file": "path (optional)",
//         "category": "missing-import|broken-logic|incomplete|regression|security|type|edge-case|dead-code|integration|other",
//         "title": "short",
//         "detail": "what's wrong + why",
//         "fix": "concrete fix instruction" }
//     ]
//   }

export type VerdictSeverity = "critical" | "major" | "minor";

export type VerdictCategory =
  | "missing-import"
  | "broken-logic"
  | "incomplete"
  | "regression"
  | "security"
  | "type"
  | "edge-case"
  | "dead-code"
  | "integration"
  | "other";

export interface VerdictIssue {
  severity: VerdictSeverity;
  category: VerdictCategory;
  title: string;
  detail: string;
  fix: string;
  file?: string;
}

export interface Verdict {
  status: "pass" | "fail";
  summary: string;
  issues: VerdictIssue[];
}

const SEVERITIES: VerdictSeverity[] = ["critical", "major", "minor"];
const CATEGORIES: VerdictCategory[] = [
  "missing-import", "broken-logic", "incomplete", "regression", "security",
  "type", "edge-case", "dead-code", "integration", "other",
];

function extractBlock(text: string): string | null {
  const fence = /```(?:forge-verdict)\s*\n([\s\S]*?)```/i.exec(text);
  if (fence) return fence[1].trim();
  const brace = /\{[\s\S]*\}/.exec(text);
  return brace ? brace[0] : null;
}

const asStr = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/**
 * Parse a Verifier verdict. A missing/unparseable block is treated as a soft
 * PASS (the runtime verifier is the hard gate), so a malformed verifier turn
 * can never wedge the loop — it just doesn't add new issues.
 */
export function parseVerdict(text: string): Verdict | null {
  const raw = extractBlock(text);
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const issues: VerdictIssue[] = Array.isArray(o.issues)
    ? o.issues
        .map((i): VerdictIssue | null => {
          if (!i || typeof i !== "object") return null;
          const it = i as Record<string, unknown>;
          const title = asStr(it.title).trim();
          if (!title) return null;
          const severity = SEVERITIES.includes(it.severity as VerdictSeverity)
            ? (it.severity as VerdictSeverity)
            : "major";
          const category = CATEGORIES.includes(it.category as VerdictCategory)
            ? (it.category as VerdictCategory)
            : "other";
          return {
            severity,
            category,
            title,
            detail: asStr(it.detail),
            fix: asStr(it.fix),
            file: asStr(it.file) || undefined,
          };
        })
        .filter((i): i is VerdictIssue => i !== null)
    : [];

  // A verdict only fails when it lists at least one actionable issue. This keeps
  // the self-correction loop honest: a content-free "fail" gives the Fixer
  // nothing to do, so it is treated as a pass; any real issue forces a fail even
  // if the model optimistically said "pass".
  const status: Verdict["status"] = issues.length > 0 ? "fail" : "pass";
  return { status, summary: asStr(o.summary), issues };
}

/** Severity rank for sorting (critical first). */
function rank(s: VerdictSeverity): number {
  return s === "critical" ? 0 : s === "major" ? 1 : 2;
}

/** Sort issues critical → minor for display + fixing priority. */
export function sortIssues(issues: VerdictIssue[]): VerdictIssue[] {
  return [...issues].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** Turn a verdict's issues into a precise corrective brief for the Fixer. */
export function formatVerdictForFix(verdict: Verdict): string {
  const lines = sortIssues(verdict.issues).map((i, n) => {
    const loc = i.file ? ` [${i.file}]` : "";
    return `${n + 1}. (${i.severity}/${i.category})${loc} ${i.title}\n   Problem: ${i.detail}\n   Fix: ${i.fix}`;
  });
  return [
    "The Verifier reviewed your implementation against the request and the diffs and found these REAL problems. Fix every one of them now:",
    ...lines,
  ].join("\n");
}
