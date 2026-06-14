"use client";

import { useContext, useEffect, useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import { highlightCode } from "@/lib/shiki";
import { useArtifactStore } from "@/lib/store/artifact-store";
import { ArtifactStreaming, ArtifactSurfaceCtx } from "./markdown-context";
import { ArtifactModal } from "./artifact-modal";
import { defaultFilename, isPreviewable } from "@/lib/code/snippet";
import { CodeRunInput, CodeRunOutput, RunCodeButton, useCodeRunner } from "./code-runner";

function artifactMeta(lang: string, code: string): { title: string; sub: string } {
  const l = (lang || "code").toLowerCase();
  if (isPreviewable(l, code)) {
    const t =
      /<title>([^<]+)<\/title>/i.exec(code)?.[1] ||
      /<h1[^>]*>([^<]+)<\/h1>/i.exec(code)?.[1];
    return { title: (t?.trim() || "HTML document").slice(0, 80), sub: `Code · ${l === "svg" ? "SVG" : "HTML"}` };
  }
  return { title: defaultFilename(l), sub: `Code · ${l.toUpperCase()}` };
}

export function ArtifactCard({ code, lang }: { code: string; lang: string }) {
  const streaming = useContext(ArtifactStreaming);
  const surface = useContext(ArtifactSurfaceCtx);
  const openArtifact = useArtifactStore((s) => s.open);
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const runner = useCodeRunner(code, lang);

  const { title, sub } = artifactMeta(lang, code);
  const previewable = isPreviewable(lang, code);
  const filename = previewable ? "index.html" : defaultFilename(lang);

  useEffect(() => {
    if (!expanded) return;
    let live = true;
    highlightCode(code, lang).then((h) => live && setHtml(h));
    return () => {
      live = false;
    };
  }, [expanded, code, lang]);

  const openView = () => {
    if (streaming) {
      setExpanded((e) => !e);
      return;
    }
    if (surface === "dock") setModalOpen(true);
    else openArtifact({ code, lang, title });
  };

  const download = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={`artifact ${streaming ? "generating" : ""}`}>
      <div
        className="artifact-main"
        onClick={openView}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openView()}
      >
        <div className="artifact-thumb" aria-hidden>
          <span className="art-glyph">&lt;/&gt;</span>
        </div>
        <div className="artifact-meta">
          <div className="artifact-title">{title}</div>
          <div className="artifact-sub">{streaming ? "Writing…" : sub}</div>
        </div>
        <button
          className="artifact-icon"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          title={expanded ? "Hide code" : "Show code"}
          aria-label="Toggle code"
        >
          <ChevronDown size={16} className={expanded ? "open" : ""} />
        </button>
        <button className="artifact-dl" onClick={download} title="Download">
          <Download size={14} /> Download
        </button>
        {runner.language && !streaming && (
          <RunCodeButton
            running={runner.running}
            onRun={(e) => {
              e.stopPropagation();
              runner.run();
            }}
          />
        )}
      </div>
      {streaming && <span className="artifact-bar" aria-hidden />}
      {expanded && (
        <div className="artifact-code">
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre>
              <code>{code}</code>
            </pre>
          )}
        </div>
      )}
      <CodeRunInput show={runner.needsInput} stdin={runner.stdin} onChange={runner.setStdin} />
      <CodeRunOutput result={runner.result} running={runner.running} />
      {modalOpen && (
        <ArtifactModal
          code={code}
          lang={lang}
          filename={filename}
          previewable={previewable}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
