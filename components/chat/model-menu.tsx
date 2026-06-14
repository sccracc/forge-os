"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronRight, Lock, Search } from "lucide-react";
import { SparkGlyph } from "@/components/icons";
import { useComposerStore } from "@/lib/store/composer-store";
import { FORGE_MODELS_PUBLIC, FORGE_MODEL_IDS } from "@/lib/ai/models.public";
import { EFFORT, EFFORT_IDS, DEFAULT_EFFORT } from "@/lib/ai/effort";
import { usePlan } from "@/lib/plans/use-plan";
import {
  canUseModel,
  canUseEffort,
  canUseThinking,
  getUpgradeMessage,
  getRequiredPlan,
} from "@/lib/plans/gates";
import { useUsageStore } from "@/lib/store/usage-store";

export function ModelMenu({
  align = "center",
  buildMode = false,
}: {
  align?: "center" | "right";
  buildMode?: boolean;
}) {
  const model = useComposerStore((s) => s.model);
  const effort = useComposerStore((s) => s.effort);
  const thinking = useComposerStore((s) => s.thinking);
  const webSearch = useComposerStore((s) => s.webSearchEnabled);
  const setModel = useComposerStore((s) => s.setModel);
  const setEffort = useComposerStore((s) => s.setEffort);
  const setThinking = useComposerStore((s) => s.setThinking);
  const setWebSearch = useComposerStore((s) => s.setWebSearchEnabled);
  const [submenu, setSubmenu] = useState(false);
  const plan = usePlan();
  const openGate = useUsageStore((s) => s.openGate);
  const thinkingLocked = !canUseThinking(plan, model);

  // In narrow panels (e.g. the build dock) the trigger sits near the right
  // edge, so a centered menu would overflow off-screen. Right-aligned grows
  // leftward into the panel and stays fully visible.
  const tx = align === "right" ? 0 : "-50%";

  return (
    <motion.div
      className={`menu${align === "right" ? " menu-right" : ""}`}
      initial={{ opacity: 0, scale: 0.97, y: 8, x: tx }}
      animate={{ opacity: 1, scale: 1, y: 0, x: tx }}
      exit={{ opacity: 0, scale: 0.97, y: 8, x: tx }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      <div className="menu-section-label">Model</div>
      {FORGE_MODEL_IDS.map((id) => {
        const unavailable = buildMode && id === "spark-2.5";
        const locked = !canUseModel(plan, id);
        return (
          <button
            key={id}
            className={`menu-item model-option ${model === id ? "selected" : ""} ${unavailable || locked ? "unavailable" : ""}`}
            onClick={() => {
              if (unavailable) return;
              if (locked) {
                openGate({
                  feature: "model",
                  message: getUpgradeMessage(plan, "Magnum 2.8"),
                  requiredPlan: getRequiredPlan("Magnum 2.8"),
                });
                return;
              }
              setModel(id);
            }}
            role="menuitemradio"
            aria-checked={model === id}
            aria-disabled={unavailable}
            disabled={unavailable}
            title={
              unavailable
                ? "Spark is unavailable in Build mode"
                : locked
                  ? getUpgradeMessage(plan, "Magnum 2.8")
                  : undefined
            }
          >
            <div className="mi-main">
              <div className="mi-title-row">
                <span className="mi-title">{FORGE_MODELS_PUBLIC[id].label}</span>
                {unavailable && (
                  <span className="mi-status">
                    <Lock /> Build unavailable
                  </span>
                )}
                {locked && !unavailable && (
                  <span className="mi-status">
                    <Lock /> Pro
                  </span>
                )}
              </div>
              <div className="mi-sub">
                {unavailable
                  ? "Use Magnum for reliable file edits"
                  : locked
                    ? "Available on Pro and above"
                    : FORGE_MODELS_PUBLIC[id].blurb}
              </div>
            </div>
            <Check className="mi-check" />
          </button>
        );
      })}

      <div className="menu-sep" />

      <div className="menu-item" style={{ position: "relative" }}>
        <button
          className="menu-item"
          style={{ padding: 0, width: "100%", background: "none" }}
          onClick={() => setSubmenu((s) => !s)}
          aria-haspopup="menu"
          aria-expanded={submenu}
        >
          <div className="mi-main">
            <div className="mi-title" style={{ fontWeight: 500 }}>
              Effort
            </div>
          </div>
          <div className="mi-right">
            <span>{EFFORT[effort].label}</span>
            <ChevronRight className="mi-arrow" />
          </div>
        </button>
        {submenu && (
          <motion.div
            className="submenu"
            initial={{ opacity: 0, scale: 0.97, x: align === "right" ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.16 }}
            role="menu"
          >
            <div className="submenu-label">Effort</div>
            {EFFORT_IDS.map((id) => {
              const locked = !canUseEffort(plan, id);
              const label =
                id === "max"
                  ? "Max effort"
                  : id === "xhigh"
                    ? "Extra High effort"
                    : id === "high"
                      ? "High effort"
                      : "This effort level";
              return (
                <button
                  key={id}
                  className={`effort-item ${effort === id ? "sel" : ""} ${locked ? "unavailable" : ""}`}
                  onClick={() => {
                    if (locked) {
                      openGate({
                        feature: "effort",
                        message: getUpgradeMessage(plan, label),
                        requiredPlan: getRequiredPlan(label),
                      });
                      setSubmenu(false);
                      return;
                    }
                    setEffort(id);
                    setSubmenu(false);
                  }}
                  role="menuitemradio"
                  aria-checked={effort === id}
                  title={locked ? getUpgradeMessage(plan, label) : undefined}
                >
                  <span className="ei-name">{EFFORT[id].label}</span>
                  {locked ? (
                    <Lock size={12} style={{ marginLeft: "auto", color: "var(--text-faint)" }} />
                  ) : (
                    <>
                      {id === DEFAULT_EFFORT && <span className="ei-default">Default</span>}
                      <Check className="ei-check" />
                    </>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </div>

      <button
        className="toggle-row"
        onClick={() => {
          if (thinkingLocked) {
            openGate({
              feature: "thinking",
              message: getUpgradeMessage(plan, "Thinking mode"),
              requiredPlan: getRequiredPlan("Thinking mode"),
            });
            return;
          }
          setThinking(!thinking);
        }}
        role="menuitemcheckbox"
        aria-checked={thinking && !thinkingLocked}
        title={thinkingLocked ? getUpgradeMessage(plan, "Thinking mode") : undefined}
      >
        <SparkGlyph className="tr-icon" />
        <div className="tr-main">
          <div className="tr-title">
            Thinking
            {thinkingLocked && (
              <Lock size={11} style={{ marginLeft: 6, verticalAlign: "middle", color: "var(--text-faint)" }} />
            )}
          </div>
        </div>
        <div className={`switch ${thinking && !thinkingLocked ? "on" : ""}`} />
      </button>

      <button className="toggle-row" onClick={() => setWebSearch(!webSearch)} role="menuitemcheckbox" aria-checked={webSearch}>
        <Search className="tr-icon" />
        <div className="tr-main">
          <div className="tr-title">Web search</div>
          <div className="tr-sub">Let Forge look up current info when needed</div>
        </div>
        <div className={`switch ${webSearch ? "on" : ""}`} />
      </button>
    </motion.div>
  );
}
