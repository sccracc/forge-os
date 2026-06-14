import { describe, it, expect } from "vitest";
import {
  rankFiles,
  buildRetrievalContext,
  tokenize,
  type RetrievalFile,
} from "@/lib/code/retrieval";

const f = (path: string, content: string, updatedAt?: number): RetrievalFile => ({
  path,
  content,
  updatedAt,
});

describe("retrieval — tokenize", () => {
  it("drops stopwords and short tokens, splits camelCase", () => {
    const t = tokenize("Please update the NavBar color");
    expect(t).toContain("nav");
    expect(t).toContain("bar");
    expect(t).toContain("color");
    expect(t).not.toContain("the");
    expect(t).not.toContain("update"); // command stopword
  });
});

describe("retrieval — rankFiles", () => {
  const files = [
    f("index.html", "<nav class='navbar'><a href='about.html'>About</a></nav>"),
    f("css/navbar.css", ".navbar { color: #888; }"),
    f("about.html", "<h1>About us</h1>"),
    f("js/unrelated-analytics.js", "function track() {}"),
  ];

  it("ranks a file named in the request to the top", () => {
    const ranked = rankFiles(files, "change the navbar color", 1);
    expect(ranked[0].path).toBe("css/navbar.css");
  });

  it("ranks an unrelated file last", () => {
    const ranked = rankFiles(files, "change the navbar color", 1);
    expect(ranked[ranked.length - 1].path).toBe("js/unrelated-analytics.js");
  });

  it("boosts files reachable via the reference graph from a mentioned file", () => {
    const ranked = rankFiles(files, "edit index.html", 1);
    const about = ranked.find((r) => r.path === "about.html")!;
    const analytics = ranked.find((r) => r.path === "js/unrelated-analytics.js")!;
    // about.html is linked from index.html (mentioned) → outranks the unlinked file.
    expect(about.score).toBeGreaterThan(analytics.score);
  });
});

describe("retrieval — buildRetrievalContext", () => {
  it("always includes the full file tree", () => {
    const { context } = buildRetrievalContext(
      [f("index.html", "<h1>Hi</h1>"), f("style.css", "body{}")],
      "tweak the heading"
    );
    expect(context).toContain("File tree");
    expect(context).toContain("- index.html");
    expect(context).toContain("- style.css");
  });

  it("inlines relevant files in full and summarizes the rest under a tight budget", () => {
    const big = "x".repeat(5000);
    const files = [
      f("target.js", `// relevant widget logic\n${big}`),
      f("other-a.js", `// unrelated\n${big}`),
      f("other-b.js", `// unrelated\n${big}`),
    ];
    const r = buildRetrievalContext(files, "fix the widget in target.js", {
      budgetBytes: 6000,
      maxFullFiles: 10,
      neighborDepth: 1,
    });
    expect(r.includedFull).toContain("target.js");
    // The budget only fits one full file; the others must be summarized, never dropped.
    expect(r.summarized.length).toBeGreaterThan(0);
    expect(r.includedFull.length + r.summarized.length).toBe(3);
    expect(r.context).toContain("ask to see any in full");
  });

  it("never silently drops a file — every file is either inlined or summarized", () => {
    const files = Array.from({ length: 20 }, (_, i) => f(`file${i}.js`, "y".repeat(2000)));
    const r = buildRetrievalContext(files, "touch file3.js", {
      budgetBytes: 5000,
      maxFullFiles: 3,
      neighborDepth: 1,
    });
    expect(r.includedFull.length).toBeLessThanOrEqual(3);
    expect(r.includedFull.length + r.summarized.length).toBe(20);
  });

  it("keeps a small project fully inlined (no regression vs dumping everything)", () => {
    const files = [f("index.html", "<h1>Hello</h1>"), f("app.js", "console.log(1)")];
    const r = buildRetrievalContext(files, "anything");
    expect(r.summarized).toHaveLength(0);
    expect(r.includedFull).toHaveLength(2);
    expect(r.context).toContain("<h1>Hello</h1>");
  });
});
