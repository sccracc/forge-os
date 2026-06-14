import { describe, expect, it } from "vitest";
import { imageModelForPlan, imageModelLabelForPlan } from "@/lib/images/public";

describe("public image model access", () => {
  it("names image models by plan without provider identifiers", () => {
    expect(imageModelForPlan("free")).toBe("none");
    expect(imageModelLabelForPlan("starter")).toBe("Forge Image");
    expect(imageModelLabelForPlan("pro")).toBe("Forge Image");
    expect(imageModelLabelForPlan("max")).toBe("Forge Image Pro");
    expect(imageModelLabelForPlan("ultra")).toBe("Forge Image Pro");
  });
});
