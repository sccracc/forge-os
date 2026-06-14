import { describe, it, expect } from "vitest";
import { fileDiff, buildDiffs, formatDiffsForPrompt } from "@/lib/code/diff";

describe("diff — fileDiff", () => {
  it("marks a brand-new file and counts added lines", () => {
    const d = fileDiff("a.js", "", "const x = 1;\nconst y = 2;");
    expect(d.isNew).toBe(true);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
    expect(d.patch).toContain("+const x = 1;");
  });

  it("produces a unified hunk with +/- for a modification", () => {
    const before = "line1\nline2\nline3";
    const after = "line1\nlineTWO\nline3";
    const d = fileDiff("a.txt", before, after);
    expect(d.isNew).toBe(false);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.patch).toContain("@@");
    expect(d.patch).toContain("-line2");
    expect(d.patch).toContain("+lineTWO");
  });

  it("treats emptying a file as a deletion", () => {
    const d = fileDiff("a.txt", "stuff", "");
    expect(d.isDeleted).toBe(true);
    expect(d.removed).toBe(1);
  });
});

describe("diff — buildDiffs + formatDiffsForPrompt", () => {
  it("only includes files that actually changed", () => {
    const before = new Map([["a.js", "x"], ["b.js", "same"]]);
    const after = new Map([["a.js", "y"], ["b.js", "same"]]);
    const diffs = buildDiffs(["a.js", "b.js"], before, after);
    expect(diffs.map((d) => d.path)).toEqual(["a.js"]);
  });

  it("formats diffs with a/ and b/ headers and respects the byte cap", () => {
    const before = new Map([["a.js", "old"]]);
    const after = new Map([["a.js", "new"]]);
    const text = formatDiffsForPrompt(buildDiffs(["a.js"], before, after));
    expect(text).toContain("--- a/a.js");
    expect(text).toContain("+++ b/a.js");
  });

  it("reports no changes cleanly", () => {
    expect(formatDiffsForPrompt([])).toContain("no file changes");
  });
});
