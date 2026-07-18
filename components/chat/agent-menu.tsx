"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, ChevronDown, Plus } from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
import { useAgentActions } from "@/hooks/use-agent-actions";

/**
 * Inline agent picker for the composer (chat) and build dock (Forge Code).
 * Lets you "call" a saved agent right where you're typing — pick one to adopt
 * its persona/instructions (and its model/effort/skills), or clear it. The
 * active agent also shows as a removable chip above the input.
 */
export function AgentMenu({ align = "left" }: { align?: "left" | "right" }) {
  const router = useRouter();
  const { agents } = useAgents();
  const { activeAgentId, toggleAgent } = useAgentActions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const enabled = agents.filter((a) => a.enabled);
  const active = agents.find((a) => a.id === activeAgentId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-anchor agent-anchor" ref={ref}>
      <button
        className={`agent-trigger ${active ? "on" : ""} ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={active ? `Agent: ${active.name}` : "Use an agent"}
      >
        <Bot size={15} />
        <span className="agent-trigger-label">
          {active ? `${active.avatar ? active.avatar + " " : ""}${active.name}` : "Agent"}
        </span>
        <ChevronDown className="chev" size={13} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={`popover agent-pop menu-cascade ${align}`}
            role="menu"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            style={{ bottom: "calc(100% + 8px)", [align]: 0 } as React.CSSProperties}
          >
            <div className="agent-pop-head">Agents</div>

            {enabled.length === 0 ? (
              <div className="popover-empty">
                No agents yet. Create a reusable persona to call here.
              </div>
            ) : (
              enabled.map((a) => {
                const isActive = a.id === activeAgentId;
                return (
                  <button
                    key={a.id}
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`popover-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      toggleAgent(a);
                      setOpen(false);
                    }}
                  >
                    <div className="pi-icon">{a.avatar || <Bot size={15} />}</div>
                    <div className="pi-main">
                      <div className="pi-title">{a.name}</div>
                      {a.description && <div className="pi-sub">{a.description}</div>}
                    </div>
                    {isActive && <Check size={15} className="pi-check" />}
                  </button>
                );
              })
            )}

            <div className="menu-sep" />
            <button
              role="menuitem"
              className="popover-item agent-pop-manage"
              onClick={() => {
                setOpen(false);
                router.push("/agents");
              }}
            >
              <div className="pi-icon">
                <Plus size={15} />
              </div>
              <div className="pi-main">
                <div className="pi-title">{enabled.length === 0 ? "Create an agent" : "Manage agents"}</div>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
