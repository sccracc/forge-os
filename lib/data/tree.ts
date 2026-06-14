import type { MessageDoc } from "./types";

export interface ThreadNode extends MessageDoc {
  /** Number of sibling branches sharing this node's parent. */
  siblings: number;
  /** This node's index among its siblings (0-based). */
  siblingIndex: number;
}

/**
 * Resolves the active conversation path from the message tree.
 * If activeLeafId is set, walks parent pointers from that leaf to the root.
 * Otherwise follows the most-recent child at each step. Pure + tested.
 */
export function buildActivePath(
  messages: MessageDoc[],
  activeLeafId?: string | null
): ThreadNode[] {
  if (messages.length === 0) return [];

  const byId = new Map<string, MessageDoc>();
  const children = new Map<string | null, MessageDoc[]>();
  for (const m of messages) {
    byId.set(m.id, m);
    const key = m.parentId ?? null;
    const arr = children.get(key) ?? [];
    arr.push(m);
    children.set(key, arr);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.createdAt - b.createdAt);

  const pathIds: string[] = [];
  if (activeLeafId && byId.has(activeLeafId)) {
    let cur: MessageDoc | undefined = byId.get(activeLeafId);
    while (cur) {
      pathIds.unshift(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  } else {
    const roots = children.get(null) ?? [];
    let node: MessageDoc | undefined = roots[roots.length - 1];
    while (node) {
      pathIds.push(node.id);
      const kids: MessageDoc[] = children.get(node.id) ?? [];
      node = kids[kids.length - 1];
    }
  }

  return pathIds.map((id) => {
    const m = byId.get(id)!;
    const sibs = children.get(m.parentId ?? null) ?? [];
    return {
      ...m,
      siblings: sibs.length,
      siblingIndex: sibs.findIndex((s) => s.id === id),
    };
  });
}

/** Follows the most-recent child from startId down to a leaf; returns its id. */
export function leafOf(messages: MessageDoc[], startId: string): string {
  const children = new Map<string | null, MessageDoc[]>();
  for (const m of messages) {
    const k = m.parentId ?? null;
    const a = children.get(k) ?? [];
    a.push(m);
    children.set(k, a);
  }
  for (const a of children.values()) a.sort((x, y) => x.createdAt - y.createdAt);
  let cur = startId;
  for (;;) {
    const kids: MessageDoc[] = children.get(cur) ?? [];
    if (kids.length === 0) return cur;
    cur = kids[kids.length - 1].id;
  }
}

/** Sibling messages sharing a parent, sorted by creation time. */
export function siblingsOf(
  messages: MessageDoc[],
  parentId: string | null
): MessageDoc[] {
  return messages
    .filter((m) => (m.parentId ?? null) === (parentId ?? null))
    .sort((a, b) => a.createdAt - b.createdAt);
}
