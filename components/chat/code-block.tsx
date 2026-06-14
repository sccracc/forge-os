"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import { highlightCode } from "@/lib/shiki";
import { ArtifactCard } from "./artifact-card";
import { defaultFilename, isArtifactCode } from "@/lib/code/snippet";
import { CodeRunInput, CodeRunOutput, RunCodeButton, useCodeRunner } from "./code-runner";

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runner = useCodeRunner(code, lang);

  // Substantial / previewable code renders as a Claude-style artifact card.
  const artifact = isArtifactCode(lang, code);

  // Debounced highlight for inline snippets (smooth while streaming).
  useEffect(() => {
    if (artifact) return;
    let live = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      highlightCode(code, lang).then((h) => {
        if (live) setHtml(h);
      });
    }, 150);
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [code, lang, artifact]);

  if (artifact) return <ArtifactCard code={code} lang={lang} />;

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
    a.download = defaultFilename(lang);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="lang">{lang || "text"}</span>
        <div className="code-actions">
          <button className="copy" onClick={download} aria-label="Download code">
            <Download size={13} /> Download
          </button>
          {runner.language && (
            <RunCodeButton
              running={runner.running}
              onRun={(e) => {
                e.stopPropagation();
                runner.run();
              }}
            />
          )}
          <button className="copy" onClick={copy} aria-label="Copy code">
            {copied ? (
              <span className="copy-pop">
                <Check size={13} />
              </span>
            ) : (
              <Copy size={13} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
      <CodeRunInput show={runner.needsInput} stdin={runner.stdin} onChange={runner.setStdin} />
      <CodeRunOutput result={runner.result} running={runner.running} />
    </div>
  );
}
