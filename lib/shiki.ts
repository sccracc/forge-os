import { codeToHtml } from "shiki";

const CODE_THEME = "github-dark-default";

/**
 * Highlights a code string to molten-themed HTML. Code blocks render on a dark
 * surface in both app themes, so a single dark Shiki theme is used throughout.
 * Lazy-loads only the languages encountered. Falls back to plain text safely.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  const normalized = normalizeLang(lang);
  try {
    return await codeToHtml(code, { lang: normalized, theme: CODE_THEME });
  } catch {
    return codeToHtml(code, { lang: "text", theme: CODE_THEME });
  }
}

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  "c++": "cpp",
  "c#": "csharp",
  md: "markdown",
  text: "text",
  txt: "text",
  plaintext: "text",
};

function normalizeLang(lang: string): string {
  const l = (lang || "text").toLowerCase();
  return ALIASES[l] ?? l;
}
