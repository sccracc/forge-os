import { describe, it, expect } from "vitest";
import {
  FORGE_CODE_MAX_OUTPUT_TOKENS,
  isForgeCodeMode,
  forgeCodeEffortProfile,
} from "@/lib/code/forge-code-config";
import { EFFORT_IDS } from "@/lib/ai/effort";

describe("forge-code-config — output token policy", () => {
  it("pins the Forge Code output ceiling at 384k", () => {
    expect(FORGE_CODE_MAX_OUTPUT_TOKENS).toBe(384_000);
  });

  it("recognizes every code-* mode and rejects chat", () => {
    expect(isForgeCodeMode("code-build")).toBe(true);
    expect(isForgeCodeMode("code-discuss")).toBe(true);
    expect(isForgeCodeMode("code-plan")).toBe(true);
    expect(isForgeCodeMode("chat")).toBe(false);
    expect(isForgeCodeMode(undefined)).toBe(false);
  });
});

describe("forge-code-config — effort profile", () => {
  it("returns a profile for every effort level", () => {
    for (const e of EFFORT_IDS) {
      expect(forgeCodeEffortProfile(e)).toBeTruthy();
    }
  });

  it("never encodes an output-token limit (effort drives depth, not size)", () => {
    for (const e of EFFORT_IDS) {
      const profile = forgeCodeEffortProfile(e) as unknown as Record<string, unknown>;
      // No field should describe an output/token cap — that is fixed elsewhere.
      const keys = Object.keys(profile).join(" ").toLowerCase();
      expect(keys).not.toMatch(/output|maxtoken|max_token/);
    }
  });

  it("scales verification depth and retrieval budget up with effort", () => {
    const low = forgeCodeEffortProfile("low");
    const max = forgeCodeEffortProfile("max");
    expect(max.verifyHeals).toBeGreaterThanOrEqual(low.verifyHeals);
    expect(max.retrievalBudgetBytes).toBeGreaterThan(low.retrievalBudgetBytes);
    expect(max.retrievalMaxFullFiles).toBeGreaterThan(low.retrievalMaxFullFiles);
    expect(max.maxCorrectivePasses).toBeGreaterThanOrEqual(low.maxCorrectivePasses);
    expect(max.buildTokenBudget).toBeGreaterThan(low.buildTokenBudget);
  });

  it("keeps self-correction cycles small and budgeted so a build can't run away with usage", () => {
    for (const e of EFFORT_IDS) {
      const p = forgeCodeEffortProfile(e);
      // A single build must never spin through a dozen expensive cycles.
      expect(p.selfCorrectIterations).toBeLessThanOrEqual(4);
      expect(p.selfCorrectIterations).toBeGreaterThanOrEqual(2);
      // Every effort carries a hard token budget.
      expect(p.buildTokenBudget).toBeGreaterThan(0);
    }
    expect(forgeCodeEffortProfile("low").planning).toBe(true);
    expect(forgeCodeEffortProfile("low").reviewPass).toBe(true);
  });
});
