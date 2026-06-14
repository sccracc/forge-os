"use client";

import { useRef } from "react";
import Editor, { loader, type OnMount, type BeforeMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useUIStore } from "@/lib/store/ui-store";
import { resolveTheme } from "@/lib/theme";

// Load Monaco from our own origin (public/monaco/vs, copied by scripts/copy-monaco.mjs)
// instead of the default jsDelivr CDN — avoids cross-origin "Tracking Prevention"
// storage warnings and keeps language workers same-origin.
if (typeof window !== "undefined") {
  loader.config({ paths: { vs: "/monaco/vs" } });
}

const defineThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("molten-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b6253", fontStyle: "italic" },
      { token: "keyword", foreground: "ff7a1a" },
      { token: "keyword.control", foreground: "ff7a1a" },
      { token: "string", foreground: "a3d977" },
      { token: "number", foreground: "ff9d4d" },
      { token: "type", foreground: "ffb347" },
      { token: "function", foreground: "ffc266" },
      { token: "tag", foreground: "ff9d8a" },
      { token: "attribute.name", foreground: "ffb347" },
      { token: "delimiter", foreground: "9a8f7d" },
      { token: "variable", foreground: "f5ede0" },
    ],
    colors: {
      "editor.background": "#0a0807",
      "editor.foreground": "#f0e8da",
      "editorLineNumber.foreground": "#5a5040",
      "editorLineNumber.activeForeground": "#ff7a1a",
      "editor.selectionBackground": "#ff7a1a33",
      "editor.lineHighlightBackground": "#16130f",
      "editorCursor.foreground": "#ff7a1a",
      "editorGutter.background": "#0a0807",
      "editorWidget.background": "#16130f",
      "editorWidget.border": "#2a231b",
      "input.background": "#1f1a14",
      "focusBorder": "#ff7a1a",
    },
  });
  monaco.editor.defineTheme("molten-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "9a8e7b", fontStyle: "italic" },
      { token: "keyword", foreground: "c2470a" },
      { token: "string", foreground: "5a7d2a" },
      { token: "number", foreground: "c2470a" },
      { token: "type", foreground: "b8460d" },
      { token: "function", foreground: "b8460d" },
      { token: "tag", foreground: "c2470a" },
      { token: "attribute.name", foreground: "b8460d" },
    ],
    colors: {
      "editor.background": "#fffdf9",
      "editor.foreground": "#2a2118",
      "editorLineNumber.foreground": "#c8bba6",
      "editorLineNumber.activeForeground": "#e8590c",
      "editor.selectionBackground": "#e8590c22",
      "editor.lineHighlightBackground": "#faf6f0",
      "editorCursor.foreground": "#e8590c",
      "editorWidget.background": "#fffdf9",
      "editorWidget.border": "#e6dccd",
      "focusBorder": "#e8590c",
    },
  });
};

export function MonacoEditor({
  value,
  language,
  onChange,
  onSave,
  onCursor,
  readOnly,
}: {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onCursor?: (pos: { line: number; col: number }) => void;
  readOnly?: boolean;
}) {
  const themePref = useUIStore((s) => s.themePref);
  const theme = resolveTheme(themePref) === "dark" ? "molten-dark" : "molten-light";
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const handleMount: OnMount = (ed, monaco) => {
    const mono =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-jetbrains-mono")
        .trim() || "monospace";
    ed.updateOptions({ fontFamily: `${mono}, monospace` });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.());
    ed.onDidChangeCursorPosition((e) =>
      onCursor?.({ line: e.position.lineNumber, col: e.position.column })
    );
  };

  const options: editor.IStandaloneEditorConstructionOptions = {
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    automaticLayout: true,
    padding: { top: 14, bottom: 14 },
    smoothScrolling: true,
    cursorBlinking: "smooth",
    renderLineHighlight: "line",
    scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
    readOnly,
    wordWrap: "off",
    fixedOverflowWidgets: true,
  };

  return (
    <Editor
      value={value}
      language={language || "plaintext"}
      theme={theme}
      beforeMount={defineThemes}
      onMount={handleMount}
      onChange={(v) => onChange?.(v ?? "")}
      options={options}
      loading={<div style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>Loading editor…</div>}
    />
  );
}
