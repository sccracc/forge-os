import { describe, expect, it } from "vitest";
import {
  canUseModel,
  canUseEffort,
  canUseThinking,
  canUseForgeCode,
  canUseFileSystem,
  getProjectLimit,
  getFeatureLimit,
  getRequiredPlan,
  getUpgradeMessage,
} from "@/lib/plans/gates";

describe("canUseModel", () => {
  it("locks Magnum to paid plans; Spark everywhere", () => {
    for (const p of ["free", "starter"]) {
      expect(canUseModel(p, "spark-2.5")).toBe(true);
      expect(canUseModel(p, "magnum-2.8")).toBe(false);
    }
    for (const p of ["pro", "max", "ultra"]) {
      expect(canUseModel(p, "magnum-2.8")).toBe(true);
    }
  });
});

describe("canUseEffort", () => {
  it("caps effort per plan", () => {
    expect(canUseEffort("free", "medium")).toBe(true);
    expect(canUseEffort("free", "high")).toBe(false);
    expect(canUseEffort("starter", "high")).toBe(true);
    expect(canUseEffort("starter", "xhigh")).toBe(false);
    expect(canUseEffort("pro", "xhigh")).toBe(true);
    expect(canUseEffort("pro", "max")).toBe(false);
    expect(canUseEffort("max", "max")).toBe(true);
    expect(canUseEffort("ultra", "max")).toBe(true);
  });
});

describe("canUseThinking", () => {
  it("free never, starter Spark-only, paid both", () => {
    expect(canUseThinking("free", "spark-2.5")).toBe(false);
    expect(canUseThinking("starter", "spark-2.5")).toBe(true);
    expect(canUseThinking("starter", "magnum-2.8")).toBe(false);
    expect(canUseThinking("pro", "magnum-2.8")).toBe(true);
    expect(canUseThinking("ultra", "magnum-2.8")).toBe(true);
  });
});

describe("workspace gates", () => {
  it("Forge Code + file system are Pro+", () => {
    expect(canUseForgeCode("starter")).toBe(false);
    expect(canUseForgeCode("pro")).toBe(true);
    expect(canUseFileSystem("free")).toBe(false);
    expect(canUseFileSystem("max")).toBe(true);
  });

  it("project limits", () => {
    expect(getProjectLimit("free")).toBe(0);
    expect(getProjectLimit("starter")).toBe(0);
    expect(getProjectLimit("pro")).toBe(20);
    expect(getProjectLimit("max")).toBe(50);
    expect(getProjectLimit("ultra")).toBeNull();
  });
});

describe("getFeatureLimit", () => {
  it("reads PLAN_LIMITS, defaulting unknown plans to free", () => {
    expect(getFeatureLimit("free", "searches")).toBe(0);
    expect(getFeatureLimit("starter", "images")).toBe(20);
    expect(getFeatureLimit("pro", "vision")).toBe(180);
    expect(getFeatureLimit("max", "code_executions")).toBe(300);
    expect(getFeatureLimit("ultra", "voice_output_chars")).toBe(300000);
    expect(getFeatureLimit("nonsense", "images")).toBe(0); // → free
  });
});

describe("upgrade messaging", () => {
  it("maps features to their minimum plan", () => {
    expect(getRequiredPlan("Magnum 2.8")).toBe("pro");
    expect(getRequiredPlan("Web search")).toBe("starter");
    expect(getRequiredPlan("Voice output")).toBe("pro");
    expect(getRequiredPlan("Code execution")).toBe("pro");
    expect(getRequiredPlan("Max effort")).toBe("max");
  });

  it("phrases the upgrade message", () => {
    expect(getUpgradeMessage("free", "Web search")).toBe(
      "Web search is available on Starter and above."
    );
    expect(getUpgradeMessage("free", "Forge Code")).toBe(
      "Forge Code is available on Pro and above."
    );
  });
});
