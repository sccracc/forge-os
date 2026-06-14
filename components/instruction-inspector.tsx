"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useUIStore } from "@/lib/store/ui-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useSkills } from "@/hooks/use-skills";

/**
 * Instruction Inspector — shows the exact merged system prompt (agent, project,
 * FORGE.md, custom instructions, memory, skills, context) for full transparency.
 */
export function InstructionInspector() {
  const open = useUIStore((s) => s.instructionInspectorOpen);
  const setOpen = useUIStore((s) => s.setInstructionInspectorOpen);
  const { getIdToken } = useAuth();
  const { skills } = useSkills();
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) {
      setText(null);
      setErr(false);
      return;
    }
    const s = useComposerStore.getState();
    const active = s.activeSkillSlugs
      .map((slug) => skills.find((x) => x.slug === slug && x.enabled))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    let live = true;
    (async () => {
      const token = await getIdToken();
      if (!token) {
        setErr(true);
        return;
      }
      try {
        const res = await fetch("/api/inspect", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            forgeModelId: s.model,
            effort: s.effort,
            thinking: s.thinking,
            mode: "chat",
            toolsEnabled: s.toolsEnabled,
            agentId: s.activeAgentId ?? undefined,
            skillSlugs: s.activeSkillSlugs,
            skills: active.map((a) => ({ name: a.name, instructions: a.instructions })),
            skillCatalog: skills.map((a) => ({ name: a.name, slug: a.slug, description: a.description || undefined })),
          }),
        });
        const j = (await res.json()) as { systemPrompt?: string };
        if (live) setText(j.systemPrompt ?? "");
      } catch {
        if (live) setErr(true);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted || !open) return null;

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Instruction inspector">
        <div className="artifact-modal-head">
          <div className="am-title">
            <span>Active instructions</span>
          </div>
          <div className="am-actions">
            <button className="icon-btn" onClick={copy} title="Copy" aria-label="Copy">
              {copied ? <span className="copy-pop"><Check size={15} /></span> : <Copy size={15} />}
            </button>
            <button className="panel-close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="artifact-modal-body">
          <div className="am-code">
            <pre>
              <code>{text === null && !err ? "Loading…" : err ? "Couldn't load instructions." : text}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
