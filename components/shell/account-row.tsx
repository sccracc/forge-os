"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Settings,
  Keyboard,
  Database,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ChevronsUpDown,
  Sparkles,
  Bot,
  Activity,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useUIStore } from "@/lib/store/ui-store";
import { useUsageStore } from "@/lib/store/usage-store";
import { formatUsagePercent, progressColor, tokenStatus } from "@/lib/usage/compute";
import { resolvePlanId } from "@/lib/plans/limits";
import { PLAN_NAMES } from "@/lib/plans/gates";
import type { ThemePref } from "@/lib/theme";

const THEMES: { id: ThemePref; icon: React.ReactNode; label: string }[] = [
  { id: "light", icon: <Sun />, label: "Light" },
  { id: "dark", icon: <Moon />, label: "Dark" },
  { id: "system", icon: <Monitor />, label: "System" },
];

export function AccountRow() {
  const router = useRouter();
  const { user, profile, signOutUser } = useAuth();
  const themePref = useUIStore((s) => s.themePref);
  const setThemePref = useUIStore((s) => s.setThemePref);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const usage = useUsageStore((s) => s.usage);
  const usagePlan = useUsageStore((s) => s.plan);
  const usageLoaded = useUsageStore((s) => s.loaded);
  const refreshUsage = useUsageStore((s) => s.refresh);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const name =
    profile?.displayName || user?.displayName || user?.email || "Account";
  const email = user?.email || profile?.email || "";
  const initial = (name[0] || "U").toUpperCase();
  const photo = profile?.photoURL || user?.photoURL || undefined;
  const planLabel = `${PLAN_NAMES[resolvePlanId(profile?.plan)]} plan`;
  const usageStatus = usage ? tokenStatus(usagePlan, usage) : null;
  const usageText = usageStatus
    ? `${formatUsagePercent(usageStatus.pct)} used`
    : usageLoaded
      ? "No usage yet"
      : "Loading...";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => firstItemRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (open) void refreshUsage();
  }, [open, refreshUsage]);

  const go = (path: string) => {
    setOpen(false);
    setMobileSidebarOpen(false);
    router.push(path);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>("[data-acct-item]") ?? []
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown"
        ? Math.min(idx + 1, items.length - 1)
        : Math.max(idx - 1, 0);
    items[next]?.focus();
  };

  return (
    <div className="account-anchor" ref={wrapRef}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="acct-menu"
            role="menu"
            onKeyDown={onMenuKeyDown}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            {email && <div className="acct-email">{email}</div>}

            <button
              data-acct-item
              className="acct-usage"
              role="menuitem"
              onClick={() => go("/settings#usage")}
            >
              <div className="acct-usage-row">
                <Activity />
                <span>Usage</span>
                <strong>{usageText}</strong>
              </div>
              {usageStatus && (
                <span className="acct-usage-bar" aria-hidden>
                  <span
                    style={{
                      width: `${usageStatus.pct}%`,
                      background: progressColor(usageStatus.pct),
                    }}
                  />
                </span>
              )}
            </button>

            <button
              ref={firstItemRef}
              data-acct-item
              className="acct-item"
              role="menuitem"
              onClick={() => go("/settings")}
            >
              <Settings />
              <span className="sp">Settings</span>
              <kbd>⌘,</kbd>
            </button>

            <button
              data-acct-item
              className="acct-item"
              role="menuitem"
              onClick={() => go("/skills")}
            >
              <Sparkles />
              <span className="sp">Skills</span>
            </button>

            <button
              data-acct-item
              className="acct-item"
              role="menuitem"
              onClick={() => go("/agents")}
            >
              <Bot />
              <span className="sp">Agents</span>
            </button>

            <div className="acct-theme-row">
              <span>Theme</span>
              <div className="theme-toggle">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={themePref === t.id ? "active" : ""}
                    aria-label={`${t.label} theme`}
                    aria-pressed={themePref === t.id}
                    title={t.label}
                    onClick={() => setThemePref(t.id)}
                  >
                    {t.icon}
                  </button>
                ))}
              </div>
            </div>

            <button
              data-acct-item
              className="acct-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setShortcutsOpen(true);
              }}
            >
              <Keyboard />
              <span className="sp">Keyboard shortcuts</span>
              <kbd>?</kbd>
            </button>

            <button
              data-acct-item
              className="acct-item"
              role="menuitem"
              onClick={() => go("/settings#data")}
            >
              <Database />
              <span className="sp">Data controls</span>
            </button>

            <div className="menu-sep" />

            <button
              data-acct-item
              className="acct-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOutUser();
              }}
            >
              <LogOut />
              <span className="sp">Log out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        className="sidebar-foot"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account"
      >
        <div className="avatar">
          {photo ? (
            <img src={photo} alt="" referrerPolicy="no-referrer" />
          ) : (
            initial
          )}
        </div>
        <div className="foot-info">
          <b>{name}</b>
          <small>{planLabel}</small>
        </div>
        <ChevronsUpDown size={15} className="chev-ud" />
      </button>
    </div>
  );
}
