import { sql } from "drizzle-orm";
import { db } from "../db";

// Milestones — Presently's exact rule: the 5th and 10th entries, then every 25th. A permanent
// mark in the timeline and a one-time celebration at the moment of crossing; never a guilt
// mechanic, only an acknowledgment that the journal is becoming a body of work.

/** Presently's milestone predicate: n==5 || n==10 || n%25==0. */
export function isMilestone(n: number): boolean {
  return n === 5 || n === 10 || (n > 0 && n % 25 === 0);
}

/** This entry's ordinal position (1-based, oldest first) among the user's live entries, and
 * whether that position is a milestone. Used right after a save for the celebration moment. */
export async function entryMilestone(
  userId: string,
  entryId: string,
): Promise<{ ordinal: number; milestone: boolean } | null> {
  const rows = (await db.execute(sql`
    SELECT rn FROM (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
      FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
    ) t WHERE id = ${entryId}
  `)) as unknown as Record<string, unknown>[];
  if (!rows.length) return null;
  const ordinal = Number(rows[0].rn);
  return { ordinal, milestone: isMilestone(ordinal) };
}

/** The permanent timeline chips: every milestone ordinal the user has crossed, with the entry
 * that crossed it. Cheap (one window scan) and recomputed live, so a trashed entry re-numbers
 * honestly instead of leaving a stale badge. */
export async function milestoneChips(
  userId: string,
): Promise<{ entryId: string; ordinal: number }[]> {
  const rows = (await db.execute(sql`
    SELECT id, rn FROM (
      SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
      FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
    ) t WHERE rn IN (5, 10) OR rn % 25 = 0
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({ entryId: String(r.id), ordinal: Number(r.rn) }));
}
