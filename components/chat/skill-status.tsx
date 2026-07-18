"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ScrollText } from "lucide-react";
import { SparkGlyph } from "@/components/icons";
import { useSkills } from "@/hooks/use-skills";
import type { SkillRef } from "@/lib/data/types";

/**
 * Claude-style skill indicator: an animated "Working" line while generating,
 * plus an expandable "Reading the <slug> SKILL.md ›" row per active skill.
 */
export function SkillStatus({
  skills,
  working,
}: {
  skills?: SkillRef[];
  working?: boolean;
}) {
  if (!skills || skills.length === 0) return null;
  return (
    <div className="skill-status">
      {working && (
        <motion.div
          className="ss-working"
          // Family 06 focus-rise: fades up while unblurring.
          initial={{ opacity: 0, y: 3, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.25 }}
        >
          <SparkGlyph className="ss-spark" />
          <span>Working</span>
        </motion.div>
      )}
      {skills.map((s, i) => (
        <SkillRow key={s.slug} skill={s} index={i} working={working} />
      ))}
    </div>
  );
}

function SkillRow({
  skill,
  index,
  working,
}: {
  skill: SkillRef;
  index: number;
  working?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { skills } = useSkills();
  const full = skills.find((x) => x.slug === skill.slug);
  // Per-row stagger for the liquid-drop entrance (demo g34 B: 0.2s, then +0.14s/row).
  const drop = working ? 0.2 + index * 0.14 : 0;

  return (
    <motion.div
      className="ss-row"
      // Entrance animation only while live — a persisted message (incl. the
      // streaming→persisted swap) mounts with its rows already settled.
      // Family 34 "Liquid drop": row falls in and lands with squash-settle
      // mass — translateY overshoot past rest, scaleY squash at touchdown,
      // spring back up (demo f34b-drop), staggered per row.
      initial={working ? { opacity: 0, y: -11, scaleY: 1 } : false}
      animate={
        working
          ? { opacity: [0, 1, 1, 1], y: [-11, 2, -1, 0], scaleY: [1, 0.94, 1.02, 1] }
          : { opacity: 1, y: 0, scaleY: 1 }
      }
      transition={
        working
          ? { duration: 0.5, times: [0, 0.55, 0.78, 1], ease: [0.3, 0.7, 0.3, 1], delay: drop }
          : { duration: 0 }
      }
      style={{ transformOrigin: "50% 0%" }}
    >
      <button className="ss-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {/* Doc icon rocks once (±4°) as the row lands (demo f34b-tilt). */}
        <motion.span
          style={{ display: "inline-flex", flexShrink: 0 }}
          initial={working ? { rotate: -4 } : false}
          animate={working ? { rotate: [-4, 4, 0] } : { rotate: 0 }}
          transition={
            working
              ? { duration: 0.45, times: [0, 0.55, 1], ease: [0.2, 0.8, 0.2, 1], delay: drop + 0.22 }
              : { duration: 0 }
          }
        >
          <ScrollText className="ss-doc" />
        </motion.span>
        <span>
          {working ? (
            <>
              Reading the <b>{skill.slug}</b> SKILL.md
            </>
          ) : (
            <>
              Used the <b>{skill.name || skill.slug}</b> skill
            </>
          )}
        </span>
        <ChevronRight className={`ss-chev ${open ? "open" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            {/* Family 34: panel unfolds with a slight radius morph + scaleY
                settle from the top (demo f34b-open, radius eases to rest 9px). */}
            <motion.div
              className="ss-expand"
              initial={{ scaleY: 0.85, borderRadius: 16 }}
              animate={{ scaleY: [0.85, 1.02, 1], borderRadius: [16, 12, 9] }}
              transition={{ duration: 0.42, times: [0, 0.6, 1], ease: [0.2, 0.8, 0.2, 1] }}
              style={{ transformOrigin: "50% 0%" }}
            >
              {full?.instructions?.trim() ||
                `Forge consulted the ${skill.name} skill for this response.`}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
