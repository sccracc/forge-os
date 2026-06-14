import { describe, it, expect } from "vitest";
import { langToExt, defaultFilename, isPreviewable, wrapPreviewDoc, isArtifactCode } from "@/lib/code/snippet";

describe("snippet helpers", () => {
  it("maps languages to file extensions", () => {
    expect(langToExt("javascript")).toBe("js");
    expect(langToExt("python")).toBe("py");
    expect(langToExt("HTML")).toBe("html");
    expect(langToExt("unknown")).toBe("txt");
  });

  it("names html files index.html and others snippet.ext", () => {
    expect(defaultFilename("html")).toBe("index.html");
    expect(defaultFilename("css")).toBe("snippet.css");
  });

  it("flags html/svg snippets as previewable", () => {
    expect(isPreviewable("html", "")).toBe(true);
    expect(isPreviewable("", "<!doctype html><html></html>")).toBe(true);
    expect(isPreviewable("svg", "<svg></svg>")).toBe(true);
    expect(isPreviewable("js", "const x = 1")).toBe(false);
    expect(isPreviewable("css", "body{}")).toBe(false);
  });

  it("wraps a fragment into a full document", () => {
    expect(wrapPreviewDoc("<div>hi</div>")).toContain("<!doctype html>");
    expect(wrapPreviewDoc("<div>hi</div>")).toContain("<div>hi</div>");
  });

  it("preserves a full document's structure (and adds the storage shim so it doesn't crash on load)", () => {
    const full = "<!doctype html><html><head></head><body>x</body></html>";
    const out = wrapPreviewDoc(full);
    // Not re-wrapped, original content intact…
    expect(out.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(out).toContain("<body>x</body>");
    // …but the storage shim is injected so localStorage/sessionStorage are safe
    // in the opaque-origin preview sandbox.
    expect(out).toContain("forge-storage-shim");
  });

  it("treats previewable and multi-line code as artifacts, short/plain text inline", () => {
    expect(isArtifactCode("html", "<h1>hi</h1>")).toBe(true); // previewable
    expect(isArtifactCode("js", "const a = 1;\nconst b = 2;\nconst c = 3;\nf();")).toBe(true); // 4 lines
    expect(isArtifactCode("js", "doThing();")).toBe(false); // 1 line
    expect(isArtifactCode("text", "a\nb\nc\nd\ne")).toBe(false); // plain text
    expect(isArtifactCode("bash", "ls\ncd\npwd\necho hi")).toBe(false); // shell excluded
  });
});
