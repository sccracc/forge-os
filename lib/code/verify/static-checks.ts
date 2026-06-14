"use client";

import { ensureEsbuild, buildBundle } from "@/lib/code/preview";
import type { FileDoc } from "@/lib/data/types";

export interface StaticIssue {
  kind: "compile" | "ref";
  path?: string;
  message: string;
  line?: number;
}

function fileSet(files: FileDoc[]): Set<string> {
  return new Set(files.filter((f) => f.kind === "file").map((f) => f.path));
}
function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}
function joinPath(base: string, rel: string): string {
  const parts = (base ? base.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
const isExternal = (url: string) =>
  /^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(url) || url.trim() === "";

/**
 * Every local stylesheet/script/image/page reference must point to a file that
 * exists in the project. Pure + regex-based so it's deterministic and testable.
 */
export function checkReferences(files: FileDoc[]): StaticIssue[] {
  const set = fileSet(files);
  const issues: StaticIssue[] = [];
  const seen = new Set<string>();
  const htmls = files.filter((f) => f.kind === "file" && /\.html?$/i.test(f.path));

  const add = (htmlPath: string, ref: string, label: string) => {
    if (isExternal(ref)) return;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) return;
    const target = joinPath(dirOf(htmlPath), clean);
    // Pages may omit .html or resolve to a folder index.
    const candidates = clean.endsWith("/")
      ? [`${target}/index.html`, `${target}index.html`]
      : [target, `${target}.html`, `${target}/index.html`];
    if (candidates.some((c) => set.has(c))) return;
    const key = `${htmlPath}|${clean}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind: "ref", path: htmlPath, message: `${label} not found: "${ref}"` });
  };

  for (const f of htmls) {
    const html = f.content ?? "";
    let m: RegExpExecArray | null;
    const link = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
    while ((m = link.exec(html))) {
      if (/rel=["']stylesheet["']/i.test(m[0])) add(f.path, m[1], "Stylesheet");
    }
    const script = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    while ((m = script.exec(html))) add(f.path, m[1], "Script");
    const img = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    while ((m = img.exec(html))) add(f.path, m[1], "Image");
    const anchor = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
    while ((m = anchor.exec(html))) {
      // Only flag links that clearly target a local page (end in .html or no ext).
      const ref = m[1];
      if (isExternal(ref)) continue;
      if (/\.[a-z0-9]{1,5}$/i.test(ref) && !/\.html?$/i.test(ref)) continue; // asset link, skip
      add(f.path, ref, "Linked page");
    }
  }
  return issues;
}

const SYNTAX_LOADER: Record<string, "js" | "ts" | "jsx" | "tsx"> = {
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
};

/** Per-file syntax check (used for web projects with no bundle step). */
export async function checkSyntax(files: FileDoc[]): Promise<StaticIssue[]> {
  const targets = files.filter((f) => {
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    return f.kind === "file" && ext in SYNTAX_LOADER && (f.content ?? "").trim().length > 0;
  });
  if (targets.length === 0) return [];
  let esbuild;
  try {
    esbuild = await ensureEsbuild();
  } catch {
    return []; // esbuild unavailable → skip syntax check (best-effort)
  }
  const issues: StaticIssue[] = [];
  for (const f of targets) {
    const ext = f.path.split(".").pop()!.toLowerCase();
    try {
      await esbuild.transform(f.content ?? "", { loader: SYNTAX_LOADER[ext], logLevel: "silent" });
    } catch (e) {
      const errs = (e as { errors?: { text: string; location?: { line: number } }[] }).errors;
      if (errs && errs.length) {
        for (const er of errs.slice(0, 4)) {
          issues.push({ kind: "compile", path: f.path, message: er.text, line: er.location?.line });
        }
      } else {
        issues.push({ kind: "compile", path: f.path, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return issues;
}

/** Bundle check for React/Vue projects — surfaces real build errors. */
export async function checkBundle(files: FileDoc[], kind: "react" | "vue"): Promise<StaticIssue[]> {
  try {
    await ensureEsbuild();
  } catch {
    return []; // bundler infra unavailable → don't report a phantom build error
  }
  const { error } = await buildBundle(files, kind);
  return error ? [{ kind: "compile", message: error }] : [];
}
