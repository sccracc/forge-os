// Parses a Forge Code "build" stream into narration + per-file operations
// WITHOUT ever surfacing the generated code. Files are emitted as fenced blocks:
//   ```path=<path>   … full file contents …        ``` (write a whole file)
//   ```edit=<path>   … <<<<<<< SEARCH/REPLACE …     ``` (targeted edit)
// The trailing block may still be streaming (done:false).

import { parseEditHunks, applyEdits } from "./build-edits";

const WRITE_OPEN = "```path=";
const EDIT_OPEN = "```edit=";

export type BuildOpMode = "write" | "edit";

export interface ParsedBuildFile {
  path: string;
  mode: BuildOpMode;
  /** write: full file contents; edit: raw hunk body. */
  content: string;
  done: boolean;
}

export interface BuildStreamParse {
  /** Narration / plan text, with all code stripped out. */
  prose: string;
  /** Files in the order the model emitted them. */
  files: ParsedBuildFile[];
}

/** Remove fenced code blocks (complete + a trailing unterminated one) so the
 *  visible narration never leaks code. Inline code (single backticks) stays. */
function stripFences(text: string): string {
  let out = text.replace(/```[\s\S]*?```/g, "");
  const open = out.lastIndexOf("```");
  if (open !== -1) out = out.slice(0, open);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function nextOpen(
  text: string,
  cursor: number
): { idx: number; mode: BuildOpMode; len: number } | null {
  const w = text.indexOf(WRITE_OPEN, cursor);
  const e = text.indexOf(EDIT_OPEN, cursor);
  if (w === -1 && e === -1) return null;
  if (e === -1 || (w !== -1 && w < e)) return { idx: w, mode: "write", len: WRITE_OPEN.length };
  return { idx: e, mode: "edit", len: EDIT_OPEN.length };
}

export function parseBuildStream(text: string): BuildStreamParse {
  const files: ParsedBuildFile[] = [];
  let prose = "";
  let cursor = 0;

  for (;;) {
    const nx = nextOpen(text, cursor);
    if (!nx) {
      prose += text.slice(cursor);
      break;
    }
    prose += text.slice(cursor, nx.idx);
    const nl = text.indexOf("\n", nx.idx);
    if (nl === -1) {
      const path = text.slice(nx.idx + nx.len).trim();
      if (path) files.push({ path, mode: nx.mode, content: "", done: false });
      cursor = text.length;
      break;
    }
    const path = text.slice(nx.idx + nx.len, nl).trim();
    const close = text.indexOf("```", nl + 1);
    if (close === -1) {
      files.push({ path, mode: nx.mode, content: text.slice(nl + 1), done: false });
      cursor = text.length;
      break;
    }
    files.push({
      path,
      mode: nx.mode,
      content: text.slice(nl + 1, close).replace(/\n$/, ""),
      done: true,
    });
    cursor = close + 3;
  }

  return { prose: stripFences(prose), files };
}

// ---------- diff stats ----------

function lcsLength(a: string[], b: string[]): number {
  const m = b.length;
  let prev = new Array<number>(m + 1).fill(0);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[m];
}

/** Order-insensitive common-line count — cheap fallback for very large files. */
function freqCommon(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1);
  let common = 0;
  for (const l of b) {
    const c = counts.get(l) ?? 0;
    if (c > 0) {
      common++;
      counts.set(l, c - 1);
    }
  }
  return common;
}

// CRLF-normalized: an imported CRLF file diffed against the model's LF output
// must not register every line as changed.
const splitLines = (t: string): string[] =>
  t === "" ? [] : t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

const nonEmptyLineCount = (t: string): number => {
  if (!t) return 0;
  let n = 0;
  for (const l of t.split("\n")) if (l.trim() !== "") n++;
  return n;
};

/** Added / removed line counts between two file versions. */
export function lineDiffStats(oldText: string, newText: string): { added: number; removed: number } {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length === 0) return { added: b.length, removed: 0 };
  if (b.length === 0) return { added: 0, removed: a.length };
  const lcs = a.length * b.length <= 250_000 ? lcsLength(a, b) : freqCommon(a, b);
  return { added: b.length - lcs, removed: a.length - lcs };
}

// ---------- resolve ops against the current project ----------

export interface ResolvedOp {
  path: string;
  mode: BuildOpMode;
  /** Final file contents to write. */
  content: string;
  added: number;
  removed: number;
  isNew: boolean;
  /** Edits applied cleanly (writes are always ok). */
  ok: boolean;
  failedHunks: number;
}

