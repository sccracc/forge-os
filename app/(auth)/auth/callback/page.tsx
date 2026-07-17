"use client";

// OAuth landing — completes the Google → Supabase PKCE round trip.
// signInWithOAuth redirects here with ?code=…; we exchange it for a session
// and head home. Failures land back on /sign-in with a friendly message.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { ForgeMark } from "@/components/icons";

export default function AuthCallbackPage() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React strict-mode double-invoke guard
    ran.current = true;

    (async () => {
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
      const code = url.searchParams.get("code");
      if (!code) {
        router.replace("/sign-in");
        return;
      }
      const { error } = await sb.auth.exchangeCodeForSession(window.location.href);
      if (error) {
        failTo("Couldn't complete sign-in. Please try again.");
        return;
      }
      router.replace("/");
    })();
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
          animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <ForgeMark style={{ width: 26, height: 26, color: "var(--on-accent)" }} />
        </motion.div>
        <span style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Signing you in…</span>
      </div>
    </div>
  );
}
