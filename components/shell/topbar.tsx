"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, PanelLeft, MoreHorizontal, Pencil, Trash2, Download } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useUIStore } from "@/lib/store/ui-store";
import { useConversation } from "@/hooks/use-conversation";
import { updateConversation, deleteConversation, getMessagesOnce } from "@/lib/data/chat";
import { buildActivePath } from "@/lib/data/tree";
import { exportConversationMarkdown } from "@/lib/export";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";

export function TopbarFrame({
  title,
  children,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  return (
    <div className="topbar">
      <button
        className="icon-btn mobile-only"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu />
      </button>
      <button
        className="icon-btn desktop-only"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft />
      </button>
      <div className="topbar-title">{title}</div>
      <div className="topbar-spacer" />
      {children}
    </div>
  );
}

export function ChatTopbar({ conversationId }: { conversationId: string | null }) {
  const router = useRouter();
  const { user } = useAuth();
  const conversation = useConversation(conversationId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const title = conversation?.title || "Forge Chat";

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const startRename = () => {
    setDraft(conversation?.title || "");
    setRenaming(true);
    setMenuOpen(false);
  };

  const saveRename = async () => {
    const t = draft.trim();
    setRenaming(false);
    if (user && conversationId && t && t !== conversation?.title) {
      await updateConversation(user.uid, conversationId, { title: t });
      toast.success("Chat renamed");
    }
  };

  const doDelete = async () => {
    setMenuOpen(false);
    if (!user || !conversationId) return;
    if (
      !(await confirm({
        title: "Delete this chat?",
        message: "This conversation will be permanently deleted.",
        confirmLabel: "Delete",
      }))
    )
      return;
    await deleteConversation(user.uid, conversationId);
    toast.success("Chat deleted");
    router.push("/");
  };

  const doExport = async () => {
    setMenuOpen(false);
    if (!user || !conversationId || !conversation) return;
    try {
      const msgs = await getMessagesOnce(user.uid, conversationId);
      const path = buildActivePath(msgs, conversation.activeLeafId);
      exportConversationMarkdown(
        conversation,
        path.map((n) => ({ role: n.role, content: n.content, reasoning: n.reasoning })),
        { includeThinking: true }
      );
      toast.success("Exported as Markdown");
    } catch {
      toast.error("Couldn't export this chat");
    }
  };

  return (
    <TopbarFrame
      title={
        renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            style={{
              border: "1px solid var(--amber)",
              background: "var(--surface)",
              borderRadius: 7,
              padding: "4px 8px",
              font: "inherit",
              fontWeight: 600,
              color: "var(--text)",
              outline: "none",
              width: 280,
              maxWidth: "60vw",
            }}
          />
        ) : (
          title
        )
      }
    >
      {conversationId && (
        <div ref={wrapRef} style={{ position: "relative" }}>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Chat options"
          >
            <MoreHorizontal />
          </button>
          {menuOpen && (
            <div
              className="menu"
              style={{
                left: "auto",
                right: 0,
                bottom: "auto",
                top: "calc(100% + 6px)",
                transform: "none",
                width: 200,
              }}
            >
              <button className="menu-item" onClick={startRename}>
                <Pencil size={16} style={{ color: "var(--text-dim)" }} />
                <div className="mi-main">
                  <div className="mi-title" style={{ fontWeight: 500 }}>
                    Rename
                  </div>
                </div>
              </button>
              <button className="menu-item" onClick={doExport}>
                <Download size={16} style={{ color: "var(--text-dim)" }} />
                <div className="mi-main">
                  <div className="mi-title" style={{ fontWeight: 500 }}>
                    Export as Markdown
                  </div>
                </div>
              </button>
              <button className="menu-item" onClick={doDelete}>
                <Trash2 size={16} style={{ color: "var(--danger)" }} />
                <div className="mi-main">
                  <div className="mi-title" style={{ fontWeight: 500, color: "var(--danger)" }}>
                    Delete chat
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
      )}
    </TopbarFrame>
  );
}

export function SimpleTopbar({ title }: { title: string }) {
  return <TopbarFrame title={title} />;
}
