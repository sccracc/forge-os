import { describe, expect, it, vi } from "vitest";
import { pollingSubscribe, setCache, getCache, invalidate } from "@/lib/data/realtime";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("realtime optimistic cache", () => {
  it("pushes setCache data to subscribers without refetching", async () => {
    const key = `test:${Math.random()}`;
    const fetcher = vi.fn(async () => [1]);
    const cb = vi.fn();
    const unsub = pollingSubscribe<number[]>(key, fetcher, cb, undefined, { pollMs: 10_000 });
    await tick();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith([1]);

    // Optimistic append — subscriber updates synchronously, no extra fetch.
    setCache<number[]>(key, (prev) => [...(prev ?? []), 2]);
    expect(cb).toHaveBeenLastCalledWith([1, 2]);
    expect(getCache<number[]>(key)).toEqual([1, 2]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("invalidate triggers a refetch", async () => {
    const key = `test:${Math.random()}`;
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const cb = vi.fn();
    const unsub = pollingSubscribe<number>(key, fetcher, cb, undefined, { pollMs: 10_000 });
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);

    invalidate(key);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(2);

    unsub();
  });

  it("re-subscription renders instantly from the cached value", async () => {
    const key = `test:${Math.random()}`;
    setCache<string>(key, "cached");
    const cb = vi.fn();
    const unsub = pollingSubscribe<string>(key, async () => "fresh", cb, undefined, { pollMs: 10_000 });

    // First call is the synchronous cached value (before the async fetch lands).
    expect(cb).toHaveBeenNthCalledWith(1, "cached");
    await tick();
    expect(cb).toHaveBeenLastCalledWith("fresh");

    unsub();
  });
});