function resolveOne(f: ParsedBuildFile, existing: Map<string, string>, lenient = false): ResolvedOp {
  const old = existing.get(f.path);
  if (f.mode === "write") {
    const { added, removed } = lineDiffStats(old ?? "", f.content);
    // A full-file write is trusted UNLESS it would silently destroy the file:
    //  • truncated  — the stream was cut off mid-block (closing fence never came),
    //                 so the content is a partial, broken file; or
    //  • destructive — it collapses a real, non-trivial file down to almost
    //                 nothing (the classic "+1 −762" wipe / garbled rewrite).
    // In either case we mark it not-ok so the caller refuses to apply it and
    // forces a clean, complete rewrite instead of clobbering good code.
    const truncated = f.done === false;
    const oldNon = old ? nonEmptyLineCount(old) : 0;
    const newNon = nonEmptyLineCount(f.content);
    const destructive =
      old !== undefined && oldNon >= 12 && newNon <= 3 && f.content.length < old.length * 0.2;
    const ok = !truncated && !destructive;
    return { path: f.path, mode: "write", content: f.content, added, removed, isNew: old === undefined, ok, failedHunks: 0 };
  }
  const base = old ?? "";
  const hunks = parseEditHunks(f.content, lenient);
  const { content, failed } = applyEdits(base, hunks);
  const { added, removed } = lineDiffStats(base, content);
  return {
    path: f.path,
    mode: "edit",
    content,
    added,
    removed,
    isNew: old === undefined,
    ok: hunks.length > 0 && failed === 0,
    failedHunks: failed,
  };
}

/** Resolve every emitted op to final file contents + diff stats.
 *
 *  CUMULATIVE: the model may emit SEVERAL blocks for the same path (e.g. many
 *  small edit blocks against one script.js). Each ok op feeds the next, so a
 *  later block builds on the earlier blocks' result. Without this, every block
 *  resolves against the ORIGINAL file and the last write silently clobbers all
 *  the previous blocks' changes — code vanishes and the project breaks. */
export function resolveBuildOps(files: ParsedBuildFile[], existing: Map<string, string>): ResolvedOp[] {
  const working = new Map(existing);
  return files.map((f) => {
    const op = resolveOne(f, working);
    if (op.ok) working.set(f.path, op.content);
    return op;
  });
}

/** Keep only the LAST op per path (which, with cumulative resolution, contains
 *  every earlier ok op's changes for that path) — the actual write set. */
export function lastOpPerPath<T extends { path: string }>(ops: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const op of ops) byPath.set(op.path, op);
  return [...byPath.values()];
}

export interface BuildFileStatus {
  path: string;
  status: "writing" | "done";
  added: number;
  removed: number;
  isNew: boolean;
  mode: BuildOpMode;
  ok: boolean;
}

/** Turn parsed files + the project's current contents into live status rows.
 *
 *  ONE ROW PER PATH: the model may emit many blocks against the same file (e.g.
 *  19 small edit blocks on script.js). Rows aggregate per path — summed +/-,
 *  "writing" while the trailing block streams — instead of listing the same
 *  file once per block. Resolution is cumulative (matching resolveBuildOps), so
 *  each block's delta is measured against the result of the blocks before it. */
export function buildFileStatuses(
  parsed: ParsedBuildFile[],
  existing: Map<string, string>
): BuildFileStatus[] {
  const working = new Map(existing);
  const rows = new Map<string, BuildFileStatus>();
  for (const f of parsed) {
    let added: number;
    let removed: number;
    let ok: boolean;
    if (f.mode === "write" && !f.done) {
      // HOT PATH — a full-file write that is still streaming. We must NOT run
      // the O(n) line-diff against the old file on every streamed chunk (it
      // thrashes the UI), and diffing a PARTIAL new file is misleading anyway
      // (`added` sticks near +1 for a rewrite). Show real PROGRESS — lines
      // written so far — and reveal the true diff only on completion.
      added = f.content ? f.content.replace(/\n$/, "").split("\n").length : 0;
      removed = 0;
      ok = true;
    } else {
      // Estimate in-progress edits leniently so the +/- ticks up live while the
      // hunk streams (the actual write stays strict — complete hunks only).
      const op = resolveOne(f, working, f.mode === "edit" && !f.done);
      added = op.added;
      removed = op.removed;
      ok = op.ok;
      // Completed ok blocks feed the next block for the same path.
      if (f.done && op.ok) working.set(f.path, op.content);
    }
    const prev = rows.get(f.path);
    if (prev) {
      prev.added += added;
      prev.removed += removed;
      // Blocks stream sequentially, so only the trailing block can be unfinished.
      prev.status = f.done ? "done" : "writing";
      prev.ok = prev.ok && ok;
      prev.mode = f.mode;
    } else {
      rows.set(f.path, {
        path: f.path,
        status: f.done ? "done" : "writing",
        added,
        removed,
        isNew: !existing.has(f.path),
        mode: f.mode,
        ok,
      });
    }
  }
  return [...rows.values()];
}
