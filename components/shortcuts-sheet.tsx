"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUIStore } from "@/lib/store/ui-store";
import { modLabel, altLabel } from "@/lib/platform";

export function ShortcutsSheet() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);
  const [mounted, setMounted] = useState(false);

  // Computed after mount so the modifier reads correctly per OS (⌘ vs Ctrl).
  const groups = useMemo<{ title: string; items: { keys: string[]; label: string }[] }[]>(() => {
    const mod = modLabel();
    return [
      {
        title: "General",
        items: [
          { keys: [mod, "K"], label: "Open command palette" },
          { keys: ["?"], label: "Show keyboard shortcuts" },
          { keys: ["Esc"], label: "Close menus, panels, dialogs" },
        ],
      },
      {
        title: "Navigation",
        items: [
          { keys: [altLabel(), "N"], label: "New chat" },
          { keys: [mod, "B"], label: "Toggle sidebar" },
        ],
      },
      {
        title: "Composer",
        items: [
          { keys: ["Enter"], label: "Send message" },
          { keys: ["Shift", "Enter"], label: "New line" },
          { keys: ["/"], label: "Open skills picker" },
        ],
      },
    ];
  }, [mounted]);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="modal-head">
          <h3>Keyboard shortcuts</h3>
          <button className="panel-close" onClick={() => setOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {groups.map((g) => (
            <div key={g.title} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-faint)",
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                {g.title}
              </div>
              {g.items.map((it) => (
                <div
                  key={it.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 0",
                  }}
                >
                  <span style={{ fontSize: 14 }}>{it.label}</span>
                  <span style={{ display: "flex", gap: 5 }}>
                    {it.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
