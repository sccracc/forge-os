"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { SparkGlyph } from "@/components/icons";

export function ThinkingPanel({
  reasoning = "",
  active,
  durationMs,
}: {
  reasoning?: string;
  active: boolean;
  durationMs?: number;
}) {
  // Mounted on an already-finished message (persisted thread, or the
  // streaming→persisted swap) → start collapsed, matching the auto-collapsed
  // state the live panel ends in. Only a panel born mid-thinking starts open.
  const [collapsed, setCollapsed] = useState(!active);
  const [secs, setSecs] = useState(0);
  const startRef = useRef<number>(Date.now());
  const wasActive = useRef(active);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Live elapsed-seconds timer while thinking.
  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    setSecs(0);
    const id = setInterval(
      () => setSecs(Math.floor((Date.now() - startRef.current) / 1000)),
      250
    );
    return () => clearInterval(id);
  }, [active]);

  // Auto-collapse the instant thinking completes.
  useEffect(() => {
    if (wasActive.current && !active) setCollapsed(true);
    wasActive.current = active;
  }, [active]);

  // Keep the reasoning scrolled to the latest token while streaming.
  useEffect(() => {
    if (active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [reasoning, active]);

  const finalSecs = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  const shown = active ? secs : finalSecs;
  const label = active
    ? "Thinking…"
    : `Thought for ${shown} second${shown === 1 ? "" : "s"}`;
  const hasBody = reasoning.trim().length > 0;
  const open = active ? true : !collapsed;

  return (
    <div className={`thinking ${active ? "active" : ""}`}>
      <button
        className="thinking-head"
        type="button"
        onClick={() => !active && hasBody && setCollapsed((c) => !c)}
        aria-expanded={open}
        aria-live={active ? "polite" : undefined}
        style={{ cursor: !active && hasBody ? "pointer" : "default" }}
      >
        <SparkGlyph className={`spark ${active ? "spinning" : ""}`} />
        {/* Family 35: `.think-label` is the stable hook for the panel-scoped
            ember gradient (scope: `.thinking .think-label`). */}
        <span className={`think-label${active ? " shimmer-text" : ""}`}>{label}</span>
        {!active && hasBody && (
          <ChevronDown className={`chev ${open ? "" : "collapsed"}`} />
        )}
      </button>
      {hasBody && (
        <motion.div
          initial={false}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
          transition={{
            height: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] },
            opacity: { duration: 0.25, ease: "easeOut" },
          }}
          style={{ overflow: "hidden", position: "relative" }}
        >
          {/* Family 35 "Aurora study": decorative light that drifts behind the
              reasoning while the panel is open (CSS-animated, absolute). */}
          {open && <span className="think-aurora" aria-hidden />}
          <div
            ref={bodyRef}
            className="thinking-body"
            // position:relative keeps the text painting above the aurora
            style={{ maxHeight: 360, overflowY: "auto", position: "relative" }}
          >
            {reasoning}
          </div>
        </motion.div>
      )}
    </div>
  );
}
