"use client";

import { motion } from "framer-motion";
import { ScanSearch } from "lucide-react";

/**
 * "Analyzing image" indicator — an arc spins around a scan icon while an
 * attached image is being understood (vision). Icon-only, Molten tokens.
 */
export function AnalyzingImage() {
  return (
    <div className="analyzing-chip" aria-live="polite">
      <span className="analyzing-ring">
        <motion.span
          className="analyzing-arc"
          aria-hidden
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
        />
        <ScanSearch size={12} />
      </span>
      <span>Analyzing image…</span>
    </div>
  );
}
