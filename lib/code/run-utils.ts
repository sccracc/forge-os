export type RunnableCodeLanguage = "python" | "javascript";

export function runnableCodeLanguage(value: string): RunnableCodeLanguage | null {
  const normalized = (value || "").toLowerCase();
  if (normalized === "python" || normalized === "py" || normalized.endsWith(".py")) {
    return "python";
  }
  if (
    ["javascript", "js", "mjs", "cjs"].includes(normalized) ||
    /\.(mjs|cjs|js)$/.test(normalized)
  ) {
    return "javascript";
  }
  return null;
}

export function scriptNeedsInput(code: string, language: RunnableCodeLanguage): boolean {
  if (language === "python") {
    return /(^|[^\w.])(?:input|raw_input)\s*\(/.test(code);
  }
  return /(^|[^\w.])prompt\s*\(/.test(code);
}
