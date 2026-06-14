import { describe, it, expect } from "vitest";
import {
  detectPreviewKind,
  effectivePreviewMode,
  assembleWeb,
  resolveNavTarget,
} from "@/lib/code/preview";
import type { FileDoc } from "@/lib/data/types";

const file = (path: string, content = ""): FileDoc => ({
  id: path,
  name: path.split("/").pop()!,
  path,
  parentId: null,
  projectId: "p",
  kind: "file",
  size: content.length,
  content,
  createdAt: 0,
  updatedAt: 0,
});

describe("detectPreviewKind", () => {
  it("detects web from html files", () => {
    expect(detectPreviewKind([file("index.html"), file("style.css")])).toBe("web");
  });
  it("detects react from jsx/tsx", () => {
    expect(detectPreviewKind([file("index.html"), file("src/App.jsx")])).toBe("react");
  });
  it("detects vue from .vue", () => {
    expect(detectPreviewKind([file("src/App.vue")])).toBe("vue");
  });
  it("returns none with no web files", () => {
    expect(detectPreviewKind([file("main.py"), file("README.md")])).toBe("none");
  });
});

describe("effectivePreviewMode", () => {
  it("prefers a real stored mode", () => {
    expect(effectivePreviewMode({ previewMode: "react" as const }, [file("index.html")])).toBe("react");
  });
  it("falls back to detection for a blank/none project", () => {
    expect(effectivePreviewMode({ previewMode: "none" as const }, [file("index.html")])).toBe("web");
  });
  it("detects when project is null", () => {
    expect(effectivePreviewMode(null, [file("index.html")])).toBe("web");
  });
});

describe("assembleWeb", () => {
  const files = [
    file(
      "index.html",
      `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Home</h1><a href="about.html">About</a><script src="app.js"></script></body></html>`
    ),
    file("style.css", "h1{color:red}"),
    file("app.js", "console.log(1)"),
    file("about.html", `<!doctype html><html><body><h1>About</h1></body></html>`),
  ];

  it("inlines local css and js", () => {
    const html = assembleWeb(files);
    expect(html).toContain("<style>");
    expect(html).toContain("color:red");
    expect(html).toContain("console.log(1)");
    expect(html).not.toContain('href="style.css"');
  });
  it("renders the requested entry page", () => {
    expect(assembleWeb(files, "about.html")).toContain("About");
  });
  it("injects the nav shim by default and omits it when disabled", () => {
    expect(assembleWeb(files)).toContain("__forgeNav");
    expect(assembleWeb(files, undefined, false)).not.toContain("__forgeNav");
  });
});

describe("resolveNavTarget", () => {
  const files = [file("index.html"), file("about.html"), file("pages/contact.html")];
  it("resolves a sibling page", () => {
    expect(resolveNavTarget(files, "index.html", "about.html")).toBe("about.html");
  });
  it("resolves into a subfolder", () => {
    expect(resolveNavTarget(files, "index.html", "pages/contact.html")).toBe("pages/contact.html");
  });
  it("strips query and hash", () => {
    expect(resolveNavTarget(files, "index.html", "about.html?x=1#top")).toBe("about.html");
  });
  it("returns null for unknown targets", () => {
    expect(resolveNavTarget(files, "index.html", "missing.html")).toBeNull();
  });
});
