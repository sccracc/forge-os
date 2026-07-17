"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate } from "./realtime";
import { uid as genId } from "@/lib/utils";
import { getProjectFilesOnce, writeFilesByPath, deleteNode } from "./files";
import type { CheckpointDoc, CheckpointFile, FileDoc } from "./types";

// Skip snapshotting projects whose inline content is very large.
const MAX_SNAPSHOT_BYTES = 900_000;

const checkpointsKey = (projectId: string) => `checkpoints:${projectId}`;

export function snapshotFiles(files: FileDoc[]): CheckpointFile[] {
  return files
    .filter((f) => f.kind === "file")
    .map((f) => ({ path: f.path, content: f.content ?? "" }));
}

export function snapshotBytes(snap: CheckpointFile[]): number {
  return snap.reduce((n, f) => n + f.content.length + f.path.length, 0);
}

/** Snapshots the project's current files. Returns the id, or null if too large. */
export async function createCheckpoint(
  uid: string,
  projectId: string,
  label: string,
  kind: CheckpointDoc["kind"],
  files: FileDoc[]
): Promise<string | null> {
  const snap = snapshotFiles(files);
  if (snap.length === 0 || snapshotBytes(snap) > MAX_SNAPSHOT_BYTES) return null;
  const id = genId("cp");
  const data: CheckpointDoc = {
    id,
    projectId,
    label: label.trim().slice(0, 120) || "Checkpoint",
    kind,
    at: Date.now(),
    fileCount: snap.length,
    files: snap,
  };
  await api.post("/api/data/checkpoints", data); // server prunes history
  invalidate(checkpointsKey(projectId));
  return id;
}

export function subscribeCheckpoints(
  uid: string,
  projectId: string,
  cb: (checkpoints: CheckpointDoc[]) => void
): () => void {
  return pollingSubscribe<CheckpointDoc[]>(
    checkpointsKey(projectId),
    () => api.get<CheckpointDoc[]>(`/api/data/checkpoints?projectId=${projectId}`),
    cb
  );
}

export async function deleteCheckpoint(uid: string, projectId: string, id: string): Promise<void> {
  await api.del(`/api/data/checkpoints/${id}`);
  invalidate(checkpointsKey(projectId));
}

/** Restores the project to a checkpoint: rewrites snapshot files and removes
 *  any files that didn't exist at that point. The CURRENT state is snapshotted
 *  first ("Before restore"), so a mis-click restore is itself reversible. */
export async function restoreCheckpoint(uid: string, projectId: string, id: string): Promise<void> {
  const cp = await api.get<CheckpointDoc | null>(`/api/data/checkpoints/${id}`);
  if (!cp) throw new Error("Checkpoint not found");
  const preRestore = await getProjectFilesOnce(uid, projectId).catch(() => []);
  if (preRestore.length) {
    await createCheckpoint(uid, projectId, "Before restore", "auto", preRestore).catch(() => null);
  }
  const keep = new Set(cp.files.map((f) => f.path));
  if (cp.files.length) {
    await writeFilesByPath(uid, projectId, cp.files.map((f) => ({ path: f.path, content: f.content })));
  }
  const current = await getProjectFilesOnce(uid, projectId);
  for (const f of current) {
    if (f.kind === "file" && !keep.has(f.path)) {
      await deleteNode(uid, f).catch(() => {});
    }
  }
}
