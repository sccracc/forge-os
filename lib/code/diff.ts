// Unified-diff generation for Forge Code's diff awareness.
//
// After the agent edits files, the orchestrator generates a real unified diff
// for every changed file and feeds it into the Verifier (and the Fixer). This
// is what makes verification diff-aware: the verifier reviews WHAT CHANGED, not
// just the final file, so it can catch regressions, half-applied edits, and
// missing work instead of re-reading everything blind.
//
// Pure + dependency-free (LCS-based), with hard caps so a huge rewrite can't
// blow up the context.

export interface FileDiff {
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  added: number;
  removed: number;
  /** Unified-diff text (`@@` hunks), capped for context safety. */
  patch: string;
}

const splitLines = (t: string): string[] => (t === "" ? [] : t.replace(/\n$/, "").split("\n"));

/** Longest-common-subsequence backtrack → minimal add/remove edit script. */
function diffLines(a: string[], b: string[]): Array<{ tag: " " | "-" | "+"; line: string }> {
  const n = a.length;
  const m = b.length;
  // Guard: very large pairs fall back to a coarse replace-all to stay cheap.
  if (n * m > 4_000_000) {
    return [
      ...a.map((line) => ({ tag: "-" as const, line })),
      ...b.map((line) => ({ tag: "+" as const, line })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ tag: " " | "-" | "+"; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ tag: " ", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ tag: "-", line: a[i++] });
    } else {
      out.push({ tag: "+", line: b[j++] });
    }
  }
  while (i < n) out.push({ tag: "-", line: a[i++] });
  while (j < m) out.push({ tag: "+", line: b[j++] });
  return out;
}

/** Group an edit script into unified-diff hunks with `context` lines around changes. */
function toHunks(
  script: Array<{ tag: " " | "-" | "+"; line: string }>,
  context = 3,
  maxLines = 400
): { patch: string; added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const s of script) {
    if (s.tag === "+") added++;
    else if (s.tag === "-") removed++;
  }

  // Indices of changed lines; build hunks spanning changes + context.
  const changed = script.map((s) => s.tag !== " ");
  const hunkLines: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  // Track source line numbers as we walk.
  const positions = script.map((s) => {
    const pos = { old: oldLine, new: newLine };
    if (s.tag !== "+") oldLine++;
    if (s.tag !== "-") newLine++;
    return pos;
  });

  let idx = 0;
  let emitted = 0;
  while (idx < script.length && emitted < maxLines) {
    if (!changed[idx]) {
      idx++;
      continue;
    }
    // Expand window: context before, the contiguous change run, context after.
    const start = Math.max(0, idx - context);
    let end = idx;
    while (end < script.length && (changed[end] || end - lastChange(changed, end) <= context)) end++;
    end = Math.min(script.length, end);

    const slice = script.slice(start, end);
    const oldStart = positions[start]?.old ?? 1;
    const newStart = positions[start]?.new ?? 1;
    const oldCount = slice.filter((s) => s.tag !== "+").length;
    const newCount = slice.filter((s) => s.tag !== "-").length;
    hunkLines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const s of slice) {
      hunkLines.push(`${s.tag}${s.line}`);
      emitted++;
      if (emitted >= maxLines) {
        hunkLines.push("… (diff truncated)");
        break;
      }
    }
    idx = end;
  }

  return { patch: hunkLines.join("\n"), added, removed };
}

function lastChange(changed: boolean[], from: number): number {
  for (let k = from; k >= 0; k--) if (changed[k]) return k;
  return from;
}

/** Build a unified diff for a single file (before → after). */
export function fileDiff(path: string, before: string, after: string): FileDiff {
  const isNew = before === "" || before === undefined;
  const isDeleted = after === "" || after === undefined;
  const script = diffLines(splitLines(before ?? ""), splitLines(after ?? ""));
  const { patch, added, removed } = toHunks(script);
  return { path, isNew: isNew && !isDeleted, isDeleted: isDeleted && !isNew, added, removed, patch };
}

/** Build diffs for a set of changed files (before/after maps). */
export function buildDiffs(
  paths: string[],
  before: Map<string, string>,
  after: Map<string, string>
): FileDiff[] {
  return paths
    .map((p) => fileDiff(p, before.get(p) ?? "", after.get(p) ?? ""))
    .filter((d) => d.added > 0 || d.removed > 0 || d.isNew || d.isDeleted);
}

/** Render diffs as a compact, model-readable block for verifier/fixer prompts. */
export function formatDiffsForPrompt(diffs: FileDiff[], maxBytes = 24_000): string {
  if (!diffs.length) return "(no file changes were produced)";
  const blocks: string[] = [];
  let budget = maxBytes;
  for (const d of diffs) {
    const tag = d.isNew ? " (new file)" : d.isDeleted ? " (deleted)" : "";
    const header = `--- a/${d.path}\n+++ b/${d.path}${tag}  [+${d.added} −${d.removed}]`;
    const block = `${header}\n${d.patch}`;
    if (budget - block.length < 0) {
      blocks.push(`${header}\n… (diff omitted — context budget reached)`);
      continue;
    }
    budget -= block.length;
    blocks.push(block);
  }
  return blocks.join("\n\n");
}
