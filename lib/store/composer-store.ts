"use client";

import { create } from "zustand";
import { DEFAULT_MODEL, type ForgeModelId } from "@/lib/ai/models.public";
import { DEFAULT_EFFORT, type EffortId } from "@/lib/ai/effort";

interface ComposerState {
  model: ForgeModelId;
  effort: EffortId;
  thinking: boolean;
  toolsEnabled: boolean;
  webSearchEnabled: boolean;
  activeSkillSlugs: string[];
  activeAgentId: string | null;
  incognito: boolean;

  setModel: (m: ForgeModelId) => void;
  setEffort: (e: EffortId) => void;
  setThinking: (t: boolean) => void;
  setToolsEnabled: (v: boolean) => void;
  setWebSearchEnabled: (v: boolean) => void;
  setIncognito: (v: boolean) => void;
  setAgent: (id: string | null) => void;
  addSkill: (slug: string) => void;
  removeSkill: (slug: string) => void;
  clearSkills: () => void;

  /** Apply the user's profile defaults (called once when profile loads). */
  hydrateDefaults: (d: {
    model: ForgeModelId;
    effort: EffortId;
    thinking: boolean;
    toolsEnabled: boolean;
  }) => void;
  /** Adopt a conversation's persisted settings when it's opened. */
  syncFromConversation: (c: {
    model: ForgeModelId;
    effort: EffortId;
    thinking: boolean;
  }) => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  thinking: false,
  toolsEnabled: false,
  webSearchEnabled: true,
  activeSkillSlugs: [],
  activeAgentId: null,
  incognito: false,

  setModel: (m) => set((s) => ({ ...s, model: m })),
  setEffort: (e) => set({ effort: e }),
  setThinking: (t) => set({ thinking: t }),
  setToolsEnabled: (v) => set({ toolsEnabled: v }),
  setWebSearchEnabled: (v) => set({ webSearchEnabled: v }),
  setIncognito: (v) => set({ incognito: v }),
  setAgent: (id) => set({ activeAgentId: id }),
  addSkill: (slug) =>
    set((s) =>
      s.activeSkillSlugs.includes(slug)
        ? s
        : { activeSkillSlugs: [...s.activeSkillSlugs, slug] }
    ),
  removeSkill: (slug) =>
    set((s) => ({ activeSkillSlugs: s.activeSkillSlugs.filter((x) => x !== slug) })),
  clearSkills: () => set({ activeSkillSlugs: [] }),

  hydrateDefaults: (d) =>
    set({
      model: d.model,
      effort: d.effort,
      thinking: d.thinking,
      toolsEnabled: d.toolsEnabled,
    }),
  // Also resets per-conversation context (active skills/agent) — without this,
  // a skill or agent activated in one chat silently leaks into the next one.
  syncFromConversation: (c) =>
    set({
      model: c.model,
      effort: c.effort,
      thinking: c.thinking,
      activeSkillSlugs: [],
      activeAgentId: null,
    }),
}));
