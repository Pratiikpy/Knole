import { getRequestIP, getRequest } from "@tanstack/react-start/server";
import { sql } from "drizzle-orm";
import { db } from "../db";

// Fixed-window limiter protecting the expensive LLM / chain / payment endpoints from abuse and
// runaway cost.
//
// The in-memory Map below is only the FAST PATH. On Vercel every instance has its own copy and
// each cold start begins empty, so on its own it enforces nothing under real load - the effective
// limit was (configured limit x number of live instances), reset whenever a new one spun up. The
// durable counter in Postgres is the one that actually holds; the map short-circuits obvious
// floods without a round-trip.

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
    // x-forwarded-for's LEFTMOST value is whatever the client sent - trivially rotated to get a
    // fresh bucket per request. Prefer the platform-set headers, which a client cannot forge, and
    // only fall back to XFF where no proxy identity exists (local dev).
    const req = getRequest();
    ip =
      req.headers.get("x-vercel-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      getRequestIP({ xForwardedFor: true }) ||
      "local";
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

/**
 * Durable sibling of enforceRate, for the endpoints where exceeding the limit costs real money
 * (inference, image generation, chain writes). Counts in Postgres so the limit survives cold
 * starts and holds across concurrent instances. Fails OPEN on a database error: a limiter outage
 * must never take journaling down.
 */
export async function enforceRateDurable(
  scope: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  // The in-memory check first: an obvious flood never reaches the database.
  if (!allow(clientKey(scope), limit, windowMs)) {
    throw new Error("You're moving fast — give Knole a moment and try again.");
  }
  const key = clientKey(scope);
  try {
    const rows = (await db.execute(sql`
      INSERT INTO rate_limits (bucket_key, count, reset_at)
      VALUES (${key}, 1, now() + (${windowMs} * interval '1 millisecond'))
      ON CONFLICT (bucket_key) DO UPDATE
        SET count = CASE
              WHEN rate_limits.reset_at <= now() THEN 1
              ELSE rate_limits.count + 1 END,
            reset_at = CASE
              WHEN rate_limits.reset_at <= now()
              THEN now() + (${windowMs} * interval '1 millisecond')
              ELSE rate_limits.reset_at END
      RETURNING count
    `)) as unknown as { count: number }[];
    if (Number(rows[0]?.count ?? 0) > limit) {
      throw new Error("You're moving fast — give Knole a moment and try again.");
    }
  } catch (e) {
    // Rethrow our own limit error; swallow infrastructure errors (fail open).
    if ((e as Error).message.startsWith("You're moving fast")) throw e;
    console.error("durable rate limit unavailable, allowing:", (e as Error).message);
  }
}

/** Drop expired buckets. Called from the nightly worker so the table cannot grow unbounded. */
export async function pruneRateLimits(): Promise<number> {
  const rows = (await db.execute(
    sql`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour' RETURNING bucket_key`,
  )) as unknown as unknown[];
  return rows.length;
}

/** Non-throwing IP-scoped allow check — for handlers that return a 429 rather than throw. */
export function allowByIp(scope: string, limit: number, windowMs: number): boolean {
  return allow(clientKey(scope), limit, windowMs);
}
