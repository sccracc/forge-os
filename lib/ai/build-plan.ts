// The build agent's plan: what it will do (steps) and how "done" is verified
// (a machine-checkable acceptance checklist). Emitted by the model as a single
// ```forge-plan JSON fence, mirroring the forge-skill / forge-agent protocol.

export interface PlanStep {
  title: string;
  files?: string[];
  detail?: string;
}

export type PlanCheck =
  | { type: "file_exists"; path: string; label?: string }
  | { type: "contains"; path: string; pattern: string; label?: string }
  | { type: "contains_any"; pattern: string; label?: string }
  | { type: "absent_everywhere"; pattern: string; label?: string }
  | { type: "page_count"; count: number; label?: string }
  | { type: "dom_has"; element: string; label?: string }
  | { type: "smoke"; id?: string; label: string; code: string };

export interface BuildPlan {
  summary: string;
  steps: PlanStep[];
  checklist: PlanCheck[];
  assumptions?: string[];
}

const CHECK_TYPES = new Set([
  "file_exists",
  "contains",
  "contains_any",
  "absent_everywhere",
  "page_count",
  "dom_has",
  "smoke",
]);

function extractBlock(text: string): string | null {
  // Prefer a ```forge-plan fence; fall back to the first {...} JSON object.
  const fence = /```(?:forge-plan)\s*\n([\s\S]*?)```/i.exec(text);
  if (fence) return fence[1].trim();
  const brace = /\{[\s\S]*\}/.exec(text);
  return brace ? brace[0] : null;
}

/** Parse a model plan; returns null if no usable plan is present. */
export function parseBuildPlan(text: string): BuildPlan | null {
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

  const steps: PlanStep[] = Array.isArray(o.steps)
    ? o.steps
        .map((s): PlanStep | null => {
          if (!s || typeof s !== "object") return null;
          const st = s as Record<string, unknown>;
          const title = typeof st.title === "string" ? st.title : null;
          if (!title) return null;
          return {
            title,
            files: Array.isArray(st.files) ? st.files.filter((f): f is string => typeof f === "string") : undefined,
            detail: typeof st.detail === "string" ? st.detail : undefined,
          };
        })
        .filter((s): s is PlanStep => s !== null)
    : [];

  const checklist: PlanCheck[] = Array.isArray(o.checklist)
    ? o.checklist.filter((c): c is PlanCheck => {
        if (!c || typeof c !== "object") return false;
        const t = (c as Record<string, unknown>).type;
        return typeof t === "string" && CHECK_TYPES.has(t);
      })
    : [];

  const summary = typeof o.summary === "string" ? o.summary : "";
  const assumptions = Array.isArray(o.assumptions)
    ? o.assumptions.filter((a): a is string => typeof a === "string")
    : undefined;

  if (!summary && steps.length === 0 && checklist.length === 0) return null;
  return { summary, steps, checklist, assumptions };
}

/** Human/model-readable rendering of an acceptance checklist (for the
 *  Verifier's brief — every item is a gate the implementation must satisfy). */
export function checklistToPrompt(checks: PlanCheck[]): string {
  return checks
    .map((c) => {
      switch (c.type) {
        case "file_exists":
          return `- file exists: ${c.path}`;
        case "contains":
          return `- ${c.path} matches /${c.pattern}/i`;
        case "contains_any":
          return `- some project file matches /${c.pattern}/i`;
        case "absent_everywhere":
          return `- NO project file matches /${c.pattern}/i`;
        case "page_count":
          return `- project has ${c.count} HTML page${c.count === 1 ? "" : "s"}`;
        case "dom_has":
          return `- rendered page contains a <${c.element}>`;
        case "smoke":
          return `- smoke test passes: ${c.label}`;
      }
    })
    .join("\n");
}

/** Format the plan as context the execution pass must follow. */
export function planToContext(plan: BuildPlan): string {
  const steps = plan.steps.length
    ? plan.steps
        .map((s, i) => `${i + 1}. ${s.title}${s.files?.length ? ` (${s.files.join(", ")})` : ""}${s.detail ? ` — ${s.detail}` : ""}`)
        .join("\n")
    : "(no explicit steps)";
  return `APPROVED PLAN — implement ALL of it.\n\nGoal: ${plan.summary}\n\nSteps:\n${steps}`;
}
