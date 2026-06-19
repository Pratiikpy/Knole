import { getRequestIP } from "@tanstack/react-start/server";

// In-memory fixed-window limiter. Protects the expensive LLM endpoints from abuse /
// runaway cost. In-memory is fine for a single-instance deploy; a multi-instance
// deploy would back this with Redis (same interface).

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Returns true if the call is allowed under the window. Pure + deterministic. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

function clientKey(scope: string): string {
  let ip = "local";
  try {
    ip = getRequestIP({ xForwardedFor: true }) || "local";
  } catch {
    /* no request context (scripts/tests) */
  }
  return `${scope}:${ip}`;
}

/** Throttle an expensive endpoint by client IP; throws a friendly error when exceeded. */
export function enforceRate(scope: string, limit: number, windowMs: number): void {
  if (!allow(clientKey(scope), limit, windowMs)) {
    throw new Error("You're moving fast — give Knole a moment and try again.");
  }
}
