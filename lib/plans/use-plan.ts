"use client";

import { useAuth } from "@/components/auth/auth-provider";

/**
 * The current user's billing plan, read from the globally-loaded profile.
 * Defaults to "free" until the profile loads (most-restrictive — UI shows locks
 * until the real plan is known). Single client-side source of truth for gating.
 */
export function usePlan(): string {
  const { profile } = useAuth();
  return profile?.plan ?? "free";
}
