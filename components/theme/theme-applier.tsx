"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/lib/store/ui-store";
import { THEME_COOKIE, resolveTheme } from "@/lib/theme";

/** #27 · brief radial sweep when the theme actually changes (not first paint). */
function themeSweep() {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const el = document.createElement("div");
  el.className = "theme-sweep";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 650);
}

/**
 * Applies the active theme preference to <html data-theme> and mirrors it into
 * the cookie (the SSR + pre-paint script's source of truth). Honors "system".
 */
export function ThemeApplier() {
  const themePref = useUIStore((s) => s.themePref);
  const firstApply = useRef(true);

  useEffect(() => {
    const apply = () =>
      document.documentElement.setAttribute("data-theme", resolveTheme(themePref));

    if (firstApply.current) {
      firstApply.current = false;
    } else {
      themeSweep();
    }
    apply();
    document.cookie = `${THEME_COOKIE}=${themePref}; path=/; max-age=31536000; samesite=lax`;

    if (themePref === "system" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [themePref]);

  return null;
}
