import { describe, it, expect } from "vitest";
import { splitForCollapse, COLLAPSE_THRESHOLD, KEEP_RECENT } from "@/lib/ai/collapse";
import type { WireMessage } from "@/lib/ai/types";

const msgs = (n: number): WireMessage[] =>
  Array.from(
    { length: n },
    (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }) as WireMessage
  );

describe("splitForCollapse", () => {
  it("returns null at or below the threshold", () => {
    expect(splitForCollapse(msgs(COLLAPSE_THRESHOLD))).toBeNull();
    expect(splitForCollapse(msgs(3))).toBeNull();
  });

  it("keeps the most recent KEEP_RECENT verbatim and collapses the rest", () => {
    const s = splitForCollapse(msgs(14));
    expect(s).not.toBeNull();
    expect(s!.recent).toHaveLength(KEEP_RECENT);
    expect(s!.older).toHaveLength(14 - KEEP_RECENT);
    // recent is the tail, in order
    expect(s!.recent[0].content).toBe(`m${14 - KEEP_RECENT}`);
    expect(s!.recent[KEEP_RECENT - 1].content).toBe("m13");
  });
});
