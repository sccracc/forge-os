import { describe, it, expect } from "vitest";
import {
  parseBuildStream,
  resolveBuildOps,
  buildFileStatuses,
  lineDiffStats,
} from "@/lib/code/build-stream";

const block = (path: string, body: string) => "```path=" + path + "\n" + body + "\n```";

describe("parseBuildStream", () => {
  it("separates narration from complete file blocks", () => {
    const text = `Here's the plan.\n\n${block("index.html", "<h1>Hi</h1>")}\n\nDone — try it.`;
    const { prose, files } = parseBuildStream(text);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "index.html", mode: "write", content: "<h1>Hi</h1>", done: true });
    expect(prose).toContain("Here's the plan.");
    expect(prose).toContain("Done — try it.");
  });

  it("never leaks code into the prose", () => {
    const text = `Building it now.\n${block("style.css", "body { color: red; }")}`;
    const { prose } = parseBuildStream(text);
    expect(prose).not.toContain("color: red");
    expect(prose).not.toContain("```");
    expect(prose).toBe("Building it now.");
  });

  it("recognizes edit blocks and tags their mode", () => {
    const text = "```edit=style.css\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```";
    const { files, prose } = parseBuildStream(text);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "style.css", mode: "edit", done: true });
    expect(prose).not.toContain("SEARCH");
  });

  it("marks a still-streaming trailing block as not done and keeps its body out of prose", () => {
    const text = `Writing the script.\n\`\`\`path=script.js\nconst x = 1;\nconst y =`;
    const { prose, files } = parseBuildStream(text);
    expect(prose).toBe("Writing the script.");
    expect(files).toHaveLength(1);
    expect(files[0].done).toBe(false);
    expect(files[0].path).toBe("script.js");
    expect(files[0].content).toContain("const x = 1;");
  });

  it("keeps multiple files in emission order", () => {
    const text = `${block("a.js", "1")}\n${block("b.js", "2")}\n${block("c.js", "3")}`;
    const { files } = parseBuildStream(text);
    expect(files.map((f) => f.path)).toEqual(["a.js", "b.js", "c.js"]);
    expect(files.every((f) => f.done)).toBe(true);
  });

  it("strips stray non-path code fences from narration", () => {
    const text = "Consider this:\n```js\nbad()\n```\nmoving on.";
    expect(parseBuildStream(text).prose).not.toContain("bad()");
  });
});

describe("resolveBuildOps", () => {
  it("writes a whole new file via a path block", () => {
    const ops = resolveBuildOps(parseBuildStream(block("index.html", "<h1>Hi</h1>")).files, new Map());
    expect(ops[0]).toMatchObject({ path: "index.html", mode: "write", isNew: true, ok: true });
    expect(ops[0].content).toBe("<h1>Hi</h1>");
  });

  it("applies an edit block against the current file (the FireMaker case)", () => {
    const existing = new Map([["app.js", "const brand = 'Forge';\nrun();"]]);
    const edit =
      "```edit=app.js\n<<<<<<< SEARCH\nconst brand = 'Forge';\n=======\nconst brand = 'FireMaker';\n>>>>>>> REPLACE\n```";
    const ops = resolveBuildOps(parseBuildStream(edit).files, existing);
    expect(ops[0].mode).toBe("edit");
    expect(ops[0].ok).toBe(true);
    expect(ops[0].content).toBe("const brand = 'FireMaker';\nrun();");
    expect(ops[0]).toMatchObject({ added: 1, removed: 1 });
  });

  it("marks an edit whose SEARCH doesn't match as not ok, leaving content unchanged", () => {
    const existing = new Map([["app.js", "alpha"]]);
    const edit = "```edit=app.js\n<<<<<<< SEARCH\nbeta\n=======\ngamma\n>>>>>>> REPLACE\n```";
    const ops = resolveBuildOps(parseBuildStream(edit).files, existing);
    expect(ops[0].ok).toBe(false);
    expect(ops[0].failedHunks).toBe(1);
    expect(ops[0].content).toBe("alpha");
  });
});

