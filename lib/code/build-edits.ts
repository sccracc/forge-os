// Search/replace edit protocol for Forge Code build mode. Instead of re-emitting
// a whole file to change a few lines, the model emits one ```edit=<path> block
// containing one or more hunks:
//
//   ```edit=style.css
//   <<<<<<< SEARCH
//   .logo { color: #888; }
//   =======
//   .logo { color: #ff7a1a; }
//   >>>>>>> REPLACE
//   ```
//
// This is what makes targeted edits reliable (and stops the model getting lazy
// and only narrating a change without writing it).

export interface EditHunk {
  search: string;
  replace: string;
}

const isSearch = (l: string) => /^<{3,}\s*SEARCH\s*$/.test(l.trim());
const isDivider = (l: string) => /^={3,}\s*$/.test(l.trim());
const isReplace = (l: string) => /^>{3,}\s*REPLACE\s*$/.test(l.trim());

/** Parse the hunks inside an `edit=` block body. Tolerant of marker length.
 *  `lenient` also returns the final in-progress hunk (SEARCH + DIVIDER seen,
 *  REPLACE still streaming) — used only for the LIVE diff estimate, never for
 *  the actual write. */
export function parseEditHunks(body: string, lenient = false): EditHunk[] {
  const lines = body.split("\n");
  const hunks: EditHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isSearch(lines[i])) {
      i++;
      continue;
    }
    i++;
    const search: string[] = [];
    while (i < lines.length && !isDivider(lines[i])) search.push(lines[i++]);
    if (i >= lines.length) break; // SEARCH still streaming → can't form a hunk yet
    i++; // skip divider
    const replace: string[] = [];
    while (i < lines.length && !isReplace(lines[i])) replace.push(lines[i++]);
    const closed = i < lines.length;
    i++; // skip replace marker
    if (closed || lenient) hunks.push({ search: search.join("\n"), replace: replace.join("\n") });
  }
  return hunks;
}

// Tolerates trailing spaces/tabs AND a trailing \r, so CRLF files (e.g. code
// imported from Windows) still match the model's \n-only SEARCH text.
const trimEnd = (s: string) => s.replace(/[ \t\r]+$/g, "");

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length || 1;
    if (count > 1) break; // only "0", "1", or "many" matters
  }
  return count;
}

/** Apply one hunk; returns the new content, or null if SEARCH wasn't found —
 *  or matched MORE THAN ONCE. An ambiguous SEARCH must fail rather than
 *  silently edit the first (possibly wrong) location; the recovery pass then
 *  asks the model for a more specific hunk. */
export function applyOneHunk(content: string, search: string, replace: string): string | null {
  if (search === "") return content === "" ? replace : null;
  // Exact match first.
  const exact = countOccurrences(content, search);
  if (exact === 1) return content.replace(search, replace);
  if (exact > 1) return null; // ambiguous — refuse to guess
  // Loose match: tolerate trailing-whitespace/CR differences line by line.
  const cLines = content.split("\n");
  const sLines = search.split("\n").map(trimEnd);
  let matchAt = -1;
  for (let i = 0; i + sLines.length <= cLines.length; i++) {
    let ok = true;
    for (let j = 0; j < sLines.length; j++) {
      if (trimEnd(cLines[i + j]) !== sLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (matchAt !== -1) return null; // second loose match — ambiguous
      matchAt = i;
    }
  }
  if (matchAt !== -1) {
    return [
      ...cLines.slice(0, matchAt),
      ...replace.split("\n"),
      ...cLines.slice(matchAt + sLines.length),
    ].join("\n");
  }
  return null;
}

/** Apply hunks sequentially. Failed hunks are no-ops (counted, not fatal). */
export function applyEdits(
  original: string,
  hunks: EditHunk[]
): { content: string; applied: number; failed: number } {
  let content = original;
  let applied = 0;
  let failed = 0;
  for (const h of hunks) {
    const next = applyOneHunk(content, h.search, h.replace);
    if (next === null) failed++;
    else {
      content = next;
      applied++;
    }
  }
  return { content, applied, failed };
}
