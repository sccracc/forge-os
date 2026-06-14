import { describe, it, expect } from "vitest";
import { extractRenames, staleTermFiles } from "@/lib/code/consistency";

describe("extractRenames", () => {
  it("extracts a capitalized old brand from 'rename X to Y'", () => {
    expect(extractRenames("rename Forge to FireMaker")).toContain("Forge");
  });
  it("extracts a quoted old term", () => {
    expect(extractRenames('change "Forge OS" to "FireMaker"')).toContain("Forge OS");
  });
  it("handles 'from X to Y'", () => {
    expect(extractRenames("change the title from Forge to FireMaker")).toContain("Forge");
  });
  it("ignores common UI words and vague requests (no false positives)", () => {
    expect(extractRenames("change the name to FireMaker")).toEqual([]);
    expect(extractRenames("change the header to blue")).toEqual([]);
    expect(extractRenames("make it 1000x more interactive")).toEqual([]);
  });
});

describe("staleTermFiles", () => {
  const files = [
    { path: "index.html", content: "<title>FireMaker</title>" },
    { path: "about.html", content: "<h1>Welcome to Forge</h1>" },
    { path: "style.css", content: ".logo { color: red; }" },
  ];
  it("finds files that still contain the old term", () => {
    const stale = staleTermFiles(["Forge"], files);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ term: "Forge", paths: ["about.html"] });
  });
  it("returns nothing once fully renamed", () => {
    const clean = files.map((f) => ({ ...f, content: f.content.replace(/Forge/g, "FireMaker") }));
    expect(staleTermFiles(["Forge"], clean)).toEqual([]);
  });
  it("matches whole words, case-insensitively (not partials)", () => {
    expect(staleTermFiles(["forge"], [{ path: "a.js", content: "const FORGE = 1;" }])).toHaveLength(1);
    expect(staleTermFiles(["forge"], [{ path: "a.js", content: "forgery shop" }])).toEqual([]);
  });
});
