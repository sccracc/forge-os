// Copies the pdf.js web worker into /public so the browser can load it from a
// stable URL (lib/pdf/parse.ts points GlobalWorkerOptions.workerSrc here).
// Mirrors scripts/copy-monaco.mjs and runs on postinstall / predev / prebuild.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let root;
try {
  root = dirname(require.resolve("pdfjs-dist/package.json"));
} catch {
  console.warn("[copy-pdfjs] pdfjs-dist not installed yet — skipping.");
  process.exit(0);
}

// Prefer the legacy worker (matches the legacy build imported in parse.ts).
const candidates = [
  "legacy/build/pdf.worker.min.mjs",
  "build/pdf.worker.min.mjs",
  "legacy/build/pdf.worker.mjs",
  "build/pdf.worker.mjs",
];

const destDir = join(process.cwd(), "public", "pdfjs");
mkdirSync(destDir, { recursive: true });

for (const rel of candidates) {
  const src = join(root, rel);
  if (existsSync(src)) {
    copyFileSync(src, join(destDir, "pdf.worker.min.mjs"));
    console.log(`[copy-pdfjs] copied ${rel} -> public/pdfjs/pdf.worker.min.mjs`);
    process.exit(0);
  }
}

console.warn("[copy-pdfjs] no worker file found in pdfjs-dist — skipping.");
process.exit(0);
