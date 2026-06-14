// Retrieval-first context builder for Forge Code.
//
// The old approach dumped every file (alphabetically, until a byte budget) into
// the model's context. That wastes the budget on unrelated files and, on large
// projects, silently drops whatever sorts last — including the file the user is
// actually asking about.
//
// This module instead RANKS the project's files by how relevant each one is to
// the current request, then spends the content budget on the most relevant
// files first. The full file TREE is always included (cheap, complete project
// awareness), and any file whose full contents don't fit is still listed with a
// compact signature (size + leading/exported lines) plus an explicit note that
// its full contents can be requested — so the model never hallucinates a file
// and always knows the whole surface area of the project.
//
// Pure + dependency-free so it is unit-testable and runs on the client.

export interface RetrievalFile {
  path: string;
  content: string;
  /** Epoch ms of last edit; used for a small recency boost. */
  updatedAt?: number;
}

export interface RetrievalOptions {
  /** Byte budget for fully-inlined file CONTENTS (the tree is always free). */
  budgetBytes: number;
  /** Max number of files to inline in full; the rest become signatures. */
  maxFullFiles: number;
  /** How far to walk the import/reference graph from request-mentioned files. */
  neighborDepth: number;
}

export interface RankedFile {
  path: string;
  score: number;
  /** Why it ranked (for logging / debugging). */
  reasons: string[];
}

export interface RetrievalResult {
  context: string;
  ranked: RankedFile[];
  includedFull: string[];
  summarized: string[];
}

const DEFAULT_OPTIONS: RetrievalOptions = {
  budgetBytes: 120_000,
  maxFullFiles: 45,
  neighborDepth: 1,
};

// Words that carry no signal for relevance ranking.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "make", "build", "add", "change", "update", "create", "fix", "remove", "delete",
  "please", "can", "you", "it", "this", "that", "should", "would", "could", "want",
  "need", "like", "new", "use", "using", "into", "from", "all", "every", "some",
  "file", "files", "code", "project", "app", "page", "pages", "thing", "things",
  "work", "working", "also", "then", "now", "set", "get", "put", "let", "have",
]);

const ENTRY_POINTS = [
  "index.html", "index.js", "index.ts", "index.jsx", "index.tsx",
  "main.js", "main.ts", "main.jsx", "main.tsx", "app.js", "app.ts",
  "app.jsx", "app.tsx", "script.js", "style.css", "styles.css",
];

const ALWAYS_USEFUL = [
  "package.json", "forge.md", "readme.md", "tsconfig.json", "vite.config.ts",
  "vite.config.js", "next.config.js", "next.config.ts", "tailwind.config.js",
];

const basename = (p: string): string => p.split("/").pop() ?? p;
const stripExt = (name: string): string => name.replace(/\.[^.]+$/, "");

