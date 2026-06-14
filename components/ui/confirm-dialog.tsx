"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useConfirmStore } from "@/lib/store/confirm-store";

/** Global custom confirm dialog — rendered once, driven by confirm(). */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const resolve = useConfirmStore((s) => s.resolve);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolve(false);
      else if (e.key === "Enter") resolve(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, resolve]);

  if (!mounted || !request) return null;
  const danger = request.danger ?? true;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && resolve(false)}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={request.title}>
        <div className={`confirm-icon ${danger ? "danger" : ""}`}>
          {danger ? <Trash2 size={20} /> : <AlertTriangle size={20} />}
        </div>
        <h3 className="confirm-title">{request.title}</h3>
        {request.message && <p className="confirm-message">{request.message}</p>}
        <div className="confirm-actions">
          <button className="btn-ghost" onClick={() => resolve(false)}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={danger ? "btn-danger" : "btn-amber"}
            onClick={() => resolve(true)}
            autoFocus
          >
            {request.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
