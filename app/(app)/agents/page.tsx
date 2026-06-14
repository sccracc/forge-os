"use client";

import { useRef, useState } from "react";
import { Plus, Upload, Pencil, Copy, Download, Trash2, Bot, Check } from "lucide-react";
import { SimpleTopbar } from "@/components/shell/topbar";
import { AgentEditor } from "@/components/agents/agent-editor";
import { useAuth } from "@/components/auth/auth-provider";
import { useAgents } from "@/hooks/use-agents";
import { useAgentActions } from "@/hooks/use-agent-actions";
import { CountUp } from "@/components/ui/count-up";
import {
  setAgentEnabled,
  deleteAgent,
  duplicateAgent,
  exportAgent,
  importAgents,
} from "@/lib/data/agents";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import type { AgentDoc } from "@/lib/data/types";

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AgentsPage() {
  const { user } = useAuth();
  const { agents, loading } = useAgents();
  const { activeAgentId, toggleAgent, clearAgent } = useAgentActions();
  const [editing, setEditing] = useState<AgentDoc | "new" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    try {
      const n = await importAgents(user.uid, await file.text());
      toast.success(n ? `Imported ${n} agent${n === 1 ? "" : "s"}` : "No agents found in file");
    } catch {
      toast.error("Couldn't import — is it valid agent JSON?");
    }
  };

  const remove = async (a: AgentDoc) => {
    if (!user) return;
    if (
      !(await confirm({
        title: `Delete “${a.name}”?`,
        message: "This agent will be permanently deleted.",
        confirmLabel: "Delete",
      }))
    )
      return;
    if (activeAgentId === a.id) clearAgent();
    await deleteAgent(user.uid, a.id);
    toast.success("Agent deleted");
  };

  return (
    <>
      <SimpleTopbar title="Agents" />
      <div className="content-area">
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px" }}>
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
                  Agents
                  {agents.length > 0 && (
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: 14,
                        fontWeight: 700,
                        color: "var(--amber)",
                        background: "var(--amber-tint)",
                        borderRadius: 8,
                        padding: "2px 9px",
                        verticalAlign: "middle",
                      }}
                    >
                      <CountUp to={agents.length} durationMs={800} />
                    </span>
                  )}
                </h1>
                <p style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.6 }}>
                  Reusable AI personas with their own system prompt, model, effort, and skills.
                  Select one to apply it to your conversations and builds.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> Import
                </button>
                <button className="btn-amber" onClick={() => setEditing("new")}>
                  <Plus size={16} /> New agent
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} style={{ display: "none" }} />
              </div>
            </div>

            {loading && agents.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 72, borderRadius: 14 }} />
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div className="empty-state" style={{ padding: "60px 20px" }}>
                <div className="es-glyph">
                  <Bot size={28} />
                </div>
                <h2>No agents yet</h2>
                <p>Create a reusable persona — a frontend engineer, an editor, a researcher — with its own instructions and defaults.</p>
                <button className="btn-amber" style={{ marginTop: 16 }} onClick={() => setEditing("new")}>
                  <Plus size={16} /> New agent
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {agents.map((a) => {
                  const active = activeAgentId === a.id;
                  return (
                    <div key={a.id} className={`skill-row ${active ? "active-agent" : ""}`}>
                      <div className="skill-row-icon">{a.avatar || "🤖"}</div>
                      <div className="skill-row-main">
                        <div className="skill-row-title">
                          {a.name}
                          {active && <span className="skill-badge">Active</span>}
                          {!a.enabled && <span className="skill-badge muted">Disabled</span>}
                          {a.defaultModel && <span className="skill-badge muted">{a.defaultModel === "magnum-2.8" ? "Magnum 2.8" : "Spark 2.5"}</span>}
                        </div>
                        {a.description && <div className="skill-row-desc">{a.description}</div>}
                      </div>
                      <div className="skill-row-actions">
                        <button
                          className={active ? "btn-amber" : "btn-ghost"}
                          style={{ fontSize: 12.5, padding: "6px 11px" }}
                          onClick={() => toggleAgent(a)}
                          disabled={!a.enabled}
                          title={active ? "Stop using" : "Use this agent"}
                        >
                          {active ? <Check size={14} /> : null} {active ? "Active" : "Use"}
                        </button>
                        <button className="msg-action" title="Edit" onClick={() => setEditing(a)}>
                          <Pencil size={15} />
                        </button>
                        <button
                          className="msg-action"
                          title="Duplicate"
                          onClick={async () => {
                            if (!user) return;
                            await duplicateAgent(user.uid, a.id);
                            toast.success("Agent duplicated");
                          }}
                        >
                          <Copy size={15} />
                        </button>
                        <button className="msg-action" title="Export" onClick={() => download(`${a.name}.json`, exportAgent(a))}>
                          <Download size={15} />
                        </button>
                        <button className="msg-action" title="Delete" onClick={() => remove(a)}>
                          <Trash2 size={15} />
                        </button>
                        <button
                          className={`switch ${a.enabled ? "on" : ""}`}
                          title={a.enabled ? "Enabled" : "Disabled"}
                          aria-pressed={a.enabled}
                          onClick={() => user && setAgentEnabled(user.uid, a.id, !a.enabled)}
                          style={{ marginLeft: 4 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ height: 40 }} />
          </div>
        </div>
      </div>

      {editing && <AgentEditor agent={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
