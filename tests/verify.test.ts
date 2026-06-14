import { describe, it, expect } from "vitest";
import { checkReferences } from "@/lib/code/verify/static-checks";
import { formatIssuesForFix } from "@/lib/code/verify";
import { evaluateChecklist } from "@/lib/code/verify/checklist";
import type { FileDoc } from "@/lib/data/types";

const f = (path: string, content: string): FileDoc =>
  ({ path, kind: "file", content } as unknown as FileDoc);

describe("checkReferences", () => {
  it("flags a missing stylesheet and script", () => {
    const issues = checkReferences([
      f("index.html", `<link rel="stylesheet" href="style.css"><script src="script.js"></script>`),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.kind === "ref")).toBe(true);
  });

  it("passes when referenced files exist", () => {
    const issues = checkReferences([
      f("index.html", `<link rel="stylesheet" href="style.css"><script src="script.js"></script>`),
      f("style.css", "body{}"),
      f("script.js", "console.log(1)"),
    ]);
    expect(issues).toHaveLength(0);
  });

  it("ignores external / CDN references", () => {
    const issues = checkReferences([
      f(
        "index.html",
        `<link rel="stylesheet" href="https://fonts.googleapis.com/x"><script src="https://cdn.example/x.js"></script>`
      ),
    ]);
    expect(issues).toHaveLength(0);
  });

  it("flags a broken local page link and passes when it exists", () => {
    expect(checkReferences([f("index.html", `<a href="about.html">About</a>`)])).toHaveLength(1);
    expect(
      checkReferences([f("index.html", `<a href="about.html">About</a>`), f("about.html", "<h1>About</h1>")])
    ).toHaveLength(0);
  });

  it("ignores anchors, mailto, and tel links", () => {
    const issues = checkReferences([
      f("index.html", `<a href="#section">x</a><a href="mailto:a@b.com">y</a><a href="tel:123">z</a>`),
    ]);
    expect(issues).toHaveLength(0);
  });

  it("flags a missing image", () => {
    expect(checkReferences([f("index.html", `<img src="logo.png">`)])).toHaveLength(1);
  });

  it("resolves relative paths from a nested page", () => {
    const issues = checkReferences([
      f("pages/about.html", `<link rel="stylesheet" href="../style.css">`),
      f("style.css", "body{}"),
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("formatIssuesForFix", () => {
  it("includes file:line and an error category", () => {
    const out = formatIssuesForFix([
      { kind: "compile", path: "script.js", line: 42, message: "x is not defined" },
      { kind: "runtime", message: "Cannot read properties of null" },
    ]);
    expect(out).toContain("[script.js:42]");
    expect(out).toContain("Build error");
    expect(out).toContain("Runtime error");
    expect(out).toContain("x is not defined");
  });
});

describe("evaluateChecklist", () => {
  it("checks project-wide contains_any patterns", () => {
    const files = [
      f("index.html", `<canvas></canvas><script src="script.js"></script>`),
      f("script.js", "function loop(){ requestAnimationFrame(loop); }"),
    ];

    expect(
      evaluateChecklist(
        [{ type: "contains_any", pattern: "requestAnimationFrame", label: "Needs a game loop" }],
        files,
        { dom: null, smoke: [] }
      )
    ).toHaveLength(0);

    const missingPhysics = evaluateChecklist(
      [{ type: "contains_any", pattern: "physicsCube", label: "Needs cube physics" }],
      files,
      { dom: null, smoke: [] }
    );
    expect(missingPhysics[0]?.message).toBe("Needs cube physics");
  });
});
