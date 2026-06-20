import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getData } from "./og";
import { userKeyCandidates } from "./engine";

const { entries } = schema;

export type RestoredEntry = { entryId: string; text: string; savedAt?: string };

/** Pull one entry's canonical copy back from 0G Storage and decrypt it with the user's key. */
export async function restoreEntryFromChain(userId: string, kvRef: string): Promise<RestoredEntry> {
  // Ownership guard: only restore a root that belongs to this user's own entries. The AES-256-GCM auth
  // tag already stops reading another user's blob (a wrong key fails to decrypt), but this rejects a
  // foreign or forged root *before* any 0G fetch — defense-in-depth, not crypto as the sole gate.
  const owned = (await db.execute(sql`
    SELECT 1 FROM entries WHERE user_id = ${userId} AND kv_ref = ${kvRef} LIMIT 1
  `)) as unknown as unknown[];
  if (owned.length === 0) throw new Error("root not owned by this user");
  const bytes = await getData(kvRef, { keys: userKeyCandidates(userId) });
  const obj = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RestoredEntry>;
  // The blob is decrypted with the user's key; validate shape before trusting it.
  if (typeof obj?.text !== "string") throw new Error("restored 0G payload has an invalid shape");
  return obj as RestoredEntry;
}

/**
 * Rebuild every on-chain entry's text purely from 0G — the proof that the
 * Postgres copy is only a cache. Returns counts; restores text in place.
 */
export async function restoreAllFromChain(
  userId: string,
): Promise<{ total: number; restored: number; matched: number; failed: number }> {
  const rows = (await db.execute(sql`
    SELECT id, kv_ref, text FROM entries WHERE user_id = ${userId} AND kv_ref IS NOT NULL
  `)) as unknown as Record<string, unknown>[];

  let restored = 0;
  let matched = 0;
  let failed = 0;
  for (const r of rows) {
    const id = String(r.id);
    const kvRef = String(r.kv_ref);
    const before = String(r.text);
    try {
      const payload = await restoreEntryFromChain(userId, kvRef);
      await db.update(entries).set({ text: payload.text }).where(eq(entries.id, id));
      restored++;
      if (payload.text === before) matched++;
    } catch (e) {
      // A node may be transiently unreachable — but this also catches gcmDecrypt auth-tag failures
      // (a tampered blob or wrong key) and bad payloads, which are integrity signals, not skips.
      // Log + count so a corrupt/tampered blob is visible, not silently folded into "skipped".
      failed++;
      console.error(
        `restoreAllFromChain: entry=${id} root=${kvRef.slice(0, 18)}… failed:`,
        (e as Error).message,
      );
    }
  }
  return { total: rows.length, restored, matched, failed };
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
