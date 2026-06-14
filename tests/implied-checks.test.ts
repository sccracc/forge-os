import { describe, expect, it } from "vitest";
import { impliedChecksForBuildRequest, impliedChecksToPrompt } from "@/lib/code/implied-checks";

describe("impliedChecksForBuildRequest", () => {
  it("adds enforceable checks for 3D game physics requests", () => {
    const checks = impliedChecksForBuildRequest(
      "Create a 3D Three.js house game with WASD, an NPC, collision detection, and a cube with physics I can throw around."
    );

    expect(checks.some((c) => c.type === "dom_has" && c.element === "canvas")).toBe(true);
    expect(checks.some((c) => c.type === "contains_any" && /physicsCube/.test(c.pattern))).toBe(true);
    expect(checks.some((c) => c.type === "contains_any" && /cubeVelocity/.test(c.pattern))).toBe(true);
    expect(checks.some((c) => c.type === "contains_any" && /collider/.test(c.pattern))).toBe(true);
    expect(checks.some((c) => c.type === "smoke" && c.id === "forge-game-debug")).toBe(true);
  });

  it("does not add game checks for ordinary website requests", () => {
    expect(impliedChecksForBuildRequest("Make the pricing cards prettier.")).toHaveLength(0);
  });

  it("does not force canvas checks on simple DOM games", () => {
    expect(impliedChecksForBuildRequest("Create a simple tic-tac-toe game with buttons.")).toHaveLength(0);
  });
});

describe("impliedChecksToPrompt", () => {
  it("tells the build agent about verifier-owned requirements", () => {
    const prompt = impliedChecksToPrompt(
      impliedChecksForBuildRequest("Add a physics cube that the player can throw.")
    );

    expect(prompt).toContain("FORGE-OWNED VERIFICATION REQUIREMENTS");
    expect(prompt).toContain("window.__forgeGameDebug");
    expect(prompt).toContain("physicsCube");
  });
});
