import { describe, it, expect } from "vitest";
import { EFFORT, EFFORT_IDS, DEFAULT_EFFORT } from "@/lib/ai/effort";
import { EFFORT_DIRECTIVE } from "@/lib/ai/prompts";

const ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

describe("effort levels", () => {
  it("has five levels", () => {
    expect(EFFORT_IDS).toHaveLength(5);
  });

  it("default is low", () => {
    expect(DEFAULT_EFFORT).toBe("low");
  });

  it("maxTokens strictly increases with effort", () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(EFFORT[ORDER[i]].maxTokens).toBeGreaterThan(EFFORT[ORDER[i - 1]].maxTokens);
    }
  });

  it("temperature decreases as effort rises", () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(EFFORT[ORDER[i]].tempNoThink).toBeLessThan(EFFORT[ORDER[i - 1]].tempNoThink);
    }
  });

  it("each level injects a distinct, tagged system-prompt directive", () => {
    const directives = ORDER.map((id) => EFFORT_DIRECTIVE[id]);
    // all 5 are unique
    expect(new Set(directives).size).toBe(5);
    // each is non-trivial and carries its [EFFORT: …] marker
    for (const d of directives) expect(d.length).toBeGreaterThan(40);
    expect(EFFORT_DIRECTIVE.low).toContain("[EFFORT: LOW]");
    expect(EFFORT_DIRECTIVE.max).toContain("[EFFORT: MAX]");
  });
});
