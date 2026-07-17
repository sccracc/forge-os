// Open AI-generated HTML in a NEW TAB without ever giving it a same-origin
// document. Writing the HTML straight into a popup (window.open + document.write)
// hands the generated scripts a document on the app's own origin — they could
// read localStorage/cookies and reach back through window.opener. Instead we
// open a tiny same-origin SHELL page (our own static markup only) whose sole
// content is a sandboxed iframe hosting the generated document, mirroring the
// exact sandbox used by the inline preview (`allow-same-origin` omitted →
// opaque origin).

const SANDBOX = "allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Open `html` in a new tab inside a sandboxed (opaque-origin) iframe shell. */
export function openSandboxedTab(html: string, title = "Preview"): void {
  if (typeof window === "undefined") return;
  const shell =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title>` +
    `<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style>` +
    `</head><body><iframe sandbox="${SANDBOX}" srcdoc="${escapeAttr(html)}"></iframe></body></html>`;
  const url = URL.createObjectURL(new Blob([shell], { type: "text/html" }));
  window.open(url, "_blank", "noopener,noreferrer");
  // The document persists after load; revoke once the tab has had time to open.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
