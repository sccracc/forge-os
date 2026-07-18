"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useToastStore } from "@/lib/store/toast-store";

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, minWidth: 0, maxWidth: 44, whiteSpace: "nowrap" }}
              animate={{
                opacity: 1,
                minWidth: 240,
                maxWidth: 420,
                transitionEnd: { whiteSpace: "normal" },
              }}
              exit={{
                opacity: 0,
                scale: 0.96,
                transition: { duration: 0.25, ease: "easeOut" },
              }}
              transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: "hidden" }}
              className={`toast ${t.kind}`}
              role="status"
            >
              <Icon className="t-icon" />
              <motion.span
                style={{ flex: 1 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.18, duration: 0.25, ease: "easeOut" }}
              >
                {t.message}
              </motion.span>
              <button
                className="icon-btn"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
