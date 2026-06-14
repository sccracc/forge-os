"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Search,
  MessageSquarePlus,
  FolderPlus,
  MessagesSquare,
  Code2,
  Settings,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  LogOut,
  Sparkles,
  Bot,
  ScrollText,
} from "lucide-react";
import { useUIStore } from "@/lib/store/ui-store";
import { useAuth } from "@/components/auth/auth-provider";
import { altLabel } from "@/lib/platform";

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const toggleOpen = useUIStore((s) => s.toggleCommandPalette);
  const setThemePref = useUIStore((s) => s.setThemePref);
  const setMode = useUIStore((s) => s.setMode);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const setInstructionInspectorOpen = useUIStore((s) => s.setInstructionInspectorOpen);
  const { signOutUser, user } = useAuth();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [padLeft, setPadLeft] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Global hotkeys: ⌘K / Ctrl-K toggles; "?" opens shortcuts when idle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleOpen();
      } else if (
        e.key === "?" &&
        !open &&
        !/^(input|textarea)$/i.test((e.target as HTMLElement)?.tagName) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggleOpen, setShortcutsOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Center the palette over the content area (right of the sidebar), not the
  // whole viewport — so it tracks the chat view as the sidebar opens/collapses.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const main = document.querySelector(".main");
      setPadLeft(main ? Math.max(0, main.getBoundingClientRect().left) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      close();
      router.push(path);
    };
    return [
      {
        id: "new-chat",
        label: "New chat",
        group: "Navigation",
        hint: `${altLabel()} N`,
        icon: <MessageSquarePlus />,
        run: () => {
          setMode("chat");
          go("/")();
        },
      },
      {
        id: "new-project",
        label: "New project",
        group: "Navigation",
        icon: <FolderPlus />,
        run: () => {
          setMode("code");
          go("/code")();
        },
      },
      {
        id: "switch-chat",
        label: "Switch to Forge Chat",
        group: "Navigation",
        icon: <MessagesSquare />,
        keywords: "mode chat",
        run: () => {
          setMode("chat");
          go("/")();
        },
      },
      {
        id: "switch-code",
        label: "Switch to Forge Code",
        group: "Navigation",
        icon: <Code2 />,
        keywords: "mode code build",
        run: () => {
          setMode("code");
          go("/code")();
        },
      },
      {
        id: "search-chats",
        label: "Search chats",
        group: "Navigation",
        icon: <Search />,
        run: () => {
          close();
          window.dispatchEvent(new CustomEvent("forge:focus-search"));
        },
      },
      {
        id: "skills",
        label: "Manage skills",
        group: "Navigation",
        icon: <Sparkles />,
        keywords: "skills create skill-creator",
        run: go("/skills"),
      },
      {
        id: "agents",
        label: "Manage agents",
        group: "Navigation",
        icon: <Bot />,
        keywords: "agents persona custom",
        run: go("/agents"),
      },
      {
        id: "inspect",
        label: "Inspect active instructions",
        group: "Navigation",
        icon: <ScrollText />,
        keywords: "instruction inspector prompt stack debug context",
        run: () => {
          close();
          setInstructionInspectorOpen(true);
        },
      },
      {
        id: "settings",
        label: "Open settings",
        group: "Navigation",
        icon: <Settings />,
        run: go("/settings"),
      },
      {
        id: "theme-light",
        label: "Light theme",
        group: "Appearance",
        icon: <Sun />,
        keywords: "theme light",
        run: () => {
          setThemePref("light");
          close();
        },
      },
      {
        id: "theme-dark",
        label: "Dark theme",
        group: "Appearance",
        icon: <Moon />,
        keywords: "theme dark",
        run: () => {
          setThemePref("dark");
          close();
        },
      },
      {
        id: "theme-system",
        label: "System theme",
        group: "Appearance",
        icon: <Monitor />,
        keywords: "theme system auto",
        run: () => {
          setThemePref("system");
          close();
        },
      },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        group: "Help",
        hint: "?",
        icon: <Keyboard />,
        run: () => {
          close();
          setShortcutsOpen(true);
        },
      },
      ...(user
        ? [
            {
              id: "sign-out",
              label: "Sign out",
              group: "Account",
              icon: <LogOut />,
              run: () => {
                close();
                void signOutUser();
              },
            },
          ]
        : []),
    ];
  }, [router, close, setMode, setThemePref, setShortcutsOpen, setInstructionInspectorOpen, signOutUser, user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  if (!mounted || !open) return null;

  const groups = filtered.reduce<Record<string, Command[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});

  let flatIndex = -1;

  return createPortal(
    <div
      className="cmdk-overlay"
      style={{ paddingLeft: padLeft }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-input-wrap">
          <Search />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtered[active]?.run();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list">
          {filtered.length === 0 && (
            <div className="cmdk-empty">No matching commands</div>
          )}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="cmdk-group-label">{group}</div>
              {items.map((c) => {
                flatIndex++;
                const idx = flatIndex;
                return (
                  <div
                    key={c.id}
                    className={`cmdk-item ${idx === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      c.run();
                    }}
                  >
                    {c.icon}
                    <span>{c.label}</span>
                    {c.hint && <span className="ci-hint">{c.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
