// Path validation for Forge Code writes.
//
// Every file path the agent tries to write goes through here before it touches
// the project. The model can hallucinate or be coaxed into emitting an absolute
// path, a `..` traversal, or a junk path; the project file system is a flat
// per-user/per-project namespace, so any of those is an invalid write. This is
// a defensive gate, complementing the server-side ownership checks.

export interface PathCheck {
  ok: boolean;
  /** The normalized, safe path (only meaningful when ok). */
  path: string;
  reason?: string;
}

const MAX_PATH_LEN = 400;
const MAX_SEGMENTS = 24;
// Control characters (NUL..unit-separator) + DEL are never valid in a path.
const CONTROL_CHARS = new RegExp("[\\x00-\\x1f\\x7f]");
const WIN_RESERVED = /[<>:"|?*]/;

/**
 * Validate + normalize a project-relative write path. Rejects:
 *  - empty paths
 *  - absolute paths (`/x`, `C:\x`, `\\server`)
 *  - parent traversal (`..`)
 *  - URL schemes / protocol-relative paths
 *  - NUL / control characters and other illegal filename chars
 *  - absurdly long or deep paths
 */
export function checkWritePath(raw: string): PathCheck {
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input) return { ok: false, path: "", reason: "empty path" };
  if (input.length > MAX_PATH_LEN) return { ok: false, path: "", reason: "path too long" };

  // Normalize backslashes to forward slashes so Windows-style input is caught
  // by the same rules rather than sneaking through.
  let p = input.replace(/\\/g, "/");

  if (CONTROL_CHARS.test(p)) return { ok: false, path: "", reason: "control characters in path" };
  if (/^[a-zA-Z]:\//.test(p)) return { ok: false, path: "", reason: "absolute (drive) path" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return { ok: false, path: "", reason: "url scheme in path" };
  if (p.startsWith("/")) return { ok: false, path: "", reason: "absolute path" };
  if (p.startsWith("~")) return { ok: false, path: "", reason: "home-relative path" };

  // Strip a leading "./" then split + drop empty / "." segments.
  p = p.replace(/^\.\//, "");
  const segments = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return { ok: false, path: "", reason: "empty path" };
  if (segments.length > MAX_SEGMENTS) return { ok: false, path: "", reason: "path too deep" };
  if (segments.some((s) => s === "..")) return { ok: false, path: "", reason: "parent traversal (..)" };
  if (segments.some((s) => WIN_RESERVED.test(s))) return { ok: false, path: "", reason: "illegal filename character" };

  const normalized = segments.join("/");
  return { ok: true, path: normalized };
}

export interface PathFilterResult<T extends { path: string }> {
  safe: (T & { path: string })[];
  rejected: { path: string; reason: string }[];
}

/**
 * Filter a set of write ops to only those with safe paths, normalizing each.
 * Rejected ops are returned (with reasons) for logging — never written.
 */
export function filterSafeOps<T extends { path: string }>(ops: T[]): PathFilterResult<T> {
  const safe: (T & { path: string })[] = [];
  const rejected: { path: string; reason: string }[] = [];
  for (const op of ops) {
    const c = checkWritePath(op.path);
    if (c.ok) safe.push({ ...op, path: c.path });
    else rejected.push({ path: op.path, reason: c.reason ?? "invalid path" });
  }
  return { safe, rejected };
}
