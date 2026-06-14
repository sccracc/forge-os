export const THEME_COOKIE = "forge-theme";

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: ThemePref = "light";

export function resolvePref(value: string | undefined | null): ThemePref {
  return value === "dark" || value === "system" || value === "light"
    ? value
    : DEFAULT_THEME;
}

/** Resolve a preference to a concrete theme using the system query (client-side). */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  }
  return pref;
}

/**
 * Inline script injected into <head>. Runs before first paint to set
 * data-theme from the cookie (resolving "system" via matchMedia) — no flash.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);
var p=m?decodeURIComponent(m[1]):'${DEFAULT_THEME}';
var t=p==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):(p==='dark'?'dark':'light');
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
