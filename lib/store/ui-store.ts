"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { THEME_COOKIE, resolvePref, type ThemePref } from "@/lib/theme";

export type AppMode = "chat" | "code";

function initialThemePref(): ThemePref {
  if (typeof document === "undefined") return "light";
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]+)`));
  return resolvePref(m ? decodeURIComponent(m[1]) : "light");
}

interface UIState {
  themePref: ThemePref;
  setThemePref: (p: ThemePref) => void;

  /** Derived from the route by the shell; kept here for components that need it. */
  mode: AppMode;
  setMode: (m: AppMode) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (v: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;
  toggleCommandPalette: () => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;

  instructionInspectorOpen: boolean;
  setInstructionInspectorOpen: (v: boolean) => void;

  /** Right panel (editor / artifact viewer) — populated in later phases. */
  rightPanelOpen: boolean;
  setRightPanelOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      themePref: initialThemePref(),
      setThemePref: (p) => set({ themePref: p }),

      mode: "chat",
      setMode: (m) => set({ mode: m }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      mobileSidebarOpen: false,
      setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

      shortcutsOpen: false,
      setShortcutsOpen: (v) => set({ shortcutsOpen: v }),

      instructionInspectorOpen: false,
      setInstructionInspectorOpen: (v) => set({ instructionInspectorOpen: v }),

      rightPanelOpen: false,
      setRightPanelOpen: (v) => set({ rightPanelOpen: v }),
    }),
    {
      name: "forge-ui",
      storage: createJSONStorage(() => localStorage),
      // Persist only durable layout prefs; theme lives in a cookie, mode in the route.
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
);
