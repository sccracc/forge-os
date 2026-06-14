"use client";

import { create } from "zustand";
import { useUIStore } from "./ui-store";

export interface OpenArtifact {
  code: string;
  lang: string;
  title: string;
}

interface ArtifactState {
  artifact: OpenArtifact | null;
  /** Sidebar collapsed-state before opening, so we can restore it on close. */
  prevCollapsed: boolean;
  open: (a: OpenArtifact) => void;
  close: () => void;
}

/**
 * Drives the chat artifact preview panel. Opening collapses the sidebar and
 * slides the right panel in; closing restores the prior sidebar state.
 */
export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifact: null,
  prevCollapsed: false,
  open: (a) => {
    const ui = useUIStore.getState();
    set({ artifact: a, prevCollapsed: ui.sidebarCollapsed });
    ui.setSidebarCollapsed(true);
    ui.setRightPanelOpen(true);
  },
  close: () => {
    if (!get().artifact) return;
    const ui = useUIStore.getState();
    ui.setRightPanelOpen(false);
    ui.setSidebarCollapsed(get().prevCollapsed);
    set({ artifact: null });
  },
}));
