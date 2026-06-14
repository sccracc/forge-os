// Copies the Monaco editor assets into public/ so the editor loads from our own
// origin instead of a third-party CDN. This eliminates browser "Tracking
// Prevention blocked access to storage" warnings and restores full IntelliSense
// (language workers load same-origin). Runs on install/dev/build.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = join(root, "public", "monaco", "vs");

if (!existsSync(src)) {
  console.warn(`[copy-monaco] ${src} not found — skipping (monaco-editor not installed yet).`);
  process.exit(0);
}

try {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log("[copy-monaco] Monaco assets copied to public/monaco/vs");
} catch (err) {
  console.warn("[copy-monaco] copy failed:", err?.message ?? err);
  // Non-fatal: the editor falls back to the CDN if assets are missing.
  process.exit(0);
}
