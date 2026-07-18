"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Search, FolderPlus, Sparkles, Bot, Trash2 } from "lucide-react";
import { ForgeMark } from "@/components/icons";
import { ModeSwitcher } from "./mode-switcher";
import { AccountRow } from "./account-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useConversations } from "@/hooks/use-conversations";
import { useProjects } from "@/hooks/use-projects";
import { useUIStore } from "@/lib/store/ui-store";
import { deleteConversation } from "@/lib/data/chat";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import { dateBucket } from "@/lib/utils";
import type { ConversationDoc } from "@/lib/data/types";

const BUCKET_ORDER = ["Today", "Yesterday", "Previous 7 Days", "Older"];

/** #26 · typewrites a chat title when it changes (e.g. "New chat" → generated). */
function TitleText({ text }: { text: string }) {
  const [display, setDisplay] = useState(text);
  const prev = useRef(text);

  useEffect(() => {
    if (prev.current === text) return;
    prev.current = text;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(text);
      return;
    }
    let i = 0;
    setDisplay("");
    const id = setInterval(() => {
      i++;
      setDisplay(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 34);
    return () => clearInterval(id);
  }, [text]);

  return <>{display || text}</>;
}

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const isCode = pathname.startsWith("/code");
  const activeCid = /^\/c\/(.+)$/.exec(pathname)?.[1];
  const { conversations, loading } = useConversations();
  const { projects } = useProjects();
  const activeProjectId = /^\/code\/(.+)$/.exec(pathname)?.[1];
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("forge:focus-search", focus);
    return () => window.removeEventListener("forge:focus-search", focus);
  }, []);

  const go = (path: string) => {
    setMobileSidebarOpen(false);
    router.push(path);
  };

  const onDeleteChat = async (c: ConversationDoc) => {
    if (!user) return;
    if (
      !(await confirm({
        title: `Delete “${c.title}”?`,
        message: "This chat will be permanently deleted.",
        confirmLabel: "Delete",
      }))
    )
      return;
    const wasActive = activeCid === c.id;
    await deleteConversation(user.uid, c.id).catch(() => {});
    toast.success("Chat deleted");
    if (wasActive) router.push("/");
  };

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    const groups: Record<string, ConversationDoc[]> = {};
    for (const c of list) {
      const b = dateBucket(c.updatedAt);
      (groups[b] ??= []).push(c);
    }
    return groups;
  }, [conversations, search]);

  return (
    <aside
      className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
    >
      <div className="logo">
        <div className="logo-mark">
          <ForgeMark style={{ width: 18, height: 18, color: "var(--on-accent)" }} />
        </div>
        <div className="logo-text">
          Forge<span>&nbsp;OS</span>
        </div>
      </div>

      <ModeSwitcher />

      {isCode ? (
        <>
          <button
            className="btn-amber"
            style={{ marginTop: 8 }}
            onClick={() => go("/code")}
          >
            <FolderPlus size={16} /> New Project
          </button>
          <div className="nav-section">
            <div className="nav-label">Recent Projects</div>
            {projects.length === 0 ? (
              <div
                style={{
                  padding: "10px 11px",
                  fontSize: 12.5,
                  color: "var(--text-faint)",
                  lineHeight: 1.6,
                }}
              >
                Projects you create appear here.
              </div>
            ) : (
              projects.slice(0, 12).map((p) => (
                <button
                  key={p.id}
                  className={`chat-item ${activeProjectId === p.id ? "active" : ""}`}
                  onClick={() => go(`/code/${p.id}`)}
                  title={p.name}
                >
                  <span
                    className="lang-dot"
                    style={{
                      background: `linear-gradient(135deg, ${p.gradient?.[0] ?? "#ff7a1a"}, ${p.gradient?.[1] ?? "#c2470a"})`,
                    }}
                  />
                  <span className="chat-item-label">{p.name}</span>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <button
            className="btn-amber"
            style={{ marginTop: 8 }}
            onClick={() => go("/")}
          >
            <Plus size={16} /> New Chat
          </button>

          <button className="sidebar-search" onClick={() => searchRef.current?.focus()}>
            <Search />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              style={{
                border: "none",
                background: "none",
                outline: "none",
                color: "var(--text)",
                fontFamily: "inherit",
                fontSize: 13,
                flex: 1,
                minWidth: 0,
              }}
            />
          </button>

          <div className="nav-section">
            {loading && conversations.length === 0 ? (
              <div style={{ padding: "8px 0" }}>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ height: 30, margin: "4px 6px", borderRadius: 9 }}
                  />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div
                style={{
                  padding: "14px 11px",
                  fontSize: 12.5,
                  color: "var(--text-faint)",
                  lineHeight: 1.6,
                }}
              >
                No chats yet. Start a new conversation to see it here.
              </div>
            ) : (
              BUCKET_ORDER.map((bucket) => {
                const items = grouped[bucket];
                if (!items || items.length === 0) return null;
                return (
                  <div key={bucket}>
                    <div className="nav-label">{bucket}</div>
                    <AnimatePresence initial={false}>
                      {items.map((c) => (
                        <motion.div
                          key={c.id}
                          layout
                          initial={{ opacity: 0, x: -12, filter: "blur(4px)" }}
                          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, x: 14 }}
                          transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
                          className={`chat-item ${activeCid === c.id ? "active" : ""}`}
                          onClick={() => go(`/c/${c.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              go(`/c/${c.id}`);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title={c.title}
                        >
                          <span className="chat-item-label">
                            <TitleText text={c.title} />
                          </span>
                          <span
                            className="row-action"
                            role="button"
                            aria-label="Delete chat"
                            title="Delete chat"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChat(c);
                            }}
                          >
                            <Trash2 size={13} />
                          </span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <div className="nav-section" style={{ flexGrow: 0, marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
        <button
          className={`chat-item ${pathname === "/skills" ? "active" : ""}`}
          onClick={() => go("/skills")}
        >
          <Sparkles size={15} style={{ flexShrink: 0 }} />
          <span className="chat-item-label">Skills</span>
        </button>
        <button
          className={`chat-item ${pathname === "/agents" ? "active" : ""}`}
          onClick={() => go("/agents")}
        >
          <Bot size={15} style={{ flexShrink: 0 }} />
          <span className="chat-item-label">Agents</span>
        </button>
      </div>

      <AccountRow />
    </aside>
  );
}
