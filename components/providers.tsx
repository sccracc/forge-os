"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ThemeApplier } from "@/components/theme/theme-applier";
import { Toaster } from "@/components/ui/toaster";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import { ConnectionStatus } from "@/components/ui/connection-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UsageLimitModal } from "@/components/chat/usage-limit-modal";
import { PlanGateModal } from "@/components/chat/plan-gate-modal";
import { useUIStore } from "@/lib/store/ui-store";
import type { ThemePref } from "@/lib/theme";
import { useEffect } from "react";

function ThemeHydrator({ initial }: { initial: ThemePref }) {
  const setThemePref = useUIStore((s) => s.setThemePref);
  // Reconcile the persisted/store value with the server-resolved cookie value.
  useEffect(() => {
    setThemePref(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function Providers({
  children,
  initialThemePref,
}: {
  children: React.ReactNode;
  initialThemePref: ThemePref;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeHydrator initial={initialThemePref} />
        <ThemeApplier />
        {children}
        <Toaster />
        <CommandPalette />
        <ShortcutsSheet />
        <ConnectionStatus />
        <ConfirmDialog />
        <UsageLimitModal />
        <PlanGateModal />
      </AuthProvider>
    </QueryClientProvider>
  );
}
