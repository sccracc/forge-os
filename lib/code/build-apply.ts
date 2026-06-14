import { lineDiffStats, type ResolvedOp } from "./build-stream";

export interface AppliedPathChange {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
}

function unique(paths: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(paths).filter(Boolean)));
}

export function pathHasVisibleChange(
  path: string,
  before: Map<string, string>,
  after: Map<string, string>
): boolean {
  const hadBefore = before.has(path);
  const hasAfter = after.has(path);
  if (hadBefore !== hasAfter) return true;
  if (!hadBefore && !hasAfter) return false;
  return before.get(path) !== after.get(path);
}

export function pathsWithVisibleChanges(
  paths: Iterable<string>,
  before: Map<string, string>,
  after: Map<string, string>
): string[] {
  return unique(paths).filter((path) => pathHasVisibleChange(path, before, after));
}

export function buildAppliedChanges(
  paths: Iterable<string>,
  before: Map<string, string>,
  after: Map<string, string>
): AppliedPathChange[] {
  return pathsWithVisibleChanges(paths, before, after).map((path) => {
    const { added, removed } = lineDiffStats(before.get(path) ?? "", after.get(path) ?? "");
    return { path, added, removed, isNew: !before.has(path) && after.has(path) };
  });
}

export function opHasContentChange(op: ResolvedOp): boolean {
  return op.added > 0 || op.removed > 0 || op.isNew;
}

export function applicableResolvedOps(ops: ResolvedOp[]): ResolvedOp[] {
  return ops.filter((op) => op.ok && opHasContentChange(op));
}

export function persistedAppliedOps<T extends { path: string; content: string }>(
  ops: T[],
  beforeWrite: Map<string, string>,
  afterWrite: Map<string, string>
): T[] {
  return ops.filter((op) => {
    if (!afterWrite.has(op.path)) return false;
    const stored = afterWrite.get(op.path);
    if (stored !== op.content) return false;
    return pathHasVisibleChange(op.path, beforeWrite, afterWrite);
  });
}

export function refreshTouchedPaths(
  touched: Set<string>,
  candidatePaths: Iterable<string>,
  beforeBuild: Map<string, string>,
  afterBuild: Map<string, string>
): string[] {
  const candidates = unique(candidatePaths);
  for (const path of candidates) touched.add(path);
  for (const path of Array.from(touched)) {
    if (!pathHasVisibleChange(path, beforeBuild, afterBuild)) touched.delete(path);
  }
  return candidates.filter((path) => touched.has(path));
}
