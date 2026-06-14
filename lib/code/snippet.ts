// Helpers for chat code blocks: download filename, whether a snippet can be
// rendered as a live preview, and wrapping a fragment into a full HTML doc.

import { injectStorageShim } from "./sandbox-shim";

const EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "svg",
  css: "css",
  scss: "scss",
  less: "less",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  markdown: "md",
  md: "md",
  mdx: "mdx",
  yaml: "yml",
  yml: "yml",
  toml: "toml",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  cs: "cs",
  go: "go",
  rust: "rs",
  rs: "rs",
  ruby: "rb",
  rb: "rb",
  php: "php",
  sql: "sql",
  text: "txt",
  plaintext: "txt",
};

export function langToExt(lang: string): string {
  return EXT[(lang || "").toLowerCase()] ?? "txt";
}

export function defaultFilename(lang: string): string {
  const ext = langToExt(lang);
  const base = ext === "html" ? "index" : "snippet";
  return `${base}.${ext}`;
}

/** A snippet is previewable if it's HTML/SVG, by language or by content. */
export function isPreviewable(lang: string, code: string): boolean {
  const l = (lang || "").toLowerCase();
  if (["html", "htm", "xml", "svg"].includes(l)) return true;
  return /<!doctype html|<html[\s>]|<svg[\s>]/i.test(code);
}

/** Whether a code block should render as a Claude-style artifact card (vs.
 *  inline). Previewable content always does; other real code does once it's a
 *  few lines. Plain prose / tiny snippets stay inline. The threshold only
 *  grows during streaming, so a block never flips back to inline. */
export function isArtifactCode(lang: string, code: string): boolean {
  if (isPreviewable(lang, code)) return true;
  const l = (lang || "").toLowerCase();
  const inline = ["", "text", "plaintext", "markdown", "md", "mdx", "diff", "shell", "bash", "sh", "zsh", "console", "powershell", "ps1"];
  if (inline.includes(l)) return false;
  return code.split("\n").length >= 4;
}

/** Wrap a fragment into a full, self-contained HTML document for preview. The
 *  storage shim is injected so localStorage/sessionStorage don't throw in the
 *  opaque-origin sandbox (otherwise the previewed script dies on load). */
export function wrapPreviewDoc(code: string): string {
  if (/<html[\s>]/i.test(code) || /<!doctype/i.test(code)) return injectStorageShim(code);
  return injectStorageShim(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1" /><style>body{font-family:system-ui,-apple-system,sans-serif;margin:1rem;}</style></head><body>${code}</body></html>`
  );
}