describe("resolveBuildOps write safety (no silent file-wipe)", () => {
  const big = (n: number) =>
    Array.from({ length: n }, (_, i) => `line ${i} with some real content here;`).join("\n");

  it("refuses a truncated full-file write (closing fence never arrived)", () => {
    const existing = new Map([["app.js", big(40)]]);
    // No closing ``` — the stream was cut off mid-file → done:false.
    const stream = "```path=app.js\nfunction start() {\n  const partial =";
    const parsed = parseBuildStream(stream);
    expect(parsed.files[0].done).toBe(false);
    const ops = resolveBuildOps(parsed.files, existing);
    expect(ops[0].mode).toBe("write");
    expect(ops[0].ok).toBe(false);
  });

  it("refuses a write that collapses a real file down to almost nothing", () => {
    const existing = new Map([["style.css", big(60)]]);
    const ops = resolveBuildOps(parseBuildStream(block("style.css", "/* oops */")).files, existing);
    expect(ops[0].ok).toBe(false);
    expect(ops[0].removed).toBeGreaterThan(50);
  });

  it("allows a large file to be reduced to a small shell when it is not a tiny wipe", () => {
    const existing = new Map([["index.html", big(1857)]]);
    const shell = ["<!doctype html>", "<html>", "<body></body>", "</html>"].join("\n");
    const ops = resolveBuildOps(parseBuildStream(block("index.html", shell)).files, existing);

    expect(ops[0].ok).toBe(true);
    expect(ops[0]).toMatchObject({ added: 4 });
    expect(ops[0].removed).toBeGreaterThan(1800);
  });

  it("allows a normal full rewrite of an existing file", () => {
    const existing = new Map([["app.js", big(40)]]);
    const ops = resolveBuildOps(parseBuildStream(block("app.js", big(25))).files, existing);
    expect(ops[0].ok).toBe(true);
  });

  it("allows the first real write into an empty starter file", () => {
    const existing = new Map([["index.html", ""]]);
    const ops = resolveBuildOps(parseBuildStream(block("index.html", "<h1>Hi</h1>")).files, existing);
    expect(ops[0].ok).toBe(true);
    expect(ops[0].isNew).toBe(false);
  });

  it("allows a brand-new tiny file (nothing to destroy)", () => {
    const ops = resolveBuildOps(parseBuildStream(block("robots.txt", "User-agent: *")).files, new Map());
    expect(ops[0].ok).toBe(true);
    expect(ops[0].isNew).toBe(true);
  });
});

