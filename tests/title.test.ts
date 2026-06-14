import { describe, expect, it } from "vitest";
import {
  buildChatTitlePrompt,
  CHAT_TITLE_EFFORT,
  CHAT_TITLE_MODEL,
  CHAT_TITLE_SYSTEM_PROMPT,
  CHAT_TITLE_THINKING,
  cleanChatTitle,
} from "@/lib/ai/title";

describe("chat title generation helpers", () => {
  it("pins title generation to Spark low effort with thinking off", () => {
    expect(CHAT_TITLE_MODEL).toBe("spark-2.5");
    expect(CHAT_TITLE_EFFORT).toBe("low");
    expect(CHAT_TITLE_THINKING).toBe(false);
  });

  it("asks for a few words using only the first user message", () => {
    expect(CHAT_TITLE_SYSTEM_PROMPT).toContain("3 to 6 words");
    expect(CHAT_TITLE_SYSTEM_PROMPT).toContain("user's first message");
    expect(buildChatTitlePrompt("  build me a chess app  ")).toBe(
      "First user message:\nbuild me a chess app"
    );
  });

  it("cleans noisy model output into a short saved title", () => {
    expect(cleanChatTitle('"Build A Chess App."\nExtra text')).toBe("Build A Chess App");
    expect(cleanChatTitle("one two three four five six seven eight")).toBe(
      "one two three four five six"
    );
    expect(cleanChatTitle("")).toBe("New chat");
  });
});
