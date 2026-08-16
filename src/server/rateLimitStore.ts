import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * The DURABLE half of the rate limiter, deliberately free of any request-scoped import.
 *
 * rateLimit.ts imports @tanstack/react-start/server to read the client IP, which drags TanStack
 * Start's virtual entry modules into anything that imports it. The nightly worker is bundled
 * standalone with esbuild, so importing the limiter from there broke the worker build outright
 * ("Could not resolve #tanstack-router-entry"). Keeping the storage layer separate lets both the
 * request path and the worker use it.
 */

/** Count one hit in a fixed window. Returns the running count for this bucket. */
export async function bumpBucket(key: string, windowMs: number): Promise<number> {
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
  return Number(rows[0]?.count ?? 0);
}

/** Drop expired buckets so the table cannot grow unbounded. */
export async function pruneRateLimits(): Promise<number> {
  const rows = (await db.execute(
    sql`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour' RETURNING bucket_key`,
  )) as unknown as unknown[];
  return rows.length;
}
