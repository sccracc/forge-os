"use client";

import type { FileDoc, PreviewKind } from "@/lib/data/types";
import { injectStorageShim } from "./sandbox-shim";

const ESBUILD_VERSION = "0.25.12";

/** Infer how a project should preview from the files it actually contains —
 *  so a "blank" project becomes previewable the moment web files appear. */
export function detectPreviewKind(files: FileDoc[]): PreviewKind {
  const paths = files.filter((f) => f.kind === "file").map((f) => f.path);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  if (has(/\.vue$/i)) return "vue";
  if (has(/\.(jsx|tsx)$/i)) return "react";
  if (has(/\.html?$/i)) return "web";
  return "none";
}

/** The mode actually used to render: a real stored mode wins; otherwise we
 *  detect from the files (covers blank projects the AI later fills with code). */
export function effectivePreviewMode(
  project: { previewMode?: PreviewKind } | null,
  files: FileDoc[]
): PreviewKind {
  const stored = project?.previewMode;
  if (stored && stored !== "none") return stored;
  return detectPreviewKind(files);
}

const REACT_IMPORTMAP = {
  imports: {
    react: "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
  },
};
const VUE_IMPORTMAP = { imports: { vue: "https://esm.sh/vue@3.4.21" } };

const REACT_EXTERNALS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];
const VUE_EXTERNALS = ["vue"];

function filesToMap(files: FileDoc[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) if (f.kind === "file") m.set(f.path, f.content ?? "");
  return m;
}

