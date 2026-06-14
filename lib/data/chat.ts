"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate, setCache } from "./realtime";
import { uid as genId } from "@/lib/utils";
import type { ConversationDoc, MessageDoc } from "./types";

const convListKey = (uid: string) => `conversations:${uid}`;
const convKey = (cid: string) => `conversation:${cid}`;
const msgsKey = (cid: string) => `messages:${cid}`;

// ---------- Conversations ----------
export async function createConversation(
  uid: string,
  init: Partial<ConversationDoc> & Pick<ConversationDoc, "model" | "effort" | "thinking">
): Promise<string> {
  const id = init.id ?? genId("conv");
  const now = Date.now();
  const data: ConversationDoc = {
    id,
    title: init.title ?? "New chat",
    createdAt: now,
    updatedAt: now,
    projectId: init.projectId ?? null,
    model: init.model,
    effort: init.effort,
    thinking: init.thinking,
    agentId: init.agentId ?? null,
    activeLeafId: init.activeLeafId ?? null,
  };
  await api.post("/api/data/conversations", data);
  // Seed caches so the sidebar + this conversation render instantly (no refetch).
  setCache<ConversationDoc>(convKey(id), data);
  setCache<ConversationDoc[]>(convListKey(uid), (prev) => [data, ...(prev ?? [])]);
  return id;
}

export function subscribeConversations(
  uid: string,
  cb: (conversations: ConversationDoc[]) => void,
  onError?: (e: Error) => void
): () => void {
  return pollingSubscribe<ConversationDoc[]>(
    convListKey(uid),
    () => api.get<ConversationDoc[]>("/api/data/conversations"),
    cb,
    onError
  );
}

export function subscribeConversation(
  uid: string,
  cid: string,
  cb: (conversation: ConversationDoc | null) => void
): () => void {
  return pollingSubscribe<ConversationDoc | null>(
    convKey(cid),
    () => api.get<ConversationDoc | null>(`/api/data/conversations/${cid}`),
    cb,
    () => cb(null)
  );
}

export async function updateConversation(
  uid: string,
  cid: string,
  patch: Partial<ConversationDoc>
): Promise<void> {
  const updatedAt = Date.now();
  await api.patch(`/api/data/conversations/${cid}`, { ...patch, updatedAt });
  // Optimistic: update this conversation in cache so e.g. activeLeafId changes
  // apply synchronously (key to the seamless streaming→persisted handoff).
  setCache<ConversationDoc | null>(convKey(cid), (prev) =>
    prev ? { ...prev, ...patch, updatedAt } : prev ?? null
  );
  invalidate(convListKey(uid));
}

export async function deleteConversation(uid: string, cid: string): Promise<void> {
  await api.del(`/api/data/conversations/${cid}`);
  invalidate(convListKey(uid));
  invalidate(msgsKey(cid));
}

// ---------- Messages ----------
export async function addMessage(
  uid: string,
  cid: string,
  msg: Omit<MessageDoc, "id" | "createdAt"> & { id?: string; createdAt?: number }
): Promise<string> {
  const id = msg.id ?? genId("msg");
  const data: MessageDoc = {
    ...msg,
    id,
    createdAt: msg.createdAt ?? Date.now(),
  };
  await api.post(`/api/data/conversations/${cid}/messages`, data);
  // Append to the message cache so the new message shows instantly with no
  // refetch gap — this is what removes the post-stream "refresh" flash.
  setCache<MessageDoc[]>(msgsKey(cid), (prev) => {
    const list = prev ?? [];
    return list.some((m) => m.id === id) ? list : [...list, data];
  });
  invalidate(convListKey(uid)); // updatedAt/leaf may change list ordering
  return id;
}

export async function updateMessage(
  uid: string,
  cid: string,
  mid: string,
  patch: Partial<MessageDoc>
): Promise<void> {
  await api.patch(`/api/data/messages/${mid}`, patch);
  setCache<MessageDoc[]>(msgsKey(cid), (prev) =>
    (prev ?? []).map((m) => (m.id === mid ? { ...m, ...patch } : m))
  );
}

export function subscribeMessages(
  uid: string,
  cid: string,
  cb: (messages: MessageDoc[]) => void
): () => void {
  return pollingSubscribe<MessageDoc[]>(
    msgsKey(cid),
    () => api.get<MessageDoc[]>(`/api/data/conversations/${cid}/messages`),
    cb
  );
}

export async function getMessagesOnce(
  uid: string,
  cid: string
): Promise<MessageDoc[]> {
  return api.get<MessageDoc[]>(`/api/data/conversations/${cid}/messages`);
}
