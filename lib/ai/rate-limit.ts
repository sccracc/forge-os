import "server-only";

// Quiet, server-side request cap to protect the API bill (§15). Not surfaced
// as a user-facing limit. In-memory rolling window keyed by uid.
//
// FORGE-NOTE: in-memory state is per-instance. The seam for a durable,
// multi-instance limiter (Firestore counter / Upstash) is this module's
// signature — swap the body without touching callers.

const WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();

export function checkRateLimit(uid: string): boolean {
  const limit = parseInt(process.env.FORGE_RATE_LIMIT_PER_WINDOW || "0", 10);
  if (!Number.isFinite(limit) || limit <= 0) return true; // unset = disabled

  const now = Date.now();
  const recent = (buckets.get(uid) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    buckets.set(uid, recent);
    return false;
  }
  recent.push(now);
  buckets.set(uid, recent);
  return true;
}
