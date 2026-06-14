"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, Download, ExternalLink, Eye, Code2, FileCode2 } from "lucide-react";
import { highlightCode } from "@/lib/shiki";
import { wrapPreviewDoc } from "@/lib/code/snippet";

export function ArtifactModal({
  code,
  lang,
  filename,
  previewable,
  onClose,
}: {
  code: string;
  lang: string;
  filename: string;
  previewable: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<"preview" | "code">(previewable ? "preview" : "code");
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    highlightCode(code, lang).then((h) => {
      if (live) setHtml(h);
    });
    return () => {
      live = false;
    };
  }, [code, lang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be blocked */
    }
  };
  const download = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openTab = () => {
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(wrapPreviewDoc(code));
      w.document.close();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="artifact-modal" role="dialog" aria-modal="true" aria-label={filename}>
        <div className="artifact-modal-head">
          <div className="am-title">
            <FileCode2 size={15} />
            <span>{filename}</span>
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
            <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="artifact-modal-body">
          {tab === "preview" && previewable ? (
            <iframe
              className="am-frame"
              title={filename}
              sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
              srcDoc={wrapPreviewDoc(code)}
            />
          ) : (
            <div className="am-code">
              {html ? (
                <div dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <pre>
                  <code>{code}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
