import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "@/lib/ai/prompts";

const base = { effort: "low" as const, mode: "chat" as const, date: "Today" };

describe("skill injection into the system prompt", () => {
  it("injects an active skill's instructions verbatim", () => {
    const out = assembleSystemPrompt({
      ...base,
      skills: [{ name: "Haiku Writer", instructions: "Always write strict 5-7-5 haiku." }],
    });
    expect(out).toContain("Active Skills");
    expect(out).toContain("Haiku Writer");
    expect(out).toContain("Always write strict 5-7-5 haiku.");
  });

  it("omits the Active Skills section when no skills are active", () => {
    expect(assembleSystemPrompt(base)).not.toContain("Active Skills");
  });

  it("preserves activation order for multiple active skills", () => {
    const out = assembleSystemPrompt({
      ...base,
      skills: [
        { name: "First", instructions: "AAA-instruction" },
        { name: "Second", instructions: "BBB-instruction" },
      ],
    });
    expect(out.indexOf("AAA-instruction")).toBeLessThan(out.indexOf("BBB-instruction"));
  });

  it("requires every active skill to be fulfilled when multiple skills are active", () => {
    const out = assembleSystemPrompt({
      ...base,
      skills: [
        { name: "J. Cole Lyrics", instructions: "Write J. Cole-style lyrics only." },
        { name: "Sonauto Prompt", instructions: "Create a model-ready Sonauto prompt." },
      ],
    });

    expect(out).toContain("ACTIVE SKILL EXECUTION");
    expect(out).toContain("Apply every active skill");
    expect(out).toContain("lyrics/style skill plus a music-prompt skill");
    expect(out).toContain("supersedes single-skill");
  });

  it("always grants skill management (create/edit), independent of files/tools", () => {
    const out = assembleSystemPrompt(base);
    expect(out).toContain("SKILL MANAGEMENT");
    expect(out).toContain("forge-skill");
    expect(out.toLowerCase()).toContain("never refuse");
    expect(out.toLowerCase()).toContain("slug");
  });

  it("injects the skill catalog so the model can edit a skill by slug", () => {
    const out = assembleSystemPrompt({
      ...base,
      skillCatalog: [
        { name: "Spanish Responder", slug: "spanish-responder", description: "Reply in Spanish." },
      ],
    });
    expect(out).toContain("Your Skills");
    expect(out).toContain("/spanish-responder");
  });
});
