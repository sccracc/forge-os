// Deterministic backstop for the #1 failure mode: the model narrates a huge
// dataset ("~20,000 words") but doesn't actually produce it — it types a few
// hundred, fakes it with "// ...more...", or just lies. We can't trust the
// narration, so we inspect the written files and flag fabrication. When flagged,
// the build dock forces a corrective pass that loads the data via runtime fetch.

const PLACEHOLDERS: RegExp[] = [
  /(?:\.\.\.|…)\s*\(?\s*(?:and\s+)?(?:\d[\d,]*\s*\+?\s*)?(?:more|rest|other|additional)\b/i,
  /\b(?:add|insert|include|paste)\s+(?:the\s+)?(?:rest|remaining|other|full|complete)\b/i,
  /\b(?:rest|remainder)\s+(?:of\s+(?:the\s+)?)?(?:words?|list|entries|guesses|items)\b/i,
  /\b\d[\d,]{2,}\s*\+?\s*more\b/i,
  /\b(?:and so on|truncated for brevity|list (?:truncated|omitted)|full list omitted)\b/i,
  /(?:\/\/|\/\*|#)\s*(?:\.\.\.|…)\s*$/m,
];

const CODE_FILE = /\.(?:js|mjs|cjs|ts|tsx|jsx|json|html?)$/i;

/** Largest dataset size the prose explicitly claims (>= used by the caller). */
export function claimedCount(prose: string): number {
  let max = 0;
  // Scoped to the word-list domain (the demonstrated failure mode) to avoid
  // false-positives on legitimate inline numeric/object datasets.
  const re = /(\d[\d,]{2,})\s*\+?\s*(?:[a-z-]+\s+){0,2}(?:words?|guesses|vocabulary)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prose)) !== null) {
    const n = parseInt(m[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return max;
}

/** Rough count of list-entry-like string literals in a file. */
function quotedTokenCount(content: string): number {
  const m = content.match(/(["'])[A-Za-z][A-Za-z'-]{0,18}\1/g);
  return m ? m.length : 0;
}

function loadsDataAtRuntime(content: string): boolean {
  return /\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|\baxios\b|requestAnimationFrame\s*$|\.json\s*\(\)/.test(content);
}

/**
 * Returns a short reason string if the turn fabricated/over-claimed bulk data,
 * else null. Conservative — only fires when confident.
 */
export function detectFabricatedData(
  prose: string,
  files: { path: string; content: string }[]
): string | null {
  const code = files.filter((f) => CODE_FILE.test(f.path));
  if (code.length === 0) return null;

  // 1. Explicit placeholder / "rest omitted" markers in written code.
  for (const f of code) {
    if (PLACEHOLDERS.some((re) => re.test(f.content))) {
      return `placeholder/omitted data in ${f.path}`;
    }
  }

  // 2. A large claimed count that isn't actually present and isn't fetched.
  const claimed = claimedCount(prose);
  if (claimed >= 1000) {
    const anyFetch = code.some((f) => loadsDataAtRuntime(f.content));
    if (!anyFetch) {
      const tokens = code.reduce((n, f) => n + quotedTokenCount(f.content), 0);
      if (tokens < claimed / 4) {
        return `claimed ~${claimed} entries but ~${tokens} present and no runtime fetch`;
      }
    }
  }

  return null;
}
