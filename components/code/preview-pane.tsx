"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ExternalLink, Download, Home } from "lucide-react";
import { assembleWeb, bundleApp, effectivePreviewMode, resolveNavTarget } from "@/lib/code/preview";
import type { FileDoc, ProjectDoc } from "@/lib/data/types";

export function PreviewPane({
  files,
  project,
  onDownload,
}: {
  files: FileDoc[];
  project: ProjectDoc | null;
  onDownload?: () => void;
}) {
  const mode = effectivePreviewMode(project, files);
  const [srcDoc, setSrcDoc] = useState("");
  const [building, setBuilding] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [currentPage, setCurrentPage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filePaths = useMemo(
    () => new Set(files.filter((f) => f.kind === "file").map((f) => f.path)),
    [files]
  );

  // The HTML page actually rendered (chosen page, else index.html / first .html).
  const entryPath = useMemo(() => {
    if (currentPage && filePaths.has(currentPage)) return currentPage;
    if (filePaths.has("index.html")) return "index.html";
    return [...filePaths].find((p) => /\.html?$/i.test(p)) ?? null;
  }, [currentPage, filePaths]);

  const sig = useMemo(
    () =>
      files
        .filter((f) => f.kind === "file")
        .map((f) => `${f.path}:${(f.content ?? "").length}`)
        .join("|"),
    [files]
  );

  // Reset navigation when switching projects.
  useEffect(() => {
    setCurrentPage(null);
  }, [project?.id]);

  // In-preview navigation: the injected shim posts the clicked link here.
  useEffect(() => {
    if (mode !== "web") return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __forgeNav?: string; __forgeFrom?: string } | null;
      if (!d || typeof d !== "object" || !d.__forgeNav) return;
      const target = resolveNavTarget(files, d.__forgeFrom ?? entryPath ?? "", d.__forgeNav);
      if (target) setCurrentPage(target);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode, files, entryPath]);

  useEffect(() => {
    if (mode === "none") return;
    if (timer.current) clearTimeout(timer.current);
    let live = true;
    timer.current = setTimeout(async () => {
      if (mode === "web") {
        setSrcDoc(assembleWeb(files, entryPath ?? undefined));
      } else {
        setBuilding(true);
        const html = await bundleApp(files, mode);
        if (live) {
          setSrcDoc(html);
          setBuilding(false);
        }
      }
    }, 350);
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mode, nonce, entryPath]);

  if (mode === "none") {
    return (
      <div className="preview-empty">
        <p>Preview isn&apos;t available for this project type yet.</p>
        {onDownload && (
          <button className="btn-ghost" onClick={onDownload}>
            <Download size={14} /> Download to run
          </button>
        )}
      </div>
    );
  }

  const urlLabel =
    mode === "web" && entryPath ? `localhost:5173/${entryPath} · live` : "localhost:5173 · live";

  return (
    <div className="preview-wrap">
      <div className="preview-bar">
        <span className="tl" />
        <span className="tl" />
        <span className="tl" />
        <div className="preview-url" title={entryPath ?? undefined}>
          {urlLabel}
        </div>
        {mode === "web" && currentPage && currentPage !== "index.html" && (
          <button className="icon-btn" onClick={() => setCurrentPage(null)} title="Back to index.html" aria-label="Home">
            <Home size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={() => setNonce((n) => n + 1)} title="Refresh" aria-label="Refresh">
          <RefreshCw size={15} />
        </button>
        <button
          className="icon-btn"
          title="Open in new tab"
          aria-label="Open in new tab"
          onClick={() => {
            const w = window.open("", "_blank");
            if (w) {
              w.document.open();
              w.document.write(srcDoc);
              w.document.close();
            }
          }}
        >
          <ExternalLink size={15} />
        </button>
      </div>
      <div className="preview-frame-wrap">
        {building && (
          <div className="preview-building">
            <span className="ring-spin" /> Bundling…
          </div>
        )}
        <iframe
          key={nonce}
          title="preview"
          className="preview-frame"
          sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}
