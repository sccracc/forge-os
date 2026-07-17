"use client";

import { useRef, useState } from "react";
import {
  Plus,
  Upload,
  Pencil,
  Copy,
  Download,
  Trash2,
  Star,
  Sparkles,
} from "lucide-react";
import { SimpleTopbar } from "@/components/shell/topbar";
import { SkillEditor } from "@/components/skills/skill-editor";
import { useAuth } from "@/components/auth/auth-provider";
import { useSkills, orderSkills } from "@/hooks/use-skills";
import {
  setSkillEnabled,
  setSkillFavorite,
  deleteSkill,
  duplicateSkill,
  exportSkill,
  importSkills,
} from "@/lib/data/skills";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import type { Skill } from "@/lib/data/types";

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SkillsPage() {
  const { user } = useAuth();
  const { skills, loading } = useSkills();
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ordered = orderSkills(skills);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    try {
      const text = await file.text();
      const n = await importSkills(user.uid, text);
      toast.success(n ? `Imported ${n} skill${n === 1 ? "" : "s"}` : "No skills found in file");
    } catch {
      toast.error("Couldn't import — is it valid skill JSON?");
    }
  };

  const remove = async (s: Skill) => {
    if (!user) return;
    if (
      !(await confirm({
        title: `Delete “${s.name}”?`,
        message: "This skill will be permanently deleted.",
        confirmLabel: "Delete",
      }))
    )
      return;
    await deleteSkill(user.uid, s.id);
    toast.success("Skill deleted");
  };

  return (
    <>
      <SimpleTopbar title="Skills" />
      <div className="content-area">
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px" }}>
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Skills</h1>
                <p style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.6 }}>
                  Reusable instruction sets. Invoke any enabled skill from the composer with{" "}
                  <code className="md" style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}>/</code>
                  . Type <b>/skill-creator</b> and describe what you want to make a new one.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> Import
                </button>
                <button className="btn-amber" onClick={() => setEditing("new")}>
                  <Plus size={16} /> New skill
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={onImport}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            {loading && skills.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 72, borderRadius: 14 }} />
                ))}
              </div>
            ) : ordered.length === 0 ? (
              <div className="empty-state" style={{ padding: "60px 20px" }}>
                <div className="es-glyph">
                  <Sparkles size={28} />
                </div>
                <h2>No skills yet</h2>
                <p>Create your first skill, or type /skill-creator in any chat to make one.</p>
                <button className="btn-amber" style={{ marginTop: 16 }} onClick={() => setEditing("new")}>
                  <Plus size={16} /> New skill
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ordered.map((s) => (
                  <div key={s.id} className="skill-row">
                    <div className="skill-row-icon">{s.icon || "✨"}</div>
                    <div className="skill-row-main">
                      <div className="skill-row-title">
                        {s.name}
                        <span className="pi-cmd">/{s.slug}</span>
                        {s.builtin && <span className="skill-badge">Built-in</span>}
                        {s.category && <span className="skill-badge muted">{s.category}</span>}
                      </div>
                      {s.description && <div className="skill-row-desc">{s.description}</div>}
                    </div>
                    <div className="skill-row-actions">
                      <button
                        className={`msg-action ${s.favorite ? "on" : ""}`}
                        title={s.favorite ? "Unfavorite" : "Favorite"}
                        onClick={() => user && setSkillFavorite(user.uid, s.id, !s.favorite)}
                      >
                        <Star size={15} fill={s.favorite ? "currentColor" : "none"} />
                      </button>
                      <button className="msg-action" title="Edit" onClick={() => setEditing(s)}>
                        <Pencil size={15} />
                      </button>
                      <button
                        className="msg-action"
                        title="Duplicate"
                        onClick={async () => {
                          if (!user) return;
                          await duplicateSkill(user.uid, s.id);
                          toast.success("Skill duplicated");
                        }}
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        className="msg-action"
                        title="Export"
                        onClick={() => download(`${s.slug}.json`, exportSkill(s))}
                      >
                        <Download size={15} />
                      </button>
                      <button className="msg-action" title="Delete" onClick={() => remove(s)}>
                        <Trash2 size={15} />
                      </button>
                      <button
                        className={`switch ${s.enabled ? "on" : ""}`}
                        title={s.enabled ? "Enabled" : "Disabled"}
                        aria-pressed={s.enabled}
                        onClick={() => user && setSkillEnabled(user.uid, s.id, !s.enabled)}
                        style={{ marginLeft: 4 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ height: 40 }} />
          </div>
        </div>
      </div>

      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
