"use client";

// Auth provider — Supabase Google OAuth (full-page redirect + PKCE).
//
// Replaces the Firebase popup flow, which dead-ended on storage-partitioned
// mobile browsers ("missing initial state" on <project>.firebaseapp.com).
// Identity note: the app's canonical uid is resolved SERVER-side by verified
// email (legacy accounts keep their original Firebase-era uid; new accounts
// use their Supabase user id). The client adopts the canonical uid from the
// profile returned by /api/auth/sync-user, so every downstream consumer sees
// one consistent uid.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser, supabaseAuthConfigured } from "@/lib/supabase/client";
import { ensureProfile, subscribeProfile } from "@/lib/data/profile";
import { ensureBuiltinSkills } from "@/lib/data/skills";
import type { UserProfile } from "@/lib/data/types";
import { toast } from "@/lib/store/toast-store";

/** Minimal, provider-agnostic signed-in user shape. */
export interface AppUser {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
}

interface AuthContextValue {
  user: AppUser | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function metaStr(meta: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function sessionToUser(session: Session): AppUser {
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    uid: session.user.id,
    email: session.user.email ?? undefined,
    displayName: metaStr(meta, "full_name", "name"),
    photoURL: metaStr(meta, "avatar_url", "picture"),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileUnsub = useRef<(() => void) | null>(null);
  // Tracks which auth user the profile bootstrap last ran for, so token
  // refreshes / tab focus events don't re-run the sync.
  const bootedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!supabaseAuthConfigured) {
      setLoading(false);
      return;
    }
    const sb = getSupabaseBrowser();
    if (!sb) {
      setLoading(false);
      return;
    }

    const handleSession = async (session: Session | null) => {
      if (!session) {
        bootedFor.current = null;
        profileUnsub.current?.();
        profileUnsub.current = null;
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      const authUser = sessionToUser(session);
      if (bootedFor.current === authUser.uid) return; // refresh event — no-op
      bootedFor.current = authUser.uid;
      profileUnsub.current?.();
      profileUnsub.current = null;

      try {
        // sync-user resolves the CANONICAL uid server-side (legacy accounts
        // map by verified email) and returns the merged profile.
        const prof = await ensureProfile({
          uid: authUser.uid,
          displayName: authUser.displayName,
          email: authUser.email,
          photoURL: authUser.photoURL,
        });
        const canonicalUid = prof?.uid ?? authUser.uid;
        setUser({ ...authUser, uid: canonicalUid });
        setProfile(prof ?? null);
        // Ensure the built-in skills exist (idempotent by slug — only adds
        // missing ones, never touches the user's enabled/disabled state).
        ensureBuiltinSkills(canonicalUid).catch((e) =>
          console.error("skill seed failed", e)
        );
        profileUnsub.current = subscribeProfile(canonicalUid, setProfile);
      } catch (e) {
        console.error("profile init failed", e);
        // Still signed in even if the profile bootstrap failed.
        setUser(authUser);
      }
      setLoading(false);
    };

    // Initial session (restored from storage), then live auth events.
    sb.auth.getSession().then(({ data }) => void handleSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      void handleSession(session);
    });
    return () => {
      sub.subscription.unsubscribe();
      profileUnsub.current?.();
    };
  }, []);

  const signInGoogle = useCallback(async () => {
    const sb = getSupabaseBrowser();
    if (!sb) {
      toast.error("Sign-in isn't available — authentication isn't configured.");
      return;
    }
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // Success → the browser is navigating to Google; nothing more to do.
    } catch (e) {
      const message = ((e as { message?: string })?.message ?? "").toLowerCase();
      toast.error(
        message.includes("provider") && message.includes("not enabled")
          ? "Google sign-in isn't enabled for this workspace yet."
          : "Couldn't start Google sign-in. Please try again."
      );
    }
  }, []);

  const signOutUser = useCallback(async () => {
    const sb = getSupabaseBrowser();
    if (sb) await sb.auth.signOut();
  }, []);

  const getIdToken = useCallback(async () => {
    const sb = getSupabaseBrowser();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        configured: supabaseAuthConfigured,
        signInGoogle,
        signOutUser,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
