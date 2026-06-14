"use client";

import { create } from "zustand";
import type { SuggestedSkill } from "@/lib/ai/skill-suggestions";

/** Transient skill-suggestion UI state, keyed by conversation id. */
export interface PendingSuggestion {
  /** "checking" while the classifier runs; "ask" once one or more skills are proposed. */
  phase: "checking" | "ask";
  skills?: SuggestedSkill[];
  /** Legacy fields kept while older UI paths are migrated. */
  skillSlug?: string;
  skillName?: string;
  reason?: string;
}

interface SuggestionStore {
  byConv: Record<string, PendingSuggestion | undefined>;
  /** Slugs the user already declined in a conversation - never re-ask them. */
  declined: Record<string, string[]>;
  setChecking: (cid: string) => void;
  setAsk: (cid: string, skills: SuggestedSkill[]) => void;
  clear: (cid: string) => void;
  decline: (cid: string, slug: string) => void;
  hasDeclined: (cid: string, slug: string) => boolean;
}

export const useSuggestionStore = create<SuggestionStore>((set, get) => ({
  byConv: {},
  declined: {},
  setChecking: (cid) =>
    set((st) => ({ byConv: { ...st.byConv, [cid]: { phase: "checking" } } })),
  setAsk: (cid, skills) =>
    set((st) => ({
      byConv: {
        ...st.byConv,
        [cid]: {
          phase: "ask",
          skills,
          skillSlug: skills[0]?.slug,
          skillName: skills[0]?.name,
          reason: skills[0]?.reason,
        },
      },
    })),
  clear: (cid) =>
    set((st) => {
      if (!st.byConv[cid]) return st;
      const next = { ...st.byConv };
      delete next[cid];
      return { byConv: next };
    }),
  decline: (cid, slug) =>
    set((st) => ({
      declined: {
        ...st.declined,
        [cid]: Array.from(new Set([...(st.declined[cid] ?? []), slug])),
      },
    })),
  hasDeclined: (cid, slug) => (get().declined[cid] ?? []).includes(slug),
}));
