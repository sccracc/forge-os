"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/components/auth/auth-provider";
import { ForgeMark } from "@/components/icons";

function Splash() {
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
      <motion.div
        className="logo-mark"
        style={{ width: 48, height: 48 }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <ForgeMark style={{ width: 26, height: 26, color: "var(--on-accent)" }} />
      </motion.div>
    </div>
  );
}

function ConfigNotice() {
  const vars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  return (
    <div style={{ height: "100dvh", display: "grid", placeItems: "center", padding: 24, position: "relative", zIndex: 1 }}>
      <div className="modal" style={{ width: "min(540px, calc(100vw - 32px))", animation: "none" }}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div className="logo-mark" style={{ width: 33, height: 33 }}>
              <ForgeMark style={{ width: 18, height: 18, color: "var(--on-accent)" }} />
            </div>
            <h3>Finish configuring Forge</h3>
          </div>
        </div>
        <div className="modal-body">
          <p style={{ color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 16 }}>
            Forge is built and ready. Add your Supabase project credentials and
            server chat credentials as environment variables, then reload.
            These power sign-in, your workspace, and the assistant.
          </p>
          <div
            style={{
              background: "var(--code-bg)",
              border: "1px solid var(--code-border)",
              borderRadius: "var(--radius-sm)",
              padding: "14px 16px",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              color: "var(--code-text)",
              lineHeight: 1.9,
            }}
          >
            {vars.map((v) => (
              <div key={v}>
                {v}=<span style={{ opacity: 0.5 }}>…</span>
              </div>
            ))}
            <div style={{ opacity: 0.5, marginTop: 8 }}># server-only</div>
            <div>
              SUPABASE_SERVICE_ROLE_KEY=<span style={{ opacity: 0.5 }}>…</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && configured && !user) router.replace("/sign-in");
  }, [loading, configured, user, router]);

  if (!configured) return <ConfigNotice />;
  if (loading || !user) return <Splash />;
  return <>{children}</>;
}
