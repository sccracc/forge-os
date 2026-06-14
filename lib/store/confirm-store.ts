"use client";

import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling (red button + trash icon). Defaults to true. */
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmStore {
  request: ConfirmRequest | null;
  open: (req: ConfirmRequest) => void;
  resolve: (value: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  request: null,
  open: (req) => set({ request: req }),
  resolve: (value) => {
    const r = get().request;
    set({ request: null });
    r?.resolve(value);
  },
}));

/** Polished replacement for window.confirm — returns a Promise<boolean>. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open({ ...options, resolve });
  });
}
