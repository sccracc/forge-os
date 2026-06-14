"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate } from "./realtime";
import { uid as genId } from "@/lib/utils";
import type { AgentDoc } from "./types";

const agentsKey = (uid: string) => `agents:${uid}`;

function listAgents(): Promise<AgentDoc[]> {
  return api.get<AgentDoc[]>("/api/data/agents");
}

export function subscribeAgents(
  uid: string,
  cb: (agents: AgentDoc[]) => void,
  onError?: (e: Error) => void
): () => void {
  return pollingSubscribe<AgentDoc[]>(agentsKey(uid), listAgents, cb, onError);
}

export interface AgentInit {
  name: string;
  description?: string;
  avatar?: string;
  systemPrompt: string;
  defaultModel?: AgentDoc["defaultModel"];
  defaultEffort?: AgentDoc["defaultEffort"];
  defaultThinking?: boolean;
  skillSlugs?: string[];
  allowedTools?: string[];
  defaultProjectId?: string | null;
  enabled?: boolean;
  builtin?: boolean;
}

export async function createAgent(uid: string, init: AgentInit): Promise<string> {
  const id = genId("agent");
  const now = Date.now();
  const agent: AgentDoc = {
    id,
    name: init.name.trim() || "Untitled agent",
    description: (init.description ?? "").trim(),
    avatar: init.avatar,
    systemPrompt: init.systemPrompt ?? "",
    defaultModel: init.defaultModel,
    defaultEffort: init.defaultEffort,
    defaultThinking: init.defaultThinking,
    skillSlugs: init.skillSlugs,
    allowedTools: init.allowedTools,
    defaultProjectId: init.defaultProjectId,
    enabled: init.enabled ?? true,
    builtin: init.builtin,
    createdAt: now,
    updatedAt: now,
  };
  await api.post("/api/data/agents", agent);
  invalidate(agentsKey(uid));
  return id;
}

export async function updateAgent(uid: string, id: string, patch: Partial<AgentDoc>): Promise<void> {
  await api.patch(`/api/data/agents/${id}`, { ...patch, updatedAt: Date.now() });
  invalidate(agentsKey(uid));
}

export async function deleteAgent(uid: string, id: string): Promise<void> {
  await api.del(`/api/data/agents/${id}`);
  invalidate(agentsKey(uid));
}

export async function setAgentEnabled(uid: string, id: string, enabled: boolean): Promise<void> {
  await api.patch(`/api/data/agents/${id}`, { enabled, updatedAt: Date.now() });
  invalidate(agentsKey(uid));
}

export async function duplicateAgent(uid: string, id: string): Promise<string> {
  const a = (await listAgents()).find((x) => x.id === id);
  if (!a) throw new Error("Agent not found");
  return createAgent(uid, {
    name: `${a.name} (copy)`,
    description: a.description,
    avatar: a.avatar,
    systemPrompt: a.systemPrompt,
    defaultModel: a.defaultModel,
    defaultEffort: a.defaultEffort,
    defaultThinking: a.defaultThinking,
    skillSlugs: a.skillSlugs,
    allowedTools: a.allowedTools,
    defaultProjectId: a.defaultProjectId,
    enabled: a.enabled,
  });
}

export function exportAgent(a: AgentDoc): string {
  return JSON.stringify(
    {
      name: a.name,
      description: a.description,
      avatar: a.avatar,
      systemPrompt: a.systemPrompt,
      defaultModel: a.defaultModel,
      defaultEffort: a.defaultEffort,
      defaultThinking: a.defaultThinking,
      skillSlugs: a.skillSlugs,
    },
    null,
    2
  );
}

interface ImportedAgent {
  name?: string;
  description?: string;
  avatar?: string;
  systemPrompt?: string;
  defaultModel?: AgentDoc["defaultModel"];
  defaultEffort?: AgentDoc["defaultEffort"];
  defaultThinking?: boolean;
  skillSlugs?: string[];
}

export async function importAgents(uid: string, json: string): Promise<number> {
  const parsed = JSON.parse(json) as ImportedAgent | ImportedAgent[];
  const list = Array.isArray(parsed) ? parsed : [parsed];
  let count = 0;
  for (const item of list) {
    if (!item || !item.name || !item.systemPrompt) continue;
    await createAgent(uid, {
      name: item.name,
      description: item.description,
      avatar: item.avatar,
      systemPrompt: item.systemPrompt,
      defaultModel: item.defaultModel,
      defaultEffort: item.defaultEffort,
      defaultThinking: item.defaultThinking,
      skillSlugs: item.skillSlugs,
      enabled: true,
    });
    count++;
  }
  return count;
}
