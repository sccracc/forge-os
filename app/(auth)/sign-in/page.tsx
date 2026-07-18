"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/components/auth/auth-provider";
import { ForgeMark } from "@/components/icons";

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.99 11.99 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function SignInCard() {
  const { user, loading, configured, signInGoogle } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  // Friendly message forwarded from a failed OAuth round trip (/auth/callback).
  const [error, setError] = useState<string | null>(() => params.get("error"));
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  const startSignIn = async () => {
    setError(null);
    setRedirecting(true);
    await signInGoogle();
    // If we're still here after a beat, the redirect didn't happen (an error
    // toast explains why) — re-enable the button.
    setTimeout(() => setRedirecting(false), 4000);
  };

  return (
    <div
      style={{
        height: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        position: "relative",
        zIndex: 1,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
        className="glass-strong"
        style={{
          // min() (not maxWidth:100%): inside a content-sized grid track a
          // percentage max-width can't resolve and the card overflows phones.
          width: "min(400px, calc(100vw - 32px))",
          borderRadius: 20,
          padding: "36px clamp(18px, 6vw, 32px)",
          textAlign: "center",
        }}
      >
        <div
          className="logo-mark"
          style={{ width: 52, height: 52, margin: "0 auto 18px", borderRadius: 14 }}
        >
          <ForgeMark style={{ width: 28, height: 28, color: "var(--on-accent)" }} />
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, marginBottom: 8 }}>
          Forge<span style={{ color: "var(--amber)" }}>&nbsp;OS</span>
        </h1>
        <p
          style={{
            color: "var(--text-dim)",
            fontSize: 14.5,
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          Your integrated AI workspace. Chat, build, and ship — all in one place.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: "var(--danger)",
              background: "color-mix(in srgb, var(--danger) 8%, transparent)",
              border: "1px solid var(--danger)",
              borderRadius: "var(--radius-sm)",
              padding: "10px 13px",
              lineHeight: 1.55,
              marginBottom: 14,
              textAlign: "left",
            }}
          >
            {error}
          </div>
        )}

        {configured ? (
          <button
            className="btn-ghost"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "12px 16px",
              fontSize: 14.5,
              fontWeight: 600,
            }}
            onClick={startSignIn}
            disabled={loading || redirecting}
          >
            {redirecting ? (
              <>Redirecting to Google…</>
            ) : (
              <>
                <GoogleG /> Continue with Google
              </>
            )}
          </button>
        ) : (
          <div
            style={{
              fontSize: 13,
              color: "var(--text-dim)",
              background: "var(--amber-tint)",
              border: "1px solid var(--amber)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              lineHeight: 1.6,
            }}
          >
            Sign-in becomes available once authentication environment variables
            are configured for this deployment.
          </div>
        )}

        <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 22, lineHeight: 1.6 }}>
          By continuing you agree to use Forge responsibly.
        </p>
      </motion.div>
    </div>
  );
}

// useSearchParams requires a Suspense boundary at the page level.
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInCard />
    </Suspense>
  );
}
