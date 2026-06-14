"use client";

import { api } from "./authed-fetch";
import type { UsagePayload } from "@/lib/usage/types";

/** Fetch the current user's plan + usage snapshot. */
export function fetchUsage(): Promise<UsagePayload> {
  return api.get<UsagePayload>("/api/data/usage");
}
