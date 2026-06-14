"use client";

// Realtime replacement for Firestore onSnapshot, fully server-backed.
//
// Each subscription: (1) fetches immediately, (2) refetches instantly when a
// matching key is `invalidate()`d — mutations do this on success, so the acting
// tab updates with no perceptible lag, exactly like onSnapshot — and (3) polls
// on a light interval for cross-device/tab freshness. Live streaming of
// assistant messages is handled separately by the stream store, so chat is
// unaffected.

// A listener called with data pushes that data straight to the subscriber (an
// optimistic cache write, no network). Called with no arg, it triggers a refetch.
type Listener = (data?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

// Last-known data per key. Lets mutations update subscribers synchronously
// (setCache) and lets re-subscriptions render instantly from cache.
const cacheStore = new Map<string, unknown>();

// Mutation epoch per key. A fetch that was already in flight when setCache ran
// would deliver a snapshot from BEFORE the mutation — overwriting the fresh
// optimistic data and making e.g. a just-persisted message blink out of the
// thread. Stale snapshots are discarded instead (the next poll reconciles).
const epochs = new Map<string, number>();

/** Tell every active subscriber on `key` to refetch now (call after a mutation). */
export function invalidate(key: string): void {
  const set = listeners.get(key);
  if (set) for (const l of Array.from(set)) l();
}

/** Invalidate several keys at once. */
export function invalidateAll(keys: string[]): void {
  for (const k of keys) invalidate(k);
}

/** Last cached value for `key`, if any subscription has loaded it. */
export function getCache<T>(key: string): T | undefined {
  return cacheStore.get(key) as T | undefined;
}

/**
 * Optimistically update a key's data and push it to every subscriber WITHOUT a
 * refetch. `updater` may be the next value or a function of the previous value.
 * Mutations call this so the acting tab updates instantly (no network gap) —
 * this is what makes the streaming→persisted handoff seamless (no "refresh").
 */
export function setCache<T>(key: string, updater: T | ((prev: T | undefined) => T)): void {
  const prev = cacheStore.get(key) as T | undefined;
  const next =
    typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater;
  if (next === undefined) return;
  cacheStore.set(key, next);
  epochs.set(key, (epochs.get(key) ?? 0) + 1);
  const set = listeners.get(key);
  if (set) for (const l of Array.from(set)) l(next);
}

const DEFAULT_POLL_MS = 10_000;

export function pollingSubscribe<T>(
  key: string,
  fetcher: () => Promise<T>,
  cb: (data: T) => void,
  onError?: (e: Error) => void,
  opts?: { pollMs?: number }
): () => void {
  let cancelled = false;
  let inFlight = false;

  const run = async () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    const epochAtStart = epochs.get(key) ?? 0;
    try {
      const data = await fetcher();
      // A mutation (setCache) landed while this fetch was in flight — the
      // response predates it. Drop it rather than rolling the UI back.
      if (!cancelled && (epochs.get(key) ?? 0) === epochAtStart) {
        cacheStore.set(key, data);
        cb(data);
      }
    } catch (e) {
      if (!cancelled) onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      inFlight = false;
    }
  };

  // With data → push it straight through (optimistic write). Without → refetch.
  const listener: Listener = (data) => {
    if (data !== undefined) {
      if (!cancelled) cb(data as T);
    } else {
      void run();
    }
  };
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  const cached = cacheStore.get(key);
  if (cached !== undefined) cb(cached as T); // instant render from cache
  void run(); // then refresh from server
  const interval = setInterval(() => void run(), opts?.pollMs ?? DEFAULT_POLL_MS);

  return () => {
    cancelled = true;
    clearInterval(interval);
    const s = listeners.get(key);
    if (s) {
      s.delete(listener);
      if (s.size === 0) listeners.delete(key);
    }
  };
}
