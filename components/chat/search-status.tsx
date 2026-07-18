"use client";

import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import type { SearchState } from "@/lib/store/stream-store";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Source pills spread out from the chip with a staggered spring.
const sourceItem: Variants = {
  hidden: { opacity: 0, scale: 0.7, x: -8 },
  show: {
    opacity: 1,
    scale: 1,
    x: 0,
    transition: { type: "spring", stiffness: 440, damping: 26 },
  },
};

/**
 * Inline web-search status ("Morph" style). The chip fluidly resizes between
 * "Searching the web for …" and "Found N results for …", the icon crossfades
 * spinner ↔ check, and source pills spread out. Renders live during a search
 * and on persisted messages after the fact.
 */
export function SearchStatus({ searches, live }: { searches?: SearchState[]; live?: boolean }) {
  if (!searches || searches.length === 0) return null;
  return (
    <div className="search-status">
      <AnimatePresence initial={false}>
        {searches.map((s) => {
          const count = s.count ?? 0;
          return (
            <motion.div
              key={s.id}
              className="search-block"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                className={`search-chip ${s.done ? "done" : "searching"}`}
                style={{ borderRadius: 100 }}
              >
                <span className="sc-icon-slot">
                  <AnimatePresence mode="wait" initial={false}>
                    {s.done ? (
                      <motion.span
                        key="check"
                        className="sc-icon"
                        // Family 19 unified spring: 0.5 → ~1.1 overshoot → 1, no rotation.
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      >
                        <Check size={13} />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="load"
                        className="sc-icon"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, rotate: 360 }}
                        exit={{ opacity: 0 }}
                        transition={{
                          rotate: { duration: 1, repeat: Infinity, ease: "linear" },
                          opacity: { duration: 0.2 },
                        }}
                      >
                        <Loader2 size={13} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <motion.span layout="position">
                  {s.done ? (
                    <>
                      Found {count} result{count === 1 ? "" : "s"} for{" "}
                      <span className="sc-q">&ldquo;{s.query}&rdquo;</span>
                    </>
                  ) : (
                    <>
                      Searching the web for{" "}
                      <span className="sc-q">&ldquo;{s.query}&rdquo;</span>
                    </>
                  )}
                </motion.span>
              </motion.div>

              {s.done && s.sources && s.sources.length > 0 && (
                <motion.div
                  className="search-sources"
                  // Pills stagger in only during a live search; persisted
                  // messages mount with them already in place (no replay).
                  initial={live ? "hidden" : false}
                  animate="show"
                  variants={{ show: { transition: { staggerChildren: 0.06 } } }}
                >
                  {s.sources.map((src, i) => {
                    const host = hostOf(src.url);
                    return (
                      <motion.a
                        key={`${s.id}-${i}`}
                        className="source-pill"
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={src.title || host}
                        variants={sourceItem}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="source-favicon"
                          src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
                          alt=""
                          width={14}
                          height={14}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                        <span className="source-host">{host}</span>
                      </motion.a>
                    );
                  })}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
