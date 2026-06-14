"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnabledSkills } from "@/hooks/use-skills";
import { createAgent, updateAgent } from "@/lib/data/agents";
import { FORGE_MODEL_IDS, FORGE_MODELS_PUBLIC, type ForgeModelId } from "@/lib/ai/models.public";
import { EFFORT, EFFORT_IDS, type EffortId } from "@/lib/ai/effort";
import { toast } from "@/lib/store/toast-store";
import type { AgentDoc } from "@/lib/data/types";

export function AgentEditor({ agent, onClose }: { agent: AgentDoc | "new"; onClose: () => void }) {
  const { user } = useAuth();
  const { skills } = useEnabledSkills();
  const editing = agent !== "new";
  const init = editing ? (agent as AgentDoc) : null;

  const [name, setName] = useState(init?.name ?? "");
  const [avatar, setAvatar] = useState(init?.avatar ?? "🤖");
  const [description, setDescription] = useState(init?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(init?.systemPrompt ?? "");
  const [model, setModel] = useState<ForgeModelId | "">(init?.defaultModel ?? "");
  const [effort, setEffort] = useState<EffortId | "">(init?.defaultEffort ?? "");
  const [thinking, setThinking] = useState<boolean>(init?.defaultThinking ?? false);
  const [skillSlugs, setSkillSlugs] = useState<string[]>(init?.skillSlugs ?? []);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const toggleSkill = (slug: string) =>
    setSkillSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !systemPrompt.trim()) {
      toast.error("Name and system prompt are required");
      return;
    }
    setBusy(true);
    try {
      const data = {
        name,
        avatar,
        description,
        systemPrompt,
        defaultModel: model || undefined,
        defaultEffort: effort || undefined,
        defaultThinking: thinking,
        skillSlugs: skillSlugs.length ? skillSlugs : undefined,
      };
      if (editing && init) {
        await updateAgent(user.uid, init.id, data);
        toast.success("Agent updated");
      } else {
        await createAgent(user.uid, data);
        toast.success("Agent created");
      }
      onClose();
    } catch {
      toast.error("Couldn't save agent");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640, maxWidth: "100%" }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{editing ? "Edit agent" : "New agent"}</h3>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ width: 86 }}>
              <label>Avatar</label>
              <input
                value={avatar}
                onChange={(e) => setAvatar(e.target.value.slice(0, 2))}
                style={{ textAlign: "center", fontSize: 20 }}
                aria-label="Avatar emoji"
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend Engineer" autoFocus />
            </div>
          </div>

          <div className="field">
            <label>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent is for"
            />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Default model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as ForgeModelId | "")}
                style={selectStyle}
              >
                <option value="">No preference</option>
                {FORGE_MODEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {FORGE_MODELS_PUBLIC[id].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Default effort</label>
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as EffortId | "")}
                style={selectStyle}
              >
                <option value="">No preference</option>
                {EFFORT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {EFFORT[id].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 120 }}>
              <label>Thinking</label>
              <button
                className={`switch ${thinking ? "on" : ""}`}
                onClick={() => setThinking((t) => !t)}
                aria-pressed={thinking}
                style={{ marginTop: 6 }}
              />
            </div>
          </div>

          <div className="field">
            <label>System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Define the agent's persona, expertise, and how it should behave…"
              style={{ minHeight: 160, fontFamily: "var(--font-mono)", fontSize: 13 }}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>Attached skills {skillSlugs.length > 0 && `(${skillSlugs.length})`}</label>
            {skills.length === 0 ? (
              <div className="hint">No enabled skills yet — create some in Skills to attach them.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {skills.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => toggleSkill(s.slug)}
                    className={skillSlugs.includes(s.slug) ? "btn-amber" : "btn-ghost"}
                    style={{ fontSize: 12.5, padding: "6px 10px" }}
                  >
                    {s.icon || "✨"} {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="hint">These skills activate automatically when the agent is selected.</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-amber" onClick={save} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create agent"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-bright)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 14,
};
