"use client";

import { useEffect, useState } from "react";
import { X, Copy, Check, Download, ExternalLink, Eye, Code2 } from "lucide-react";
import { highlightCode } from "@/lib/shiki";
import { useArtifactStore } from "@/lib/store/artifact-store";
import { wrapPreviewDoc, isPreviewable, defaultFilename } from "@/lib/code/snippet";
import { openSandboxedTab } from "@/lib/code/open-sandboxed";

export function ArtifactPanel() {
  const artifact = useArtifactStore((s) => s.artifact);
  const close = useArtifactStore((s) => s.close);
  const previewable = artifact ? isPreviewable(artifact.lang, artifact.code) : false;
  const [tab, setTab] = useState<"preview" | "code">(previewable ? "preview" : "code");
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTab(previewable ? "preview" : "code");
  }, [artifact, previewable]);

  useEffect(() => {
    if (!artifact) return;
    let live = true;
    setHtml(null);
    highlightCode(artifact.code, artifact.lang).then((h) => live && setHtml(h));
    return () => {
      live = false;
    };
  }, [artifact]);

  if (!artifact) return null;
  const filename = previewable ? "index.html" : defaultFilename(artifact.lang);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };
  const download = () => {
    const blob = new Blob([artifact.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openTab = () => openSandboxedTab(wrapPreviewDoc(artifact.code), artifact.title);

  return (
    <>
      <div className="panel-head">
        <div className="art-panel-title">
          <span className="art-glyph">&lt;/&gt;</span>
          <span>{artifact.title}</span>
        </div>
        {previewable && (
          <div className="segmented am-seg">
            <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
              <Eye size={13} /> Preview
            </button>
            <button className={tab === "code" ? "active" : ""} onClick={() => setTab("code")}>
              <Code2 size={13} /> Code
            </button>
          </div>
        )}
        <div className="am-actions">
          <button className="icon-btn" onClick={copy} title="Copy" aria-label="Copy">
            {copied ? <span className="copy-pop"><Check size={15} /></span> : <Copy size={15} />}
          </button>
          <button className="icon-btn" onClick={download} title="Download" aria-label="Download">
            <Download size={15} />
          </button>
          {previewable && (
            <button className="icon-btn" onClick={openTab} title="Open in new tab" aria-label="Open in new tab">
              <ExternalLink size={15} />
            </button>
          )}
          <button className="panel-close" onClick={close} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {tab === "preview" && previewable ? (
          <iframe
            className="am-frame"
            title={artifact.title}
            sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
            srcDoc={wrapPreviewDoc(artifact.code)}
          />
        ) : (
          <div className="am-code">
            {html ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <pre>
                <code>{artifact.code}</code>
              </pre>
            )}
          </div>
        )}
      </div>
    </>
  );
}
