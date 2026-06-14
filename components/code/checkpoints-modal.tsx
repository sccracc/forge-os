"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, Trash2, Plus } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  subscribeCheckpoints,
  createCheckpoint,
  restoreCheckpoint,
  deleteCheckpoint,
} from "@/lib/data/checkpoints";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import type { CheckpointDoc, FileDoc } from "@/lib/data/types";

export function CheckpointsModal({
  projectId,
  files,
  onClose,
}: {
  projectId: string;
  files: FileDoc[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [list, setList] = useState<CheckpointDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!user) return;
    return subscribeCheckpoints(user.uid, projectId, setList);
  }, [user, projectId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const saveNow = async () => {
    if (!user) return;
    setBusy(true);
    const id = await createCheckpoint(user.uid, projectId, "Manual checkpoint", "manual", files).catch(() => null);
    setBusy(false);
    if (id) toast.success("Checkpoint saved");
    else toast.error("Project is too large to checkpoint");
  };

  const restore = async (cp: CheckpointDoc) => {
    if (!user) return;
    if (
      !(await confirm({
        title: `Restore “${cp.label}”?`,
        message: "Your current files will be overwritten with this checkpoint.",
        confirmLabel: "Restore",
        danger: false,
      }))
    )
      return;
    setBusy(true);
    try {
      await restoreCheckpoint(user.uid, projectId, cp.id);
      toast.success("Project restored");
      onClose();
    } catch {
      toast.error("Couldn't restore checkpoint");
    } finally {
      setBusy(false);
    }
  };

  const del = async (cp: CheckpointDoc) => {
    if (!user) return;
    await deleteCheckpoint(user.uid, projectId, cp.id).catch(() => {});
  };

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 580, maxWidth: "100%" }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>History &amp; checkpoints</h3>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: "62vh", overflowY: "auto" }}>
          <button className="btn-amber" onClick={saveNow} disabled={busy} style={{ marginBottom: 14 }}>
            <Plus size={15} /> Save checkpoint now
          </button>
          {list.length === 0 ? (
            <div className="hint">
              No checkpoints yet. Forge auto-saves one before each AI build, and you can save manual ones anytime.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map((cp, i) => (
                <div key={cp.id} className="skill-row" style={{ padding: "11px 13px" }}>
                  <div className="skill-row-main">
                    <div className="skill-row-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {i === 0 && (
                        <span className="ck-ripple" title="Current restore point">
                          <span className="ring" />
                          <span className="ring" />
                          <span className="core" />
                        </span>
                      )}
                      {cp.label}
                      <span className="skill-badge muted">{cp.kind}</span>
                    </div>
                    <div className="skill-row-desc">
                      {cp.fileCount} file{cp.fileCount === 1 ? "" : "s"} · {new Date(cp.at).toLocaleString()}
                    </div>
                  </div>
                  <div className="skill-row-actions">
                    <button className="msg-action" title="Restore" onClick={() => restore(cp)} disabled={busy}>
                      <RotateCcw size={15} />
                    </button>
                    <button className="msg-action" title="Delete" onClick={() => del(cp)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
