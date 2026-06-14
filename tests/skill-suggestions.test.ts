import { describe, expect, it } from "vitest";
import {
  buildSkillSuggestionPrompt,
  parseSuggestedSkillsOutput,
} from "@/lib/ai/skill-suggestions";

const candidates = [
  { slug: "drake-lyrics", name: "Drake Lyrics", description: "Write Drake-style lyrics." },
  { slug: "sonauto-prompt", name: "Sonauto Prompt", description: "Create Sonauto prompts." },
  { slug: "frontend-design", name: "Frontend Design" },
];

describe("skill suggestion parsing", () => {
  it("accepts multiple valid skills in order", () => {
    const out = JSON.stringify({
      skills: [
        { slug: "drake-lyrics", reason: "lyrics requested" },
        { slug: "sonauto-prompt", reason: "prompt requested" },
      ],
    });

    expect(parseSuggestedSkillsOutput(out, candidates)).toEqual([
      { slug: "drake-lyrics", name: "Drake Lyrics", reason: "lyrics requested" },
      { slug: "sonauto-prompt", name: "Sonauto Prompt", reason: "prompt requested" },
    ]);
  });

  it("filters duplicates, invalid slugs, and none", () => {
    const out = JSON.stringify({
      skills: [
        { slug: "not-real", reason: "bad" },
        { slug: "drake-lyrics", reason: "first" },
        { slug: "drake-lyrics", reason: "duplicate" },
        { slug: "none", reason: "none" },
      ],
    });

    expect(parseSuggestedSkillsOutput(out, candidates)).toEqual([
      { slug: "drake-lyrics", name: "Drake Lyrics", reason: "first" },
    ]);
  });

  it("keeps compatibility with the old one-skill response shape", () => {
    const out = `Sure: ${JSON.stringify({ slug: "sonauto-prompt", reason: "prompt format" })}`;

    expect(parseSuggestedSkillsOutput(out, candidates)).toEqual([
      { slug: "sonauto-prompt", name: "Sonauto Prompt", reason: "prompt format" },
    ]);
  });

  it("formats the generated ask for multiple skills", () => {
    expect(
      buildSkillSuggestionPrompt([
        { slug: "drake-lyrics", name: "Drake Lyrics", reason: "" },
        { slug: "sonauto-prompt", name: "Sonauto Prompt", reason: "" },
      ])
    ).toBe(
      "I think my response could be better if I use the Drake Lyrics and Sonauto Prompt skills. Should I go ahead and use them?"
    );
  });
});