/** Tokenize a string into lowercased identifier-ish words worth matching on. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  // Split camelCase / kebab / snake / path separators into word parts too.
  const raw = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const w of raw) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

/** Local files referenced by a file's import/require/href/src statements. */
function referencedPaths(file: RetrievalFile, allPaths: Set<string>): string[] {
  const out = new Set<string>();
  const content = file.content;
  const dir = file.path.includes("/") ? file.path.replace(/\/[^/]*$/, "") : "";
  const re =
    /(?:from\s+|require\(\s*|import\s+|href\s*=\s*|src\s*=\s*|url\(\s*)["'`]([^"'`)]+)["'`]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const ref = m[1].trim();
    if (!ref || ref.startsWith("http") || ref.startsWith("//") || ref.startsWith("data:")) continue;
    const cleaned = ref.replace(/^\.\//, "").replace(/[?#].*$/, "");
    const candidates = resolveRef(cleaned, dir);
    for (const c of candidates) {
      if (allPaths.has(c)) out.add(c);
    }
  }
  return [...out];
}

/** Resolve a raw reference to candidate project paths (with extension guesses). */
function resolveRef(ref: string, dir: string): string[] {
  const joined = ref.startsWith("../") || ref.startsWith("/") ? normalize(ref, dir) : dir ? `${dir}/${ref}` : ref;
  const base = joined.replace(/^\//, "");
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json", "/index.ts", "/index.js"];
  return exts.map((e) => base + e);
}

function normalize(ref: string, dir: string): string {
  const parts = (dir ? `${dir}/${ref}` : ref).split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}

/**
 * Rank files by relevance to `query`. Higher score = more relevant. Scoring:
 *  - explicit path/basename mention in the request (strongest signal)
 *  - keyword overlap between the request and the file's path + contents
 *  - entry-point / always-useful boosts (index.html, package.json, FORGE.md, …)
 *  - import/reference-graph proximity to request-mentioned files
 *  - a small recency boost for recently edited files
 */
export function rankFiles(
  files: RetrievalFile[],
  query: string,
  neighborDepth = 1
): RankedFile[] {
  const tokens = tokenize(query);
  const tokenSet = new Set(tokens);
  const queryLower = query.toLowerCase();
  const allPaths = new Set(files.map((f) => f.path));

  // Reference graph: path -> the local files it points at.
  const refs = new Map<string, string[]>();
  for (const f of files) refs.set(f.path, referencedPaths(f, allPaths));

  const mostRecent = Math.max(1, ...files.map((f) => f.updatedAt ?? 0));

  const scores = new Map<string, { score: number; reasons: string[] }>();
  const mentioned = new Set<string>();

  for (const f of files) {
    const reasons: string[] = [];
    let score = 0;
    const path = f.path.toLowerCase();
    const name = basename(path);
    const nameNoExt = stripExt(name);

    // 1. Explicit mention of the path or basename in the request.
    if (queryLower.includes(path) || (nameNoExt.length >= 3 && queryLower.includes(nameNoExt))) {
      score += 40;
      reasons.push("named in request");
      mentioned.add(f.path);
    }

    // 2. Keyword overlap (path tokens are worth more than body tokens).
    const pathTokens = tokenize(f.path);
    let pathHits = 0;
    for (const t of pathTokens) if (tokenSet.has(t)) pathHits++;
    if (pathHits) {
      score += pathHits * 6;
      reasons.push(`path keywords ×${pathHits}`);
    }
    if (tokens.length) {
      const body = f.content.toLowerCase();
      let bodyHits = 0;
      for (const t of tokenSet) {
        if (body.includes(t)) bodyHits++;
      }
      if (bodyHits) {
        score += Math.min(bodyHits, 8) * 2;
        reasons.push(`content keywords ×${bodyHits}`);
      }
    }

    // 3. Structural boosts.
    if (ENTRY_POINTS.includes(name)) {
      score += 8;
      reasons.push("entry point");
    }
    if (ALWAYS_USEFUL.includes(name)) {
      score += 5;
      reasons.push("config/docs");
    }

    // 4. Recency (small — up to +4 for the most recently edited file).
    if (f.updatedAt) {
      score += Math.round((f.updatedAt / mostRecent) * 4);
    }

    scores.set(f.path, { score, reasons });
  }

  // 5. Reference-graph expansion: files reachable from a mentioned file get a
  //    proximity boost that decays with distance.
  let frontier = new Set(mentioned);
  for (let depth = 0; depth < neighborDepth && frontier.size; depth++) {
    const next = new Set<string>();
    const boost = 18 - depth * 6;
    for (const p of frontier) {
      for (const ref of refs.get(p) ?? []) {
        const entry = scores.get(ref);
        if (entry) {
          entry.score += boost;
          entry.reasons.push(`referenced by ${basename(p)}`);
        }
        next.add(ref);
      }
    }
    frontier = next;
  }

  return files
    .map((f) => {
      const s = scores.get(f.path)!;
      return { path: f.path, score: s.score, reasons: s.reasons };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/** A compact, code-free signature for a file that didn't fit in full. */
function signature(file: RetrievalFile): string {
  const lines = file.content.split("\n");
  const lineCount = lines.length;
  const bytes = byteLength(file.content);
  // A few meaningful leading lines (exports / signatures / headings), code-free
  // enough to orient the model without spending the full budget.
  const head = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) =>
      /^(export|import|function|class|const|let|def|public|private|#|<\w|\.\w|@|interface|type)\b/.test(l) ||
      /^(h1|h2|title|nav|header|footer)/i.test(l)
    )
    .slice(0, 4);
  const headNote = head.length ? `\n  ${head.join("\n  ")}` : "";
  return `- ${file.path} (${lineCount} lines, ${bytes} bytes)${headNote}`;
}

function byteLength(s: string): number {
  // Avoid Buffer/TextEncoder differences across runtimes — approximate UTF-8.
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return n;
}

/**
 * Build a retrieval-ranked context block for the model:
 *  - the complete file tree (always),
 *  - full contents of the most relevant files within the budget,
 *  - signatures for the rest, with a note that they can be requested in full.
 */
export function buildRetrievalContext(
  files: RetrievalFile[],
  query: string,
  options: Partial<RetrievalOptions> = {}
): RetrievalResult {
  const opts: RetrievalOptions = { ...DEFAULT_OPTIONS, ...options };
  const real = files.filter((f) => typeof f.content === "string");
  const ranked = rankFiles(real, query, opts.neighborDepth);
  const byPath = new Map(real.map((f) => [f.path, f]));

  const tree = [...real]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `- ${f.path}`)
    .join("\n");

  const includedFull: string[] = [];
  const summarized: string[] = [];
  const fullBlocks: string[] = [];
  let budget = opts.budgetBytes;

  for (const r of ranked) {
    const f = byPath.get(r.path);
    if (!f || !f.content) continue;
    const block = `\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``;
    const cost = byteLength(block);
    if (includedFull.length < opts.maxFullFiles && cost <= budget) {
      budget -= cost;
      includedFull.push(f.path);
      fullBlocks.push(block);
    } else {
      summarized.push(f.path);
    }
  }

  const parts: string[] = [`File tree (${real.length} file${real.length === 1 ? "" : "s"}):\n${tree || "(empty project)"}`];

  if (fullBlocks.length) {
    parts.push(
      `\nMost relevant files (full contents — ranked by relevance to your task):${fullBlocks.join("\n")}`
    );
  }

  if (summarized.length) {
    const sigs = summarized
      .map((p) => byPath.get(p))
      .filter((f): f is RetrievalFile => Boolean(f))
      .map(signature)
      .join("\n");
    parts.push(
      `\nOther project files (not inlined to save context — ask to see any in full before editing it; never guess its contents):\n${sigs}`
    );
  }

  return {
    context: parts.join("\n"),
    ranked,
    includedFull,
    summarized,
  };
}
