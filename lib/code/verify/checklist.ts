"use client";

import type { FileDoc } from "@/lib/data/types";
import type { PlanCheck } from "@/lib/ai/build-plan";
import type { DomSummary, SmokeResult, VerifyIssue } from "./types";

export interface SmokeTest {
  id: string;
  label: string;
  code: string;
}

/** Pull the runnable smoke tests out of a plan's checklist. */
export function extractSmokeTests(checklist: PlanCheck[]): SmokeTest[] {
  const out: SmokeTest[] = [];
  checklist.forEach((c, i) => {
    if (c.type === "smoke" && typeof c.code === "string" && c.code.trim()) {
      out.push({ id: c.id || `smoke-${i}`, label: c.label || `Smoke test ${i + 1}`, code: c.code });
    }
  });
  return out;
}

function domHas(dom: DomSummary | null, element: string): boolean {
  if (!dom) return false;
  const c = dom.counts || {};
  switch (element.toLowerCase()) {
    case "form":
      return (c.forms ?? 0) > 0;
    case "button":
      return (c.buttons ?? 0) > 0;
    case "canvas":
      return (c.canvases ?? 0) > 0;
    case "input":
    case "field":
      return (c.inputs ?? 0) > 0;
    case "img":
    case "image":
      return (c.images ?? 0) > 0;
    case "a":
    case "link":
      return (c.links ?? 0) > 0;
    case "heading":
    case "h1":
    case "title":
      return dom.headings.length > 0 || dom.title.trim().length > 0;
    default:
      return false;
  }
}

/**
 * Evaluate a plan's acceptance checklist against the built project. Each failed
 * check becomes an issue the heal loop must resolve — this is what guarantees
 * the agent actually finishes everything it planned.
 */
export function evaluateChecklist(
  checklist: PlanCheck[],
  files: FileDoc[],
  ctx: { dom: DomSummary | null; smoke: SmokeResult[] }
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const fileFiles = files.filter((f) => f.kind === "file");
  const contentOf = (path: string) => fileFiles.find((f) => f.path === path)?.content ?? null;
  const allText = fileFiles.map((f) => `<<${f.path}>>\n${f.content ?? ""}`).join("\n\n");
  const pageCount = fileFiles.filter((f) => /\.html?$/i.test(f.path)).length;
  const smokeById = new Map(ctx.smoke.map((s) => [s.id, s]));

  let smokeIdx = 0;
  for (const c of checklist) {
    try {
      if (c.type === "file_exists") {
        if (contentOf(c.path) === null)
          issues.push({ kind: "check", message: c.label ?? `Required file is missing: ${c.path}` });
      } else if (c.type === "contains") {
        const t = contentOf(c.path);
        if (t === null || !new RegExp(c.pattern, "i").test(t))
          issues.push({ kind: "check", path: c.path, message: c.label ?? `${c.path} must contain "${c.pattern}"` });
      } else if (c.type === "contains_any") {
        if (!new RegExp(c.pattern, "i").test(allText))
          issues.push({ kind: "check", message: c.label ?? `Project must contain "${c.pattern}"` });
      } else if (c.type === "absent_everywhere") {
        if (new RegExp(c.pattern, "i").test(allText))
          issues.push({ kind: "check", message: c.label ?? `"${c.pattern}" should no longer appear anywhere, but it still does` });
      } else if (c.type === "page_count") {
        if (pageCount < c.count)
          issues.push({ kind: "check", message: c.label ?? `Expected at least ${c.count} pages, but found ${pageCount}` });
      } else if (c.type === "dom_has") {
        // Skip if we couldn't render (a compile error elsewhere blocks first).
        if (ctx.dom && !domHas(ctx.dom, c.element))
          issues.push({ kind: "check", message: c.label ?? `The page should render a <${c.element}>, but none was found` });
      } else if (c.type === "smoke") {
        const id = c.id || `smoke-${checklist.indexOf(c)}`;
        const res = smokeById.get(id) ?? ctx.smoke[smokeIdx];
        smokeIdx++;
        if (ctx.dom && res && !res.ok)
          issues.push({ kind: "check", message: `${c.label}${res.error ? ` — ${res.error}` : " — assertion failed"}` });
      }
    } catch {
      /* malformed check (e.g. bad regex) → ignore it rather than block */
    }
  }
  return issues;
}
