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

  return (
    <motion.div
      className="ss-row"
      // Entrance animation only while live — a persisted message (incl. the
      // streaming→persisted swap) mounts with its rows already settled.
      // Family 06 focus-rise: one-shot blur-in, staggered per row.
      initial={working ? { opacity: 0, y: 3, filter: "blur(4px)" } : false}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay: (working ? 0.15 : 0) + index * 0.06, duration: 0.25 }}
    >
      <button className="ss-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ScrollText className="ss-doc" />
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
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="ss-expand">
              {full?.instructions?.trim() ||
                `Forge consulted the ${skill.name} skill for this response.`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
