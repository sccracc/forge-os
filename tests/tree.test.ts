import { describe, it, expect } from "vitest";
import { buildActivePath, leafOf, siblingsOf } from "@/lib/data/tree";
import type { MessageDoc, Role } from "@/lib/data/types";

function m(id: string, parentId: string | null, role: Role, createdAt: number): MessageDoc {
  return { id, parentId, role, content: id, createdAt };
}

// Tree: u1 → (a1 | a2); a2 → u2 → a3   (a2 is a regenerated branch of u1)
const u1 = m("u1", null, "user", 1);
const a1 = m("a1", "u1", "assistant", 2);
const a2 = m("a2", "u1", "assistant", 3);
const u2 = m("u2", "a2", "user", 4);
const a3 = m("a3", "u2", "assistant", 5);
const all = [u1, a1, a2, u2, a3];

describe("message tree", () => {
  it("returns empty for no messages", () => {
    expect(buildActivePath([])).toEqual([]);
  });

  it("walks a linear path", () => {
    expect(buildActivePath([u1, a1]).map((n) => n.id)).toEqual(["u1", "a1"]);
  });

  it("selects the active branch via activeLeafId", () => {
    expect(buildActivePath(all, "a3").map((n) => n.id)).toEqual([
      "u1",
      "a2",
      "u2",
      "a3",
    ]);
  });

  it("selects the alternative branch when its leaf is active", () => {
    expect(buildActivePath(all, "a1").map((n) => n.id)).toEqual(["u1", "a1"]);
  });

  it("computes sibling counts on branched nodes", () => {
    const path = buildActivePath(all, "a3");
    const node = path.find((n) => n.id === "a2")!;
    expect(node.siblings).toBe(2);
    expect(node.siblingIndex).toBe(1);
  });

  it("default path (no leaf) follows the most recent child", () => {
    expect(buildActivePath(all).map((n) => n.id)).toEqual(["u1", "a2", "u2", "a3"]);
  });

  it("leafOf descends to the deepest latest node", () => {
    expect(leafOf(all, "u1")).toBe("a3");
    expect(leafOf(all, "a1")).toBe("a1");
  });

  it("siblingsOf returns ordered siblings", () => {
    expect(siblingsOf(all, "u1").map((s) => s.id)).toEqual(["a1", "a2"]);
  });
});
