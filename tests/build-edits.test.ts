import { describe, it, expect } from "vitest";
import { parseEditHunks, applyOneHunk, applyEdits } from "@/lib/code/build-edits";

describe("parseEditHunks", () => {
  it("parses a single hunk", () => {
    const body = "<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE";
    expect(parseEditHunks(body)).toEqual([{ search: "foo", replace: "bar" }]);
  });

  it("parses multiple hunks in one block", () => {
    const body =
      "<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE";
    expect(parseEditHunks(body)).toHaveLength(2);
  });

  it("ignores an unterminated trailing hunk (still streaming)", () => {
    const body = "<<<<<<< SEARCH\na\n=======\nA"; // no REPLACE marker yet
    expect(parseEditHunks(body)).toHaveLength(0);
  });

  it("lenient mode includes the in-progress hunk (for the live diff)", () => {
    const body = "<<<<<<< SEARCH\nold\n=======\nnew partial"; // REPLACE still streaming
    expect(parseEditHunks(body)).toHaveLength(0); // strict
    expect(parseEditHunks(body, true)).toEqual([{ search: "old", replace: "new partial" }]);
  });

  it("preserves multi-line search and replace bodies", () => {
    const body = "<<<<<<< SEARCH\nline1\nline2\n=======\nnew1\nnew2\nnew3\n>>>>>>> REPLACE";
    const [h] = parseEditHunks(body);
    expect(h.search).toBe("line1\nline2");
    expect(h.replace).toBe("new1\nnew2\nnew3");
  });
});

describe("applyOneHunk", () => {
  it("replaces an exact match", () => {
    expect(applyOneHunk("a\nb\nc", "b", "B")).toBe("a\nB\nc");
  });

  it("tolerates trailing-whitespace differences in SEARCH", () => {
    expect(applyOneHunk("const x = 1;\nrun();", "const x = 1;   ", "const x = 2;")).toBe(
      "const x = 2;\nrun();"
    );
  });

  it("returns null when SEARCH is not found", () => {
    expect(applyOneHunk("a\nb", "zzz", "Z")).toBeNull();
  });

  it("refuses an AMBIGUOUS exact match (multiple occurrences) instead of editing the first", () => {
    expect(applyOneHunk("item()\nother()\nitem()", "item()", "changed()")).toBeNull();
  });

  it("refuses an ambiguous loose (whitespace-tolerant) match", () => {
    expect(applyOneHunk("a  \nb\na  \nc", "a", "A")).toBeNull();
  });

  it("still applies when the match is unique", () => {
    expect(applyOneHunk("item()\nother()", "item()", "changed()")).toBe("changed()\nother()");
  });

  it("matches multi-line LF search text against CRLF file content", () => {
    // Exact match fails (\r\n vs \n) — the loose matcher must still land it.
    expect(applyOneHunk("a;\r\nb;\r\nc;", "a;\nb;", "A;\nB;")).toBe("A;\nB;\nc;");
  });
});

describe("applyEdits", () => {
  it("applies hunks sequentially and counts results", () => {
    const r = applyEdits("x = 1\ny = 2", [
      { search: "x = 1", replace: "x = 10" },
      { search: "y = 2", replace: "y = 20" },
    ]);
    expect(r.content).toBe("x = 10\ny = 20");
    expect(r.applied).toBe(2);
    expect(r.failed).toBe(0);
  });

  it("counts failed hunks without throwing or corrupting content", () => {
    const r = applyEdits("hello", [{ search: "nope", replace: "x" }]);
    expect(r.applied).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.content).toBe("hello");
  });
});
