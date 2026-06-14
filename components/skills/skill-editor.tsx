"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { createSkill, updateSkill, slugify } from "@/lib/data/skills";
import { toast } from "@/lib/store/toast-store";
import type { Skill } from "@/lib/data/types";

export function SkillEditor({
  skill,
  onClose,
}: {
  skill: Skill | "new";
  onClose: () => void;
}) {
  const { user } = useAuth();
  const editing = skill !== "new";
  const init = editing ? (skill as Skill) : null;

  const [name, setName] = useState(init?.name ?? "");
  const [slug, setSlug] = useState(init?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(editing);
  const [description, setDescription] = useState(init?.description ?? "");
  const [icon, setIcon] = useState(init?.icon ?? "✨");
  const [category, setCategory] = useState(init?.category ?? "");
  const [instructions, setInstructions] = useState(init?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!editing && !slugEdited) setSlug(slugify(name));
  }, [name, editing, slugEdited]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !instructions.trim()) {
      toast.error("Name and instructions are required");
      return;
    }
    setBusy(true);
    try {
      if (editing && init) {
        await updateSkill(user.uid, init.id, {
          name,
          slug: slug !== init.slug ? slug : undefined,
          description,
          icon,
          category,
          instructions,
        });
        toast.success("Skill updated");
      } else {
        await createSkill(user.uid, {
          name,
          slug,
          description,
          icon,
          category,
          instructions,
          enabled: true,
        });
        toast.success("Skill created");
      }
      onClose();
    } catch {
      toast.error("Couldn't save skill");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ width: 620, maxWidth: "100%" }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{editing ? "Edit skill" : "New skill"}</h3>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ width: 86 }}>
              <label>Icon</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value.slice(0, 2))}
                style={{ textAlign: "center", fontSize: 20 }}
                aria-label="Icon emoji"
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing Copywriter" autoFocus />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Slash command</label>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="marketing-copywriter"
              />
              <div className="hint">Invoke with /{slug || "slug"}</div>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Writing" />
            </div>
          </div>

          <div className="field">
            <label>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When should Forge use this skill?"
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Write the SKILL.md-style instructions the assistant should follow when this skill is active…"
              style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: 13 }}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-amber" onClick={save} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create skill"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