describe("lineDiffStats", () => {
  it("counts every line as added for a new file", () => {
    expect(lineDiffStats("", "a\nb\nc")).toEqual({ added: 3, removed: 0 });
  });
  it("is zero for identical content", () => {
    expect(lineDiffStats("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
  });
  it("counts pure additions and removals", () => {
    expect(lineDiffStats("a\nb", "a\nb\nc\nd")).toEqual({ added: 2, removed: 0 });
    expect(lineDiffStats("a\nb\nc\nd", "a\nd")).toEqual({ added: 0, removed: 2 });
  });
  it("counts a modified line as +1 / -1", () => {
    expect(lineDiffStats("a\nb\nc", "a\nX\nc")).toEqual({ added: 1, removed: 1 });
  });
});

describe("buildFileStatuses", () => {
  it("shows a growing live diff for an in-progress edit block (REPLACE streaming)", () => {
    const existing = new Map<string, string>([["app.js", "a\nb\nc"]]);
    const stream = "```edit=app.js\n<<<<<<< SEARCH\nb\n=======\nX\nY"; // not closed yet
    const rows = buildFileStatuses(parseBuildStream(stream).files, existing);
    expect(rows[0]).toMatchObject({ path: "app.js", status: "writing" });
    expect(rows[0].added).toBeGreaterThan(0);
  });

  it("never shows a removed count while a full-file rewrite is still streaming", () => {
    // A large existing file being rewritten; the new content is only partway in.
    const existing = new Map<string, string>([["index.html", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")]]);
    const streaming = "```path=index.html\n<h1>new</h1>\n<p>partial"; // closing fence not arrived
    const rows = buildFileStatuses(parseBuildStream(streaming).files, existing);
    expect(rows[0]).toMatchObject({ path: "index.html", status: "writing", mode: "write", removed: 0 });
    expect(rows[0].added).toBeGreaterThan(0);
  });

  it("shows climbing progress (lines written), not a stuck +1, for a streaming rewrite", () => {
    // A rewrite whose partial new content reuses the old opening lines — a diff
    // against the old file would say ~0 added and look frozen at "+1".
    const old = Array.from({ length: 40 }, (_, i) => `<div>line ${i}</div>`).join("\n");
    const existing = new Map<string, string>([["index.html", old]]);
    const partial = "<div>line 0</div>\n<div>line 1</div>\n<div>line 2</div>\n<div>line 3</div>";
    const rows = buildFileStatuses(parseBuildStream("```path=index.html\n" + partial).files, existing);
    expect(rows[0]).toMatchObject({ status: "writing", removed: 0 });
    expect(rows[0].added).toBe(4); // 4 lines written so far — real progress, not +1
  });

  it("reveals the real removed count once a rewrite completes", () => {
    const existing = new Map<string, string>([["index.html", "a\nb\nc\nd"]]);
    const rows = buildFileStatuses(parseBuildStream(block("index.html", "a\nZ")).files, existing);
    expect(rows[0]).toMatchObject({ path: "index.html", status: "done", mode: "write" });
    expect(rows[0].removed).toBeGreaterThan(0); // b, c, d gone — shown on completion
  });

  it("flags new vs existing files and reports live diffs", () => {
    const existing = new Map<string, string>([["app.js", "old\ncode"]]);
    const parsed = parseBuildStream(`${block("app.js", "old\ncode\nmore")}\n\`\`\`path=new.css\n.x{}`);
    const rows = buildFileStatuses(parsed.files, existing);

    const app = rows.find((r) => r.path === "app.js")!;
    expect(app).toMatchObject({ status: "done", isNew: false, added: 1, removed: 0 });

    const css = rows.find((r) => r.path === "new.css")!;
    expect(css).toMatchObject({ status: "writing", isNew: true });
    expect(css.added).toBeGreaterThan(0);
  });
});

describe("cumulative multi-block resolution (no clobbering)", () => {
  const editBlock = (path: string, search: string, replace: string) =>
    "```edit=" + path + "\n<<<<<<< SEARCH\n" + search + "\n=======\n" + replace + "\n>>>>>>> REPLACE\n```";

  it("accumulates several edit blocks against the same file", async () => {
    const { resolveBuildOps } = await import("@/lib/code/build-stream");
    const existing = new Map([["script.js", "alpha\nbeta\ngamma"]]);
    const stream = editBlock("script.js", "alpha", "ALPHA") + "\n" + editBlock("script.js", "gamma", "GAMMA");
    const ops = resolveBuildOps(parseBuildStream(stream).files, existing);
    expect(ops).toHaveLength(2);
    // The SECOND op must contain BOTH changes — not just its own.
    expect(ops[1].content).toBe("ALPHA\nbeta\nGAMMA");
    expect(ops[0].ok).toBe(true);
    expect(ops[1].ok).toBe(true);
  });

  it("a failed block does not poison later blocks (working state keeps last good)", async () => {
    const { resolveBuildOps } = await import("@/lib/code/build-stream");
    const existing = new Map([["script.js", "alpha\nbeta"]]);
    const stream =
      editBlock("script.js", "alpha", "ALPHA") +
      "\n" +
      editBlock("script.js", "NO-SUCH-TEXT", "x") +
      "\n" +
      editBlock("script.js", "beta", "BETA");
    const ops = resolveBuildOps(parseBuildStream(stream).files, existing);
    expect(ops[1].ok).toBe(false);
    expect(ops[2].content).toBe("ALPHA\nBETA"); // builds on block 1, skips the bad block
  });

  it("lastOpPerPath keeps the final (fully accumulated) op per file", async () => {
    const { resolveBuildOps, lastOpPerPath } = await import("@/lib/code/build-stream");
    const existing = new Map([["script.js", "a\nb"], ["style.css", ".x{}"]]);
    const stream =
      editBlock("script.js", "a", "A") +
      "\n" +
      editBlock("style.css", ".x{}", ".y{}") +
      "\n" +
      editBlock("script.js", "b", "B");
    const ops = resolveBuildOps(parseBuildStream(stream).files, existing);
    const writes = lastOpPerPath(ops);
    expect(writes).toHaveLength(2);
    const js = writes.find((o) => o.path === "script.js")!;
    expect(js.content).toBe("A\nB");
  });

  it("aggregates the live panel to ONE row per file with summed +/-", () => {
    const existing = new Map([["script.js", "one\ntwo\nthree"]]);
    const stream = editBlock("script.js", "one", "ONE") + "\n" + editBlock("script.js", "three", "THREE");
    const rows = buildFileStatuses(parseBuildStream(stream).files, existing);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "script.js", status: "done", added: 2, removed: 2 });
  });

  it("keeps the aggregated row in 'writing' state while the trailing block streams", () => {
    const existing = new Map([["script.js", "one\ntwo"]]);
    const stream = editBlock("script.js", "one", "ONE") + "\n```edit=script.js\n<<<<<<< SEARCH\ntwo\n=======\nTW"; // trailing block unfinished
    const rows = buildFileStatuses(parseBuildStream(stream).files, existing);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("writing");
  });
});
