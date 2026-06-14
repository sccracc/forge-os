"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { InstructionInspector } from "@/components/instruction-inspector";
import { useUIStore } from "@/lib/store/ui-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const setMode = useUIStore((s) => s.setMode);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);

  useEffect(() => {
    setMode(pathname.startsWith("/code") ? "code" : "chat");
  }, [pathname, setMode]);

  // Close the mobile drawer on navigation.
  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (window.innerWidth <= 860) {
          setMobileOpen(!useUIStore.getState().mobileSidebarOpen);
        } else {
          toggleSidebar();
        }
      } else if (
        // New chat. Browsers reserve Ctrl/⌘+N (opens a new window), so the
        // working shortcut is Alt+N (⌥N on Mac); Ctrl/⌘+N kept for PWA/Safari.
        (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyN") ||
        ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "n")
      ) {
        e.preventDefault();
        router.push("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, setMobileOpen, router]);

  return (
    <div className="app">
      <Sidebar />
      {mobileOpen && (
        <div className="scrim mobile-only" onClick={() => setMobileOpen(false)} />
      )}
      <main className="main">{children}</main>
      <InstructionInspector />
    </div>
  );
}
