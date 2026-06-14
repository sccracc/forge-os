"use client";

import { useState } from "react";
import { Check, Bot, RefreshCw, Play } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { createAgent, updateAgent } from "@/lib/data/agents";
import { useAgents } from "@/hooks/use-agents";
import { useAgentActions } from "@/hooks/use-agent-actions";
import { FORGE_MODELS_PUBLIC, isForgeModelId, type ForgeModelId } from "@/lib/ai/models.public";
import { isEffortId, type EffortId } from "@/lib/ai/effort";
import { toast } from "@/lib/store/toast-store";
import type { AgentDoc } from "@/lib/data/types";

interface AgentSpec {
  name?: string;
  avatar?: string;
  description?: string;
  systemPrompt?: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultThinking?: boolean;
  skillSlugs?: string[];
}

/** Renders a `forge-agent` code block from /agent-creator as a one-click save card. */
export function AgentSaveCard({ json }: { json: string }) {
  const { user } = useAuth();
  const { agents } = useAgents();
  const { toggleAgent, activeAgentId } = useAgentActions();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  let spec: AgentSpec | null = null;
  try {
    spec = JSON.parse(json) as AgentSpec;
  } catch {
    spec = null;
  }

  if (!spec || !spec.name || !spec.systemPrompt) {
    return (
      <pre className="code-block" style={{ padding: 14, whiteSpace: "pre-wrap" }}>
        <code>{json}</code>
      </pre>
    );
  }
  const s = spec;
  // Agents have no slug — match an existing one by name (case-insensitive).
  const existing = agents.find((a) => a.name.trim().toLowerCase() === s.name!.trim().toLowerCase());
  const isUpdate = Boolean(existing);
  const model: ForgeModelId | undefined = isForgeModelId(s.defaultModel) ? s.defaultModel : undefined;
  const effort: EffortId | undefined = isEffortId(s.defaultEffort) ? s.defaultEffort : undefined;

  const save = async () => {
    if (!user || savedId) return;
    setBusy(true);
    try {
      const data = {
        name: s.name!,
        avatar: s.avatar,
        description: s.description,
        systemPrompt: s.systemPrompt!,
        defaultModel: model,
        defaultEffort: effort,
        defaultThinking: typeof s.defaultThinking === "boolean" ? s.defaultThinking : undefined,
        skillSlugs: s.skillSlugs?.length ? s.skillSlugs : undefined,
      };
      if (existing) {
        await updateAgent(user.uid, existing.id, data);
        setSavedId(existing.id);
        toast.success(`Agent “${s.name}” updated`);
      } else {
        const id = await createAgent(user.uid, data);
        setSavedId(id);
        toast.success(`Agent “${s.name}” created`);
      }
    } catch {
      toast.error("Couldn't save agent");
    } finally {
      setBusy(false);
    }
  };

  const isActive = savedId != null && activeAgentId === savedId;
  const use = () => {
    if (!savedId) return;
    const doc: AgentDoc = {
      id: savedId,
      name: s.name!,
      description: s.description ?? "",
      avatar: s.avatar,
      systemPrompt: s.systemPrompt!,
      defaultModel: model,
      defaultEffort: effort,
      defaultThinking: s.defaultThinking,
      skillSlugs: s.skillSlugs,
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    toggleAgent(doc);
  };

  return (
    <div className="skill-card agent-save-card">
      <div className="skill-card-icon">{s.avatar || existing?.avatar || "🤖"}</div>
      <div className="skill-card-main">
        <b>{s.name}</b>
        {model && <span className="agent-model-badge">{FORGE_MODELS_PUBLIC[model].label}</span>}
        {s.description && <small>{s.description}</small>}
      </div>
      {savedId ? (
        <button className={isActive ? "btn-amber" : "btn-ghost"} onClick={use}>
          {isActive ? (
            <>
              <Check size={14} /> In use
            </>
          ) : (
            <>
              <Play size={14} /> Use agent
            </>
          )}
        </button>
      ) : (
        <button className="btn-amber" onClick={save} disabled={busy}>
          {busy ? (
            "Saving…"
          ) : isUpdate ? (
            <>
              <RefreshCw size={14} /> Update agent
            </>
          ) : (
            <>
              <Bot size={14} /> Create agent
            </>
          )}
        </button>
      )}
    </div>
  );
}
