import { describe, expect, it } from "vitest";
import {
  buildActiveSkillTurnInstruction,
  withActiveSkillTurnInstruction,
} from "@/lib/ai/skill-execution";
import type { WireMessage } from "@/lib/ai/types";

const skills = [
  { name: "J. Cole Lyrics", instructions: "Write J. Cole-style lyrics." },
  { name: "Sonauto Prompt", instructions: "Create a model-ready Sonauto prompt." },
];

describe("active skill turn execution", () => {
  it("does not add a checklist for a single active skill", () => {
    expect(buildActiveSkillTurnInstruction([skills[0]])).toBeNull();
  });

  it("builds a hard checklist for every active skill", () => {
    const instruction = buildActiveSkillTurnInstruction(skills);

    expect(instruction).toContain("must satisfy every active skill");
    expect(instruction).toContain("J. Cole Lyrics");
    expect(instruction).toContain("Sonauto Prompt");
    expect(instruction).toContain("song/lyrics and a separate model-ready prompt");
  });

  it("appends the checklist to the latest user message without mutating history", () => {
    const messages: WireMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "make me a crazy good j cole song" },
    ];

    const out = withActiveSkillTurnInstruction(messages, skills);

    expect(messages[2].content).toBe("make me a crazy good j cole song");
    expect(out).not.toBe(messages);
    expect(out[0]).toEqual(messages[0]);
    expect(out[2].content).toContain("make me a crazy good j cole song");
    expect(out[2].content).toContain("Sonauto Prompt");
    expect(out[2].content).toContain("separate model-ready prompt");
  });
});
