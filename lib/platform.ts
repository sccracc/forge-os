// Tiny platform helper so keyboard hints read correctly on every OS.
// (Handlers themselves accept BOTH ⌘ and Ctrl via metaKey || ctrlKey.)

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** "⌘" on macOS, "Ctrl" elsewhere. */
export function modLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

/** "⌥" on macOS, "Alt" elsewhere. */
export function altLabel(): string {
  return isMacPlatform() ? "⌥" : "Alt";
}
