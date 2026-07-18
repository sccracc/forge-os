"use client";

import { motion } from "framer-motion";
import { Check, Sparkles, X } from "lucide-react";
import { SparkFilled } from "@/components/icons";
import {
  buildSkillSuggestionPrompt,
  type SuggestedSkill,
} from "@/lib/ai/skill-suggestions";
import type { PendingSuggestion } from "@/lib/store/suggestion-store";

function skillsFromSuggestion(suggestion: PendingSuggestion): SuggestedSkill[] {
  if (suggestion.skills?.length) return suggestion.skills;
  if (!suggestion.skillSlug) return [];
  return [
    {
      slug: suggestion.skillSlug,
      name: suggestion.skillName ?? suggestion.skillSlug,
      reason: suggestion.reason ?? "",
    },
  ];
}

export function SkillSuggestionActions({
  suggestion,
  onUse,
  onDecline,
}: {
  suggestion: PendingSuggestion;
  onUse: () => void;
  onDecline: () => void;
}) {
  const skills = skillsFromSuggestion(suggestion);
  const useLabel = skills.length > 1 ? "Use skills" : "Use skill";

  if (skills.length === 0) return null;

  return (
    <motion.div
      className="skill-suggest"
      // Family 06 focus-rise: blur-in as the card rises.
      initial={{ opacity: 0, y: 6, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="skill-suggest-list">
        {skills.map((skill) => (
          <div className="skill-suggest-item" key={skill.slug}>
            <div className="skill-suggest-icon">
              <Sparkles size={16} />
            </div>
            <div className="skill-suggest-main">
              <b>
                <span className="skill-suggest-name">{skill.name}</span> skill
              </b>
              <small>{skill.reason || "This skill looks relevant to your request."}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="skill-suggest-actions">
        <button className="btn-amber" onClick={onUse}>
          <Check size={14} /> {useLabel}
        </button>
        <button className="btn-ghost" onClick={onDecline}>
          <X size={14} /> No thanks
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Fallback wrapper for suggestion states rendered outside a live stream.
 * The main chat path renders SkillSuggestionActions inside StreamingMessage.
 */
export function SkillSuggestionCard({
  suggestion,
  onUse,
  onDecline,
}: {
  suggestion: PendingSuggestion;
  onUse: () => void;
  onDecline: () => void;
}) {
  const skills = skillsFromSuggestion(suggestion);

  return (
    <div className="msg ai">
      <div className="msg-avatar">
        <SparkFilled style={{ width: 16, height: 16 }} />
      </div>
      <div className="msg-body">
        <div className="msg-name">Forge OS</div>
        {suggestion.phase === "checking" ? (
          <span className="streaming-caret skill-suggestion-caret" aria-hidden />
        ) : (
          <>
            <div className="msg-text skill-suggest-prompt">
              {buildSkillSuggestionPrompt(skills)}
            </div>
            <SkillSuggestionActions
              suggestion={suggestion}
              onUse={onUse}
              onDecline={onDecline}
            />
          </>
        )}
      </div>
    </div>
  );
}
