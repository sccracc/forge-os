"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate } from "./realtime";
import { DEFAULT_MODEL } from "@/lib/ai/models.public";
import { DEFAULT_EFFORT } from "@/lib/ai/effort";
import type { UserProfile } from "./types";

const profileKey = (uid: string) => `profile:${uid}`;

export function defaultProfile(
  uid: string,
  seed?: { displayName?: string; email?: string; photoURL?: string }
): UserProfile {
  const now = Date.now();
  return {
    uid,
    displayName: seed?.displayName,
    email: seed?.email,
    photoURL: seed?.photoURL,
    plan: "free",
    defaultModel: DEFAULT_MODEL,
    defaultEffort: DEFAULT_EFFORT,
    defaultThinking: false,
    defaultToolsEnabled: false,
    defaultPreviewMode: "auto",
    buildAutonomy: "auto",
    customAbout: "",
    customStyle: "",
    memoryEnabled: true,
    searchChatsEnabled: true,
    memoryProfile: "",
    createdAt: now,
    updatedAt: now,
  };
}

/** Provisions the user's rows on first sign-in (STEP 3) and returns the profile.
 *  Idempotent — safe to call on every sign-in. */
export async function ensureProfile(seed: {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
}): Promise<UserProfile> {
  const profile = await api.post<UserProfile | null>("/api/auth/sync-user", {
    email: seed.email,
    name: seed.displayName,
    avatar_url: seed.photoURL,
  });
  invalidate(profileKey(seed.uid));
  return profile ?? defaultProfile(seed.uid, seed);
}

export function subscribeProfile(
  uid: string,
  cb: (profile: UserProfile | null) => void
): () => void {
  return pollingSubscribe<UserProfile | null>(
    profileKey(uid),
    () => api.get<UserProfile | null>("/api/data/profile"),
    cb,
    () => cb(null)
  );
}

export async function updateProfile(
  uid: string,
  patch: Partial<UserProfile>
): Promise<void> {
  await api.patch("/api/data/profile", patch);
  invalidate(profileKey(uid));
}
