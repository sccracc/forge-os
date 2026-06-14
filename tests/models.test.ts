import { describe, it, expect } from "vitest";
import { resolveProviderModel } from "@/lib/ai/models";
import {
  FORGE_MODELS_PUBLIC,
  FORGE_MODEL_IDS,
  DEFAULT_MODEL,
} from "@/lib/ai/models.public";

describe("model mapping", () => {
  it("maps each Forge model to its provider string", () => {
    expect(resolveProviderModel("spark-2.5")).toBe("deepseek-v4-flash");
    expect(resolveProviderModel("magnum-2.8")).toBe("deepseek-v4-pro");
  });

  it("exposes exactly two models", () => {
    expect(FORGE_MODEL_IDS).toHaveLength(2);
  });

  it("default model is spark-2.5 (new users start on Spark/Low)", () => {
    expect(DEFAULT_MODEL).toBe("spark-2.5");
  });

  it("public metadata leaks no provider identifiers", () => {
    const json = JSON.stringify(FORGE_MODELS_PUBLIC).toLowerCase();
    expect(json).not.toContain("deepseek");
    expect(json).not.toContain("provider");
  });
});
