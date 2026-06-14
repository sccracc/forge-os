// Deterministic cross-file consistency backstop for explicit renames.
// When the user says e.g. "rename Forge to FireMaker" or 'change "X" to "Y"',
// we extract the OLD term and, after the build, check every file for leftovers.
// If the old term still appears anywhere, a corrective pass updates the rest —
// so a rename can't silently land in just one file.

// Common UI / HTML words that are almost never a brand rename — excluded to
// avoid false positives (e.g. "change the Header to …").
const STOP = new Set([
  "the", "this", "that", "it", "name", "title", "color", "colour", "text", "page",
  "site", "website", "app", "button", "header", "footer", "nav", "navbar", "logo",
  "theme", "value", "word", "words", "list", "font", "size", "background", "layout",
  "style", "styles", "image", "link", "menu", "section", "hero", "card", "everything",
]);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Extract OLD terms from explicit rename phrasing. Only confident matches
 *  (quoted, or a capitalized brand-like token) to avoid false positives. */
export function extractRenames(request: string): string[] {
  const out = new Set<string>();
  const add = (t: string | undefined) => {
    const v = (t ?? "").trim();
    if (v.length >= 2 && v.length <= 40 && !STOP.has(v.toLowerCase())) out.add(v);
  };
  const patterns: RegExp[] = [
    // change/rename/replace "X" to/with/into …
    /\b(?:rename|replace|change|switch|update)\s+["'`]([^"'`\n]{2,40})["'`]\s+(?:to|with|into)\b/gi,
    // rename Forge to …  /  change the brand Forge to …
    /\b(?:rename|replace|change|switch|update)\s+(?:the\s+[a-z]+\s+)?([A-Z][A-Za-z0-9][\w.-]{1,30})\s+(?:to|with|into)\b/g,
    // from X to …
    /\bfrom\s+["'`]?([A-Za-z0-9][\w.-]{1,40}?)["'`]?\s+to\b/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(request)) !== null) add(m[1]);
  }
  return [...out].slice(0, 4);
}

export interface StaleTerm {
  term: string;
  paths: string[];
}

/** Files (by path) that still contain any of the old terms (whole-word, case-insensitive). */
export function staleTermFiles(
  terms: string[],
  files: { path: string; content: string }[]
): StaleTerm[] {
  const out: StaleTerm[] = [];
  for (const term of terms) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
    const paths = files.filter((f) => re.test(f.content)).map((f) => f.path);
    if (paths.length) out.push({ term, paths });
  }
  return out;
}
