"use client";

import { create } from "zustand";
import { fetchUsage } from "@/lib/data/usage";
import type { UsageSnapshot } from "@/lib/usage/types";

export interface UsageLimitInfo {
  message?: string;
  reason?: string;
  /** Epoch-ms reset time, when the limit is a rolling window. */
  resetsAt?: number | null;
}

/** A feature the user's plan doesn't unlock — drives the "Feature Locked" modal. */
export interface PlanGateInfo {
  message?: string;
  requiredPlan?: string;
  feature?: string;
}

interface UsageState {
  plan: string;
  usage: UsageSnapshot | null;
  loaded: boolean;
  /** Set when the chat API returns a 429 usage_limit — drives the modal. */
  limit: UsageLimitInfo | null;
  /** Set when any API returns a 403 plan_gate — drives the "Feature Locked" modal. */
  gate: PlanGateInfo | null;
  refresh: () => Promise<void>;
  openLimit: (info: UsageLimitInfo) => void;
  closeLimit: () => void;
  openGate: (info: PlanGateInfo) => void;
  closeGate: () => void;
}

/**
 * Holds the user's current usage snapshot (refreshed after each completed
 * message) plus the "usage limit reached" modal state. Display-only this step —
 * no client-side blocking beyond reflecting the server's 429.
 */
export const useUsageStore = create<UsageState>((set) => ({
  plan: "free",
  usage: null,
  loaded: false,
  limit: null,
  gate: null,
  refresh: async () => {
    try {
      const { plan, usage } = await fetchUsage();
      set({ plan, usage, loaded: true });
    } catch {
      /* keep last-known snapshot on error */
    }
  },
  openLimit: (info) => set({ limit: info }),
  closeLimit: () => set({ limit: null }),
  openGate: (info) => set({ gate: info }),
  closeGate: () => set({ gate: null }),
}));
