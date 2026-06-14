import { describe, it, expect } from "vitest";
import { detectCreatorIntent } from "@/lib/ai/intent";

describe("detectCreatorIntent", () => {
  it("detects skill creation/editing", () => {
    expect(detectCreatorIntent("create a skill that writes haikus")).toBe("skill");
    expect(detectCreatorIntent("make me a new skill for tweets")).toBe("skill");
    expect(detectCreatorIntent("can you build a skill to summarize PDFs?")).toBe("skill");
    expect(detectCreatorIntent("update this skill to also translate")).toBe("skill");
    expect(detectCreatorIntent("rename the skill to Tweet Writer")).toBe("skill");
  });

  it("detects agent creation/editing", () => {
    expect(detectCreatorIntent("create an agent that acts as a copy editor")).toBe("agent");
    expect(detectCreatorIntent("make a new agent for frontend work")).toBe("agent");
    expect(detectCreatorIntent("design an agent persona for research")).toBe("agent");
    expect(detectCreatorIntent("rename my research agent")).toBe("agent");
  });

  it("prefers agent when both nouns appear", () => {
    expect(detectCreatorIntent("create an agent that bundles my writing skills")).toBe("agent");
  });

  it("returns null for ordinary messages", () => {
    expect(detectCreatorIntent("what's the capital of France?")).toBeNull();
    expect(detectCreatorIntent("help me debug this function")).toBeNull();
    expect(detectCreatorIntent("write a poem about the sea")).toBeNull();
    expect(detectCreatorIntent("")).toBeNull();
  });

  it("does not fire on 'skill tree' / 'skill set'", () => {
    expect(detectCreatorIntent("design a skill tree for my RPG")).toBeNull();
    expect(detectCreatorIntent("build a skill set for the character")).toBeNull();
  });
});
