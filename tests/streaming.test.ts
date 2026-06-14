import { describe, it, expect, beforeEach } from "vitest";
import { useStreamStore } from "@/lib/store/stream-store";
import { encodeEvent } from "@/lib/ai/types";

describe("streaming reasoning pipeline", () => {
  beforeEach(() => useStreamStore.setState({ byConv: {} }));

  it("reasoning events carry their text intact through encode", () => {
    const parsed = JSON.parse(encodeEvent({ t: "reasoning", d: "step one" }));
    expect(parsed).toEqual({ t: "reasoning", d: "step one" });
  });

  it("accumulates reasoning text and preserves it once the answer begins", () => {
    const s = useStreamStore.getState();
    s.start({
      conversationId: "c1",
      userMessageId: "u1",
      userMessageParentId: null,
      content: "",
      reasoning: "",
      phase: "reasoning",
      reasoningStart: Date.now() - 10,
      model: "magnum-2.8",
      effort: "high",
      thinking: true,
    });
    s.appendReasoning("c1", "Thinking ");
    s.appendReasoning("c1", "hard.");
    expect(useStreamStore.getState().byConv["c1"]!.reasoning).toBe("Thinking hard.");

    s.appendContent("c1", "Answer");
    const st = useStreamStore.getState().byConv["c1"]!;
    expect(st.phase).toBe("streaming"); // flips on first content
    expect(st.reasoning).toBe("Thinking hard."); // reasoning is NOT discarded
    expect(st.content).toBe("Answer");
    expect(st.reasoningMs).toBeGreaterThanOrEqual(0); // duration captured at the flip
  });
});
