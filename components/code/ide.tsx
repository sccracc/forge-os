"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Code2, Columns2, Eye, FileCode2, Play } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useProject, useProjectFiles } from "@/hooks/use-projects";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { updateContent } from "@/lib/data/files";
import { touchProject } from "@/lib/data/projects";
import { detectLang, isTextCategory } from "@/lib/code/languages";
import { effectivePreviewMode } from "@/lib/code/preview";
import { runnableCodeLanguage, scriptNeedsInput } from "@/lib/code/run-utils";
import { MonacoEditor } from "./monaco-editor";
import { PreviewPane } from "./preview-pane";
import { ScriptRunnerPane, type ScriptRunResult } from "./script-runner-pane";
import { FileTree } from "./file-tree";
import { BuildDock } from "./build-dock";
import { BinaryViewer } from "./binary-viewer";
import type { FileDoc } from "@/lib/data/types";

type ViewMode = "code" | "split" | "preview" | "run";

export function IDE({ projectId }: { projectId: string }) {
  const { user, getIdToken } = useAuth();
  const project = useProject(projectId);
  const { files, loading } = useProjectFiles(projectId);
  const isMobile = useIsMobile();

  const [tabs, setTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("code");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [split, setSplit] = useState(0.5);
  const [runnerResult, setRunnerResult] = useState<ScriptRunResult | null>(null);
  const [runnerRunning, setRunnerRunning] = useState(false);
  const [runnerStdin, setRunnerStdin] = useState("");
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  // Preview mode is effective (stored, else detected from files) so a blank
  // project becomes previewable the moment the AI writes HTML/JSX/etc.
  const previewMode = effectivePreviewMode(project, files);
  const showPreview = previewMode !== "none";

  // Open a sensible default file on first load.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || loading || files.length === 0) return;
    didInit.current = true;
    const entry =
      files.find((f) => f.path === "index.html") ||
      files.find((f) => f.kind === "file" && isTextCategory(f.category)) ||
      files.find((f) => f.kind === "file");
    if (entry) {
      setTabs([entry.id]);
      setActiveId(entry.id);
    }
  }, [loading, files]);

  // Auto-open the split view once, when preview first becomes available.
  const didAutoSplit = useRef(false);
  useEffect(() => {
    if (didAutoSplit.current || !showPreview) return;
    didAutoSplit.current = true;
    setView("split");
  }, [showPreview]);

  const activeFile = activeId ? fileById.get(activeId) ?? null : null;

  // Keep the editor in sync when the build dock rewrites the open file.
  useEffect(() => {
    if (!activeFile || activeFile.kind !== "file") return;
    if (!dirty[activeFile.id] && drafts[activeFile.id] !== activeFile.content) {
      setDrafts((d) => ({ ...d, [activeFile.id]: activeFile.content ?? "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.content, activeFile?.id]);

  const open = useCallback((file: FileDoc) => {
    if (file.kind !== "file") return;
    setTabs((t) => (t.includes(file.id) ? t : [...t, file.id]));
    setActiveId(file.id);
    setDrafts((d) => (file.id in d ? d : { ...d, [file.id]: file.content ?? "" }));
  }, []);

  const closeTab = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTabs((t) => {
      const next = t.filter((x) => x !== id);
      if (activeId === id) setActiveId(next[next.length - 1] ?? null);
      return next;
    });
  };

  const save = useCallback(
    async (id: string, content: string) => {
      if (!user) return;
      await updateContent(user.uid, id, content);
      setDirty((d) => ({ ...d, [id]: false }));
      touchProject(user.uid, projectId).catch(() => {});
    },
    [user, projectId]
  );

  const onChange = (value: string) => {
    if (!activeFile) return;
    const id = activeFile.id;
    setDrafts((d) => ({ ...d, [id]: value }));
    setDirty((dd) => ({ ...dd, [id]: true }));
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => save(id, value), 800);
  };

  const onSaveNow = () => {
    if (!activeFile) return;
    const id = activeFile.id;
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    save(id, drafts[id] ?? activeFile.content ?? "");
  };

  // Split divider drag.
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const host = document.getElementById("ide-center");
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const r = (e.clientX - rect.left) / rect.width;
      setSplit(Math.min(0.75, Math.max(0.25, r)));
    };
    const up = () => (dragging.current = false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const lang = activeFile ? detectLang(activeFile.name) : null;
  const value = activeFile ? drafts[activeFile.id] ?? activeFile.content ?? "" : "";
  const runLanguage = activeFile?.kind === "file" ? runnableCodeLanguage(activeFile.name) : null;
  const runnerNeedsInput = Boolean(runLanguage && scriptNeedsInput(value, runLanguage));
  const canRunScript = Boolean(activeFile && runLanguage && isTextCategory(activeFile.category));
  const activeView = view === "run" && !canRunScript ? (showPreview ? "split" : "code") : view;

  const runActiveScript = useCallback(async () => {
    if (!activeFile || !runLanguage || !user) return;
    const id = activeFile.id;
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    await save(id, value);

    setView("run");
    setRunnerRunning(true);
    const fileName = activeFile.name;
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const res = await fetch("/api/code/run", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: value,
          language: runLanguage,
          stdin: runnerStdin.length ? runnerStdin : undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            stdout?: string;
            stderr?: string;
            error?: string | null;
            available?: boolean;
            inputRequired?: boolean;
          }
        | null;
      if (!res.ok) throw new Error(json?.error || "Script execution failed.");
      setRunnerResult({
        fileName,
        language: runLanguage,
        stdout: json?.stdout ?? "",
        stderr: json?.stderr ?? "",
        error: json?.error ?? null,
        available: json?.available ?? true,
        inputRequired: json?.inputRequired,
        ranAt: Date.now(),
      });
    } catch (err) {
      setRunnerResult({
        fileName,
        language: runLanguage,
        stdout: "",
        stderr: "",
        error: err instanceof Error ? err.message : "Script execution failed. Please try again.",
        available: true,
        ranAt: Date.now(),
      });
    } finally {
      setRunnerRunning(false);
    }
  }, [activeFile, getIdToken, runLanguage, runnerStdin, save, user, value]);

  // MOBILE: the full IDE (tree + editor + dock) can't fit a phone and renders
  // squished — show a clean, full-bleed live preview of the project instead.
  // `null` = viewport not measured yet; render a bare frame for that one tick
  // rather than mounting Monaco on a phone.
  if (isMobile === null) {
    return <div className="ide" aria-hidden />;
  }
  if (isMobile) {
    return (
      <div className="ide-mobile">
        <div className="ide-mobile-preview">
          <PreviewPane files={files} project={project} />
        </div>
        <div className="ide-mobile-note">
          Live preview — open on a larger screen to edit this project.
        </div>
      </div>
    );
  }

  return (
    <div className="ide">
      <div className="ide-tree">
        <FileTree files={files} projectId={projectId} activeFileId={activeId} onOpen={open} />
      </div>

      <div className="ide-center" id="ide-center">
        <div className="ide-tabbar">
          <div className="ide-tabs">
            {tabs.map((id) => {
              const f = fileById.get(id);
              if (!f) return null;
              const l = detectLang(f.name);
              return (
                <div
                  key={id}
                  className={`ide-tab ${activeId === id ? "active" : ""}`}
                  onClick={() => setActiveId(id)}
                >
                  <FileCode2 size={13} style={{ color: l.color }} />
                  <span>{f.name}</span>
                  {dirty[id] && <span className="ide-dirty" />}
                  <button className="ide-tab-close" onClick={(e) => closeTab(id, e)} aria-label="Close">
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          {showPreview && (
            <div className="segmented ide-view">
              <button className={activeView === "code" ? "active" : ""} onClick={() => setView("code")} title="Code">
                <Code2 />
              </button>
              <button className={activeView === "split" ? "active" : ""} onClick={() => setView("split")} title="Split">
                <Columns2 />
              </button>
              <button className={activeView === "preview" ? "active" : ""} onClick={() => setView("preview")} title="Preview">
                <Eye />
              </button>
            </div>
          )}
          {canRunScript && (
            <button
              className={`script-run-trigger ${activeView === "run" ? "active" : ""}`}
              onClick={runActiveScript}
              disabled={runnerRunning}
              title={`Run ${activeFile?.name ?? "script"}`}
            >
              {runnerRunning ? <span className="ring-spin" /> : <Play />}
              <span>{runnerRunning ? "Running" : "Run"}</span>
            </button>
          )}
        </div>

        <div className="ide-body">
          {(activeView === "code" || activeView === "split" || activeView === "run" || !showPreview) && (
            <div
              className="ide-editor"
              style={{ flex: (activeView === "split" && showPreview) || activeView === "run" ? split : 1 }}
            >
              {activeFile ? (
                isTextCategory(activeFile.category) ? (
                  <MonacoEditor
                    value={value}
                    language={lang?.language ?? "plaintext"}
                    onChange={onChange}
                    onSave={onSaveNow}
                    onCursor={setCursor}
                  />
                ) : (
                  <BinaryViewer file={activeFile} />
                )
              ) : (
                <div className="ide-no-file">
                  {loading ? "Loading…" : "Select a file to edit, or ask the build dock to create one."}
                </div>
              )}
            </div>
          )}

          {((activeView === "split" && showPreview) || (activeView === "run" && canRunScript)) && (
            <div className="ide-divider" onMouseDown={() => (dragging.current = true)} />
          )}

          {(activeView === "preview" || activeView === "split") && showPreview && (
            <div className="ide-preview" style={{ flex: activeView === "split" ? 1 - split : 1 }}>
              <PreviewPane files={files} project={project} />
            </div>
          )}

          {activeView === "run" && canRunScript && (
            <div className="ide-preview" style={{ flex: 1 - split }}>
              <ScriptRunnerPane
                result={runnerResult}
                running={runnerRunning}
                onRun={runActiveScript}
                needsInput={runnerNeedsInput || Boolean(runnerResult?.inputRequired)}
                stdin={runnerStdin}
                onStdinChange={setRunnerStdin}
              />
            </div>
          )}
        </div>

        <div className="ide-statusbar">
          <span className="sb-item">
            <span className="sb-dot" style={{ background: activeFile && dirty[activeFile.id] ? "#e5a23f" : "#3fb950" }} />
            {activeFile ? (dirty[activeFile.id] ? "Saving…" : "Saved") : "Ready"}
          </span>
          {activeFile && <span className="sb-item">{lang?.label}</span>}
          <span className="sb-item">UTF-8</span>
          {activeFile && isTextCategory(activeFile.category) && (
            <span className="sb-item" style={{ marginLeft: "auto" }}>
              Ln {cursor.line}, Col {cursor.col}
            </span>
          )}
        </div>
      </div>

      <div className="ide-dock">
        <BuildDock project={project} files={files} />
      </div>
    </div>
  );
}
