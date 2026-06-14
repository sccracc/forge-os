"use client";

import { useState } from "react";
import { Check, Sparkles, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { createSkill, updateSkill, slugify } from "@/lib/data/skills";
import { useSkills } from "@/hooks/use-skills";
import { toast } from "@/lib/store/toast-store";

interface SkillSpec {
  name?: string;
  slug?: string;
  description?: string;
  instructions?: string;
  icon?: string;
  category?: string;
}

/** Renders a `forge-skill` code block from /skill-creator as a one-click save card. */
export function SkillSaveCard({ json }: { json: string }) {
  const { user } = useAuth();
  const { skills } = useSkills();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  let spec: SkillSpec | null = null;
  try {
    spec = JSON.parse(json) as SkillSpec;
  } catch {
    spec = null;
  }

  if (!spec || !spec.name || !spec.instructions) {
    return (
      <pre className="code-block" style={{ padding: 14, whiteSpace: "pre-wrap" }}>
        <code>{json}</code>
      </pre>
    );
  }
  const s = spec;
  const slug = slugify(s.slug || s.name || "skill");
  // If a skill with this slug already exists, this card updates it in place.
  const existing = skills.find((x) => x.slug === slug);
  const isUpdate = Boolean(existing);

  const save = async () => {
    if (!user || saved) return;
    setBusy(true);
    try {
      if (existing) {
        await updateSkill(user.uid, existing.id, {
          name: s.name,
          description: s.description,
          instructions: s.instructions,
          icon: s.icon ?? existing.icon,
          category: s.category ?? existing.category,
        });
        toast.success(`Skill “${s.name}” updated`);
      } else {
        await createSkill(user.uid, {
          name: s.name!,
          slug,
          description: s.description,
          instructions: s.instructions!,
          icon: s.icon,
          category: s.category,
          enabled: true,
        });
        toast.success(`Skill “${s.name}” created — invoke it with /${slug}`);
      }
      setSaved(true);
    } catch {
      toast.error("Couldn't save skill");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="skill-card">
      <div className="skill-card-icon">{s.icon || existing?.icon || "✨"}</div>
      <div className="skill-card-main">
        <b>{s.name}</b>
        <span className="pi-cmd">/{slug}</span>
        {s.description && <small>{s.description}</small>}
      </div>
      <button className="btn-amber" onClick={save} disabled={busy || saved}>
        {saved ? (
          <>
            <Check size={14} /> {isUpdate ? "Updated" : "Saved"}
          </>
        ) : busy ? (
          "Saving…"
        ) : isUpdate ? (
          <>
            <RefreshCw size={14} /> Update skill
          </>
        ) : (
          <>
            <Sparkles size={14} /> Create skill
          </>
        )}
      </button>
    </div>
  );
}
