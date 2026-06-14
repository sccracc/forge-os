import { describe, it, expect } from "vitest";
import { toProviderMessages } from "@/lib/ai/provider";
import type { WireMessage } from "@/lib/ai/types";

describe("provider message assembly (§3.5/§9 reasoning replay)", () => {
  it("prepends the system prompt", () => {
    const out = toProviderMessages("SYS", [{ role: "user", content: "hi" }]);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("replays reasoning_content only for tool-call turns", () => {
    const msgs: WireMessage[] = [
      { role: "assistant", content: "answered after tool", reasoningContent: "R1", hadToolCall: true },
      { role: "assistant", content: "plain answer", reasoningContent: "R2" },
    ];
    const out = toProviderMessages("SYS", msgs);
    // tool-call turn → reasoning replayed
    expect(out[1].reasoning_content).toBe("R1");
    // non-tool turn → reasoning dropped (avoids provider 400)
    expect(out[2].reasoning_content).toBeUndefined();
  });

  it("never emits provider model identifiers in assembled messages", () => {
    const out = toProviderMessages("SYS", [{ role: "user", content: "hi" }]);
    expect(JSON.stringify(out).toLowerCase()).not.toContain("deepseek");
  });
});
