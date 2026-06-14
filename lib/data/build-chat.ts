"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, setCache } from "./realtime";
import { uid as genId } from "@/lib/utils";
import type { SkillRef } from "./types";
import type { AgentRunSummary } from "@/lib/code/agent-log";

/** A file written by a build turn, with its line-diff stats. */
export interface BuildFileChange {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
}

export interface BuildMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Files written by this turn (build mode), with diff stats. */
  files?: BuildFileChange[];
  /** Skills that were active when this turn was generated. */
  skillsUsed?: SkillRef[];
  /** Structured agent-run trace (stages, verification, iterations) for this turn. */
  agentRun?: AgentRunSummary;
  error?: boolean;
}

/** Tolerate legacy log entries that stored files as a bare string[]. */
export function normalizeFileChanges(
  files: BuildMessage["files"] | string[] | undefined
): BuildFileChange[] {
  if (!files) return [];
  return files.map((f) =>
    typeof f === "string"
      ? { path: f, added: 0, removed: 0, isNew: false }
      : f
  );
}

const buildLogKey = (projectId: string) => `build-log:${projectId}`;

export function subscribeBuildLog(
  uid: string,
  projectId: string,
  cb: (messages: BuildMessage[]) => void
): () => void {
  return pollingSubscribe<BuildMessage[]>(
    buildLogKey(projectId),
    () => api.get<BuildMessage[]>(`/api/data/build-log?projectId=${projectId}`),
    cb
  );
}

export async function addBuildMessage(
  uid: string,
  projectId: string,
  msg: Omit<BuildMessage, "id" | "createdAt"> & { id?: string; createdAt?: number }
): Promise<string> {
  const id = msg.id ?? genId("bmsg");
  const message: BuildMessage = { ...msg, id, createdAt: msg.createdAt ?? Date.now() };
  await api.post("/api/data/build-log", { projectId, message });
  // Append to the cache so the message shows the instant it's persisted — no
  // refetch gap between the streaming panel clearing and the message arriving.
  setCache<BuildMessage[]>(buildLogKey(projectId), (prev) => {
    const list = prev ?? [];
    return list.some((m) => m.id === id) ? list : [...list, message];
  });
  return id;
}

export async function updateBuildMessage(
  uid: string,
  projectId: string,
  id: string,
  patch: Partial<BuildMessage>
): Promise<void> {
  await api.patch(`/api/data/build-log/${id}`, patch);
  setCache<BuildMessage[]>(buildLogKey(projectId), (prev) =>
    (prev ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m))
  );
}
