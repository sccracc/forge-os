"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  getFirebaseAuth,
  googleProvider,
  firebaseConfigured,
} from "@/lib/firebase/client";
import { ensureProfile, subscribeProfile } from "@/lib/data/profile";
import { ensureBuiltinSkills } from "@/lib/data/skills";
import type { UserProfile } from "@/lib/data/types";
import { toast } from "@/lib/store/toast-store";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isIgnoredPopupError(code: string) {
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

function signInErrorMessage(error: unknown) {
  const err = error as { code?: string; message?: string };
  const code = err?.code ?? "";
  const message = err?.message ?? "";

  if (
    code === "auth/web-storage-unsupported" ||
    /missing initial state|sessionStorage|storage-partitioned/i.test(message)
  ) {
    return "Mobile sign-in couldn't keep the Firebase auth state. Set NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN to this app domain, then redeploy.";
  }

  if (code === "auth/popup-blocked") {
    return "The browser blocked the Google sign-in window. Allow popups for Forge OS and try again.";
  }

  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized in Firebase Authentication settings.";
  }

  return "Couldn't sign in. Please try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileUnsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      profileUnsub.current?.();
      profileUnsub.current = null;

      if (u) {
        try {
          await ensureProfile({
            uid: u.uid,
            displayName: u.displayName ?? undefined,
            email: u.email ?? undefined,
            photoURL: u.photoURL ?? undefined,
          });
          // Ensure the built-in skills exist (idempotent by slug — only adds
          // missing ones, never touches the user's enabled/disabled state).
          // Guarantees /skill-creator + starters are always available.
          ensureBuiltinSkills(u.uid).catch((e) =>
            console.error("skill seed failed", e)
          );
          profileUnsub.current = subscribeProfile(u.uid, setProfile);
        } catch (e) {
          console.error("profile init failed", e);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => {
      unsub();
      profileUnsub.current?.();
    };
  }, []);

  const signInGoogle = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) {
      toast.error("Sign-in isn't available — Firebase isn't configured.");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? "";
      if (!isIgnoredPopupError(code)) {
        toast.error(signInErrorMessage(e));
      }
    }
  }, []);

  const signOutUser = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await signOut(auth);
  }, []);

  const getIdToken = useCallback(async () => {
    const auth = getFirebaseAuth();
    return auth?.currentUser ? auth.currentUser.getIdToken() : null;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        configured: firebaseConfigured,
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
