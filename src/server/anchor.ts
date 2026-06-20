import { sql, eq, and, isNotNull } from "drizzle-orm";
import { keccak256, toUtf8Bytes } from "ethers";
import { db, schema } from "../db";
import { anchorOnChain } from "./og";

const { entries, reflectionArtifacts } = schema;

/**
 * A deterministic commitment to the user's on-chain memory state: keccak256 over their entry roots,
 * sorted so it's order-independent. Changing, adding, or removing any on-chain entry changes the
 * root. (A flat commitment, not a Merkle tree — per-entry inclusion is already provable via each
 * entry's own 0G root; the daily anchor commits to the whole set.) Null if nothing's on 0G yet.
 */
export async function computeMemoryRoot(
  userId: string,
): Promise<{ root: string; count: number } | null> {
  const rows = (await db.execute(sql`
    SELECT kv_ref FROM entries WHERE user_id = ${userId} AND kv_ref IS NOT NULL ORDER BY kv_ref ASC
  `)) as unknown as Record<string, unknown>[];
  if (!rows.length) return null;
  const refs = rows.map((r) => String(r.kv_ref)).sort();
  return { root: keccak256(toUtf8Bytes(refs.join("|"))), count: refs.length };
}

export type Anchor = { root: string; txHash: string; count: number };

/**
 * Daily batched anchor: commit the user's whole memory root on-chain in one tx, idempotent per UTC
 * day (a cron retry or manual run won't double-anchor). Records the anchor (root + tx) and stamps
 * the covered entries with the root. Returns null if already anchored today or nothing's on 0G.
 */
export async function anchorMemoryRoot(userId: string): Promise<Anchor | null> {
  const done = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'anchor' AND created_at >= date_trunc('day', now())
    LIMIT 1
  `)) as unknown as unknown[];
  if (done[0]) return null;

  const mr = await computeMemoryRoot(userId);
  if (!mr) return null;

  const txHash = await anchorOnChain(mr.root);

  await db
    .update(entries)
    .set({ anchoredRoot: mr.root })
    .where(and(eq(entries.userId, userId), isNotNull(entries.kvRef)));
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "pattern",
    threadKey: "anchor",
    content: { root: mr.root, txHash, entryCount: mr.count },
    sources: {},
  });
  return { root: mr.root, txHash, count: mr.count };
}

/**
 * Anchor every user who's due — has on-chain entries but no anchor yet today. Bounded by a user
 * limit + time budget (each anchor is an on-chain tx, ~seconds); the rest catch up on later ticks
 * or via `npm run anchor:run`. Per-user errors are isolated. Returns how many were anchored.
 */
export async function anchorDue(
  opts: { start?: number; budgetMs?: number; limit?: number } = {},
): Promise<number> {
  const { start = Date.now(), budgetMs = Infinity, limit = 10 } = opts;
  const rows = (await db.execute(sql`
    SELECT DISTINCT e.user_id FROM entries e
    WHERE e.kv_ref IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reflection_artifacts ra
        WHERE ra.user_id = e.user_id AND ra.thread_key = 'anchor'
          AND ra.created_at >= date_trunc('day', now())
      )
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  let anchored = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      if (await anchorMemoryRoot(String(r.user_id))) anchored++;
    } catch (e) {
      console.error(`anchorDue: user=${r.user_id} failed:`, (e as Error).message);
    }
  }
  if (anchored) console.log(`anchorDue: anchored ${anchored} memory root(s) on-chain`);
  return anchored;
}

/** The user's latest on-chain anchor, for the ownership UI. */
export async function latestAnchor(userId: string): Promise<Anchor | null> {
  const rows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'anchor' ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return null;
  const c = rows[0].content as { root?: string; txHash?: string; entryCount?: number };
  return c?.root && c?.txHash ? { root: c.root, txHash: c.txHash, count: c.entryCount ?? 0 } : null;
}
