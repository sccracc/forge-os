import { describe, it, expect } from "vitest";
import { detectFabricatedData, claimedCount } from "@/lib/code/fabrication";

const f = (path: string, content: string) => ({ path, content });
const many = (tok: string, n: number) => Array.from({ length: n }, () => tok).join(",");

describe("claimedCount", () => {
  it("extracts the largest claimed dataset size", () => {
    expect(claimedCount("expand to ~20,000 solution words and ~50,000+ valid guesses.")).toBe(50000);
  });
  it("ignores small / non-dataset numbers", () => {
    expect(claimedCount("a 5 letter word game with a few words")).toBe(0);
  });
});

describe("detectFabricatedData", () => {
  it("flags placeholder / omitted data in code", () => {
    const files = [f("script.js", 'const W = ["aback","abase", // ...1995 more words\n];')];
    expect(detectFabricatedData("expanded the word list", files)).toBeTruthy();
  });

  it("flags a big claim with too few entries and no runtime fetch", () => {
    const files = [f("script.js", `const VALID = [${many('"abcde"', 50)}];`)];
    expect(detectFabricatedData("now ~20,000 valid guesses", files)).toBeTruthy();
  });

  it("does NOT flag when the data is fetched at runtime", () => {
    const files = [
      f("script.js", `const res = await fetch("https://example.com/words"); const VALID = (await res.text()).split("\\n");`),
    ];
    expect(detectFabricatedData("now ~20,000 valid guesses", files)).toBeNull();
  });

  it("does NOT flag a small, honestly described list", () => {
    const files = [f("script.js", `const VALID = [${many('"abcde"', 50)}];`)];
    expect(detectFabricatedData("added a starter list of words", files)).toBeNull();
  });

  it("ignores non-code files", () => {
    expect(detectFabricatedData("20,000 words", [f("README.md", "...and the rest of the words")])).toBeNull();
  });
});
