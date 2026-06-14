import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "@/lib/ai/prompts";

describe("current Forge state prompt", () => {
  it("includes the current runtime state using public Forge labels", () => {
    const prompt = assembleSystemPrompt({
      effort: "max",
      mode: "chat",
      date: "Tuesday, June 2, 2026",
      toolsEnabled: true,
      currentState: {
        model: "magnum-2.8",
        effort: "max",
        thinking: true,
        mode: "chat",
        toolsEnabled: true,
        activeSkillSlugs: ["writer", "code-review"],
        activeAgentId: "frontend",
        connectorIds: ["drive"],
        conversationId: "conv_123",
        conversationTitle: "Model Settings",
        projectId: "proj_123",
        incognito: false,
      },
    });

    expect(prompt).toContain("## Current Forge State");
    expect(prompt).toContain("Current model: Magnum 2.8");
    expect(prompt).toContain("Current effort: Max");
    expect(prompt).toContain("Thinking: on");
    expect(prompt).toContain("Active skills: writer, code-review");
    expect(prompt).toContain("Conversation title: Model Settings");
  });

  it("does not expose provider implementation names", () => {
    const prompt = assembleSystemPrompt({
      effort: "low",
      mode: "chat",
      date: "Tuesday, June 2, 2026",
      currentState: {
        model: "spark-2.5",
        effort: "low",
        thinking: false,
        mode: "chat",
      },
    }).toLowerCase();

    expect(prompt).not.toContain("deepseek");
    expect(prompt).not.toContain("provider model");
    expect(prompt).not.toContain("base url");
  });
});
