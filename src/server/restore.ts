import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getData } from "./og";
import { keyForUser } from "./engine";

const { entries } = schema;

export type RestoredEntry = { entryId: string; text: string; savedAt?: string };

/** Pull one entry's canonical copy back from 0G Storage and decrypt it with the user's key. */
export async function restoreEntryFromChain(userId: string, kvRef: string): Promise<RestoredEntry> {
  const bytes = await getData(kvRef, { key: keyForUser(userId) });
  return JSON.parse(new TextDecoder().decode(bytes)) as RestoredEntry;
}

/**
 * Rebuild every on-chain entry's text purely from 0G — the proof that the
 * Postgres copy is only a cache. Returns counts; restores text in place.
 */
export async function restoreAllFromChain(
  userId: string,
): Promise<{ total: number; restored: number; matched: number }> {
  const rows = (await db.execute(sql`
    SELECT id, kv_ref, text FROM entries WHERE user_id = ${userId} AND kv_ref IS NOT NULL
  `)) as unknown as Record<string, unknown>[];

  let restored = 0;
  let matched = 0;
  for (const r of rows) {
    const id = String(r.id);
    const kvRef = String(r.kv_ref);
    const before = String(r.text);
    try {
      const payload = await restoreEntryFromChain(userId, kvRef);
      await db.update(entries).set({ text: payload.text }).where(eq(entries.id, id));
      restored++;
      if (payload.text === before) matched++;
    } catch {
      // node unreachable for this root — skip, leave cache as-is
    }
  }
  return { total: rows.length, restored, matched };
}

/** Read-only ownership summary for the UI: how much of the user's life is on 0G. */
export async function ownershipSummary(
  userId: string,
): Promise<{ totalEntries: number; onChain: number; roots: { id: string; root: string }[] }> {
  const stat = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM entries WHERE user_id = ${userId}) AS total,
      (SELECT count(*) FROM entries WHERE user_id = ${userId} AND kv_ref IS NOT NULL) AS onchain
  `)) as unknown as Record<string, unknown>[];
  const recent = (await db.execute(sql`
    SELECT id, kv_ref FROM entries
    WHERE user_id = ${userId} AND kv_ref IS NOT NULL
    ORDER BY created_at DESC LIMIT 8
  `)) as unknown as Record<string, unknown>[];
  return {
    totalEntries: Number(stat[0]?.total ?? 0),
    onChain: Number(stat[0]?.onchain ?? 0),
    roots: recent.map((r) => ({ id: String(r.id), root: String(r.kv_ref) })),
  };
}
