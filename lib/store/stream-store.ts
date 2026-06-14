"use client";

import { create } from "zustand";
import type { ForgeModelId } from "@/lib/ai/models.public";
import type { EffortId } from "@/lib/ai/effort";
import type { SkillRef, AgentRef, MessageAttachments } from "@/lib/data/types";

export type StreamPhase = "reasoning" | "streaming" | "finalizing" | "error";

/** A live web_search tool call — drives the inline search status chips. */
export interface SearchState {
  id: string;
  query: string;
  done: boolean;
  count?: number;
  /** Result links, surfaced as clickable source pills when the search completes. */
  sources?: { title: string; url: string }[];
}

export interface GeneratedImageState {
  id: string;
  loadingText: string;
  done: boolean;
  imageUrl?: string;
  prompt?: string;
  error?: string;
  notice?: string;
}

export interface StreamingState {
  conversationId: string;
  userMessageId: string;
  userMessageContent?: string;
  userMessageAttachments?: MessageAttachments;
  userMessageParentId: string | null;
  content: string;
  reasoning: string;
  phase: StreamPhase;
  error?: string;
  /** When the request started streaming. */
  reasoningStart: number;
  /** When the first reasoning token arrived (true start of thinking). */
  reasoningFirstAt?: number;
  /** Thinking duration in ms — first reasoning token → first answer token. */
  reasoningMs?: number;
  model: ForgeModelId;
  effort: EffortId;
  thinking: boolean;
  /** Skills active for this generation — drives the "Reading … SKILL.md" rows. */
  activeSkills?: SkillRef[];
  /** Agent active for this generation — drives the "responding as <agent>" badge. */
  activeAgent?: AgentRef;
  /** Live web_search calls this generation — drives the search status chips. */
  searches?: SearchState[];
  generatedImages?: GeneratedImageState[];
}

// AbortControllers kept outside the store (not serializable, no re-render needed).
const controllers = new Map<string, AbortController>();

export function setController(cid: string, c: AbortController) {
  controllers.set(cid, c);
}
export function abortController(cid: string) {
  controllers.get(cid)?.abort();
  controllers.delete(cid);
}
export function clearController(cid: string) {
  controllers.delete(cid);
}

interface StreamStore {
  byConv: Record<string, StreamingState | undefined>;
  start: (s: StreamingState) => void;
  appendContent: (cid: string, d: string) => void;
  appendReasoning: (cid: string, d: string) => void;
  setPhase: (cid: string, phase: StreamPhase, extra?: Partial<StreamingState>) => void;
  upsertSearch: (cid: string, s: SearchState) => void;
  upsertGeneratedImage: (cid: string, image: GeneratedImageState) => void;
  clear: (cid: string) => void;
}

export const useStreamStore = create<StreamStore>((set) => ({
  byConv: {},
  start: (s) => set((st) => ({ byConv: { ...st.byConv, [s.conversationId]: s } })),
  appendContent: (cid, d) =>
    set((st) => {
      const cur = st.byConv[cid];
      if (!cur) return st;
      const flipping = cur.phase === "reasoning";
      return {
        byConv: {
          ...st.byConv,
          [cid]: {
            ...cur,
            content: cur.content + d,
            phase: flipping ? "streaming" : cur.phase,
            // Thinking time = first reasoning token → first answer token (NOT
            // the whole response). Captured the instant the answer begins.
            reasoningMs:
              flipping && cur.reasoningMs == null
                ? Date.now() - (cur.reasoningFirstAt ?? cur.reasoningStart)
                : cur.reasoningMs,
          },
        },
      };
    }),
  appendReasoning: (cid, d) =>
    set((st) => {
      const cur = st.byConv[cid];
      if (!cur) return st;
      return {
        byConv: {
          ...st.byConv,
          [cid]: {
            ...cur,
            reasoning: cur.reasoning + d,
            reasoningFirstAt: cur.reasoningFirstAt ?? Date.now(),
          },
        },
      };
    }),
  setPhase: (cid, phase, extra) =>
    set((st) => {
      const cur = st.byConv[cid];
      if (!cur) return st;
      return { byConv: { ...st.byConv, [cid]: { ...cur, phase, ...extra } } };
    }),
  upsertSearch: (cid, s) =>
    set((st) => {
      const cur = st.byConv[cid];
      if (!cur) return st;
      const list = cur.searches ? [...cur.searches] : [];
      const idx = list.findIndex((x) => x.id === s.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...s };
      else list.push(s);
      return { byConv: { ...st.byConv, [cid]: { ...cur, searches: list } } };
    }),
  upsertGeneratedImage: (cid, image) =>
    set((st) => {
      const cur = st.byConv[cid];
      if (!cur) return st;
      const list = cur.generatedImages ? [...cur.generatedImages] : [];
      const idx = list.findIndex((x) => x.id === image.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...image };
      else list.push(image);
      return { byConv: { ...st.byConv, [cid]: { ...cur, generatedImages: list } } };
    }),
  clear: (cid) =>
    set((st) => {
      const next = { ...st.byConv };
      delete next[cid];
      return { byConv: next };
    }),
}));
