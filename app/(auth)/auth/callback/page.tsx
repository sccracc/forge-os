"use client";

// OAuth landing — the Google → Supabase PKCE round trip returns here (or to
// the Site URL root, if this path isn't in the project's redirect allowlist).
// The Supabase client is created with detectSessionInUrl: true, so IT performs
// the one-and-only code exchange on load. This page just waits for the session
// to materialize and routes accordingly. It must NEVER call
// exchangeCodeForSession itself — a second exchange of the single-use code
// fails with a token?grant_type=pkce 404 ("flow state not found").

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { ForgeMark } from "@/components/icons";

const WAIT_MS = 10_000;

export default function AuthCallbackPage() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const failTo = (msg: string) =>
      router.replace(`/sign-in?error=${encodeURIComponent(msg)}`);

    const sb = getSupabaseBrowser();
    if (!sb) {
      failTo("Sign-in isn't configured for this deployment.");
      return;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.get("error")) {
      const desc = url.searchParams.get("error_description");
      failTo(desc ? desc : "Sign-in was cancelled.");
      return;
    }
    const hadCode = url.searchParams.has("code");

    let settled = false;
    let unsub: (() => void) | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      unsub?.();
      clearTimeout(timer);
      if (ok) router.replace("/");
      else failTo("Couldn't complete sign-in. Please try again.");
    };

    // The client's auto-detection exchanges the code during initialization;
    // getSession resolves after that. The auth-event subscription covers the
    // case where the exchange lands a beat later.
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (session) finish(true);
      else if (event === "SIGNED_OUT") {
        /* ignore — initial state before exchange completes */
      }
    });
    unsub = () => sub.subscription.unsubscribe();

    sb.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) console.error("[auth/callback] getSession failed", error);
        if (data.session) finish(true);
        else if (!hadCode) {
          // Nothing to wait for — no code, no error, no session.
          settled = true;
          unsub?.();
          clearTimeout(timer);
          router.replace("/sign-in");
        }
        // else: keep waiting for the auth event or the timeout.
      })
      .catch((e) => {
        console.error("[auth/callback] getSession threw", e);
      });

    const timer = setTimeout(() => finish(false), WAIT_MS);

    return () => {
      unsub?.();
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <div
      style={{
        height: "100dvh",
        display: "grid",
        placeItems: "center",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div style={{ display: "grid", placeItems: "center", gap: 14 }}>
        <motion.div
          className="logo-mark"
          style={{ width: 48, height: 48 }}
          animate={{
            scale: [1, 1.05, 1],
            boxShadow: [
              "0 2px 8px var(--amber-glow), 0 0 0px var(--amber-glow)",
              "0 4px 22px var(--amber-glow), 0 0 26px var(--amber-glow)",
              "0 2px 8px var(--amber-glow), 0 0 0px var(--amber-glow)",
            ],
          }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <ForgeMark style={{ width: 26, height: 26, color: "var(--on-accent)" }} />
        </motion.div>
        <span style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Signing you in…</span>
      </div>
    </div>
  );
}
