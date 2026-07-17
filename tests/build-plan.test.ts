import { describe, it, expect } from "vitest";
import { parseBuildPlan, planToContext, checklistToPrompt, type PlanCheck } from "@/lib/ai/build-plan";

describe("parseBuildPlan", () => {
  it("parses a forge-plan fence", () => {
    const out = [
      "```forge-plan",
      JSON.stringify({
        summary: "Build a todo app",
        steps: [{ title: "Create index", files: ["index.html"], detail: "shell" }],
        checklist: [{ type: "file_exists", path: "index.html" }],
        assumptions: ["vanilla JS"],
      }),
      "```",
    ].join("\n");
    const plan = parseBuildPlan(out);
    expect(plan).not.toBeNull();
    expect(plan!.steps).toHaveLength(1);
    expect(plan!.checklist).toHaveLength(1);
  });

  it("drops unknown check types but keeps the rest", () => {
    const out = [
      "```forge-plan",
      JSON.stringify({
        summary: "x",
        steps: [],
        checklist: [
          { type: "file_exists", path: "a.js" },
          { type: "made-up-check", foo: 1 },
        ],
      }),
      "```",
    ].join("\n");
    expect(parseBuildPlan(out)!.checklist).toHaveLength(1);
  });

  it("returns null for garbage", () => {
    expect(parseBuildPlan("no plan here")).toBeNull();
  });
});

describe("checklistToPrompt", () => {
  it("renders every check type as a readable gate line", () => {
    const checks: PlanCheck[] = [
      { type: "file_exists", path: "index.html" },
      { type: "contains", path: "style.css", pattern: "flip" },
      { type: "contains_any", pattern: "requestAnimationFrame" },
      { type: "absent_everywhere", pattern: "OldName" },
      { type: "page_count", count: 4 },
      { type: "dom_has", element: "form" },
      { type: "smoke", label: "clicking Add creates a todo", code: "return true" },
    ];
    const text = checklistToPrompt(checks);
    expect(text).toContain("file exists: index.html");
    expect(text).toContain("style.css matches /flip/i");
    expect(text).toContain("some project file matches /requestAnimationFrame/i");
    expect(text).toContain("NO project file matches /OldName/i");
    expect(text).toContain("4 HTML pages");
    expect(text).toContain("<form>");
    expect(text).toContain("smoke test passes: clicking Add creates a todo");
    expect(text.split("\n")).toHaveLength(7);
  });
});

describe("planToContext", () => {
  it("renders steps with files and details", () => {
    const plan = parseBuildPlan(
      "```forge-plan\n" +
        JSON.stringify({
          summary: "Goal here",
          steps: [{ title: "Step A", files: ["a.js"], detail: "why" }],
          checklist: [],
        }) +
        "\n```"
    )!;
    const ctx = planToContext(plan);
    expect(ctx).toContain("Goal here");
    expect(ctx).toContain("1. Step A (a.js) — why");
  });
});
