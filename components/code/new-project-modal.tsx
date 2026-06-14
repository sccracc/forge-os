"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { createProject } from "@/lib/data/projects";
import { STARTERS } from "@/lib/code/starters";
import { toast } from "@/lib/store/toast-store";

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [starterId, setStarterId] = useState("html");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const create = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const id = await createProject(user.uid, {
        name: name.trim() || STARTERS.find((s) => s.id === starterId)!.name + " project",
        starterId,
      });
      onClose();
      router.push(`/code/${id}`);
    } catch {
      toast.error("Couldn't create project");
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 560, maxWidth: "100%" }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>New project</h3>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Starter</label>
            <div className="starter-grid">
              {STARTERS.map((s) => (
                <button
                  key={s.id}
                  className={`starter-card ${starterId === s.id ? "selected" : ""}`}
                  onClick={() => setStarterId(s.id)}
                >
                  <span
                    className="starter-swatch"
                    style={{ background: `linear-gradient(135deg, ${s.gradient[0]}, ${s.gradient[1]})` }}
                  />
                  <span className="starter-name">{s.name}</span>
                  <span className="starter-desc">{s.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-amber" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
