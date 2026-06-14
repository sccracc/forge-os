"use client";

import { create } from "zustand";
import { uid } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = "info") => {
    const id = uid("toast");
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), 3600);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers usable from anywhere on the client. */
export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "error"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
};