function findHtml(map: Map<string, string>): { path: string; html: string } | null {
  if (map.has("index.html")) return { path: "index.html", html: map.get("index.html")! };
  for (const [p, c] of map) if (p.endsWith(".html")) return { path: p, html: c };
  return null;
}

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}
function joinPath(base: string, rel: string): string {
  const parts = (base ? base.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Resolve a clicked in-preview link (href on page `fromPath`) to a real file
 *  path in the project, so multi-page sites can navigate inside the preview. */
export function resolveNavTarget(
  files: FileDoc[],
  fromPath: string,
  href: string
): string | null {
  const paths = new Set(files.filter((f) => f.kind === "file").map((f) => f.path));
  const clean = href.split(/[?#]/)[0];
  if (!clean) return null;
  const baseDir = dirOf(fromPath);
  const target = joinPath(baseDir, clean);
  const candidates = clean.endsWith("/")
    ? [`${target}/index.html`, `${target}index.html`]
    : [target, `${target}.html`, `${target}/index.html`];
  for (const c of candidates) if (paths.has(c)) return c;
  return null;
}

const NAV_SHIM = (entryPath: string) =>
  `\n<script>(function(){function go(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var h=a.getAttribute('href');if(!h||/^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(h))return;e.preventDefault();try{parent.postMessage({__forgeNav:h,__forgeFrom:${JSON.stringify(
    entryPath
  )}},'*');}catch(_){}}document.addEventListener('click',go,true);})();</script>`;

/** Assemble an HTML/CSS/JS project into a single self-contained srcdoc string.
 *  `entryPath` selects which page to render (defaults to index.html / first
 *  HTML), enabling in-preview navigation between multiple HTML files. */
export function assembleWeb(files: FileDoc[], entryPath?: string, withNav = true): string {
  const map = filesToMap(files);
  const entry =
    entryPath && map.has(entryPath)
      ? { path: entryPath, html: map.get(entryPath)! }
      : findHtml(map);
  if (!entry)
    return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem;color:#6e6353">No <code>index.html</code> in this project yet.</body>`;
  const baseDir = dirOf(entry.path);
  let html = entry.html;

  // Inline local stylesheets (resolved relative to the current page).
  html = html.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (m, href) => {
      if (/^https?:\/\//.test(href)) return m;
      const css = map.get(joinPath(baseDir, href));
      return css != null ? `<style>\n${css}\n</style>` : m;
    }
  );
  // Inline local scripts.
  html = html.replace(
    /<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (m, src) => {
      if (/^https?:\/\//.test(src)) return m;
      const isModule = /type=["']module["']/i.test(m);
      const js = map.get(joinPath(baseDir, src));
      return js != null
        ? `<script${isModule ? ' type="module"' : ""}>\n${js}\n</script>`
        : m;
    }
  );

  // Multi-page navigation shim (intercepts clicks to local .html pages).
  // Disabled for published output, which is a single self-contained page.
  if (withNav) {
    const shim = NAV_SHIM(entry.path);
    html = html.includes("</body>")
      ? html.replace("</body>", `${shim}\n</body>`)
      : html + shim;
  }
  // Storage shim runs before any user script so localStorage/sessionStorage
  // never throw in the opaque-origin sandbox (would otherwise kill the page).
  return injectStorageShim(html);
}

let esbuildReady: Promise<void> | null = null;
export async function ensureEsbuild() {
  const esbuild = await import("esbuild-wasm");
  if (!esbuildReady) {
    esbuildReady = esbuild.initialize({
      wasmURL: `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`,
      worker: true,
    });
  }
  await esbuildReady;
  return esbuild;
}

function resolveInMap(map: Map<string, string>, candidate: string): string | null {
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", ".vue", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
  for (const e of exts) if (map.has(candidate + e)) return candidate + e;
  return null;
}

function shellFor(files: FileDoc[], kind: "react" | "vue", bundle: string): string {
  const map = filesToMap(files);
  const entry = findHtml(map);
  const importmap = JSON.stringify(kind === "react" ? REACT_IMPORTMAP : VUE_IMPORTMAP);
  const headInject = `<script type="importmap">${importmap}</script>`;
  const bodyInject = `<script type="module">\n${bundle}\n</script>`;
  if (entry) {
    let html = entry.html;
    html = html.includes("</head>")
      ? html.replace("</head>", `${headInject}\n</head>`)
      : `${headInject}\n${html}`;
    html = html.includes("</body>")
      ? html.replace("</body>", `${bodyInject}\n</body>`)
      : `${html}\n${bodyInject}`;
    return injectStorageShim(html);
  }
  const rootId = kind === "react" ? "root" : "app";
  return injectStorageShim(
    `<!doctype html><html><head><meta charset="utf-8">${headInject}</head><body><div id="${rootId}"></div>${bodyInject}</body></html>`
  );
}

function errorDoc(message: string): string {
  const safe = message.replace(/</g, "&lt;");
  return `<!doctype html><meta charset="utf-8"><body style="font-family:ui-monospace,monospace;padding:1.5rem;color:#e5484d;background:#1a1611;white-space:pre-wrap;line-height:1.6">Build error:\n\n${safe}</body>`;
}

/** Run the in-browser esbuild bundle, returning either the JS or an error
 *  string — shared by the live preview AND the verification harness. */
export async function buildBundle(
  files: FileDoc[],
  kind: "react" | "vue"
): Promise<{ text?: string; error?: string }> {
  try {
    const esbuild = await ensureEsbuild();
    const map = filesToMap(files);
    const entryCandidates =
      kind === "react"
        ? ["src/main.jsx", "src/main.tsx", "src/index.jsx", "src/index.tsx", "main.jsx", "index.jsx", "src/App.jsx"]
        : ["src/main.js", "src/main.ts", "main.js", "src/index.js", "index.js"];
    const entry = entryCandidates.find((c) => map.has(c)) ?? [...map.keys()].find((p) => /\.(jsx?|tsx?)$/.test(p));
    if (!entry) return { error: `No entry file found (e.g. ${entryCandidates[0]}).` };

    const externals = kind === "react" ? REACT_EXTERNALS : VUE_EXTERNALS;
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      write: false,
      jsx: kind === "react" ? "automatic" : "transform",
      logLevel: "silent",
      plugins: [
        {
          name: "forge-vfs",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (externals.includes(args.path) || /^https?:\/\//.test(args.path))
                return { path: args.path, external: true };
              if (args.path.startsWith(".") || args.kind === "entry-point") {
                const base = args.kind === "entry-point" ? "" : dirOf(args.importer);
                const resolved = resolveInMap(map, joinPath(base, args.path));
                if (resolved) return { path: resolved, namespace: "vfs" };
              }
              // Bare imports (e.g. a library) → let esm.sh serve them.
              return { path: `https://esm.sh/${args.path}`, external: true };
            });
            build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
              const contents = map.get(args.path) ?? "";
              const loader = args.path.endsWith(".ts")
                ? "ts"
                : args.path.endsWith(".tsx")
                  ? "tsx"
                  : args.path.endsWith(".css")
                    ? "css"
                    : "jsx";
              return { contents, loader };
            });
          },
        },
      ],
    });
    return { text: result.outputFiles[0].text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bundle a React/Vue single-page project in-browser via esbuild-wasm. */
export async function bundleApp(files: FileDoc[], kind: "react" | "vue"): Promise<string> {
  const { text, error } = await buildBundle(files, kind);
  if (error || text === undefined) return errorDoc(error ?? "Bundle failed");
  return shellFor(files, kind, text);
}
