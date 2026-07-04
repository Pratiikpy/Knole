import { sql, eq, and } from "drizzle-orm";
import { keccak256, toUtf8Bytes } from "ethers";
import { db, schema } from "../db";
import { anchorOnChain } from "./og";
import { buildLayers, proofFor, verifyProof } from "./receipts";

const { memoryHistory } = schema;

// Tamper-evident recall (#12) — the memory audit trail (memory_history is append-only) is Merkle-
// batched and its root anchored on 0G Chain. Anyone can recompute a history entry's leaf and walk the
// proof to the anchored root; if a row is later altered, the leaf no longer matches. This is the fix
// for the "untrustable recall" that sank Mem — your memory has a provable, unfalsifiable history.

type HistRow = {
  id: string;
  memory_id: string;
  operation: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
};

/** The committed leaf for a history event — deterministic and recomputable from the stored fields. */
export function leafForHistory(r: {
  id: string;
  memoryId: string;
  operation: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}): string {
  // createdAt MUST already be a canonical UTC string (see TS_UTC) — never re-parsed through Date here,
  // so the leaf is identical whether computed at anchor time or verify time.
  return keccak256(
    toUtf8Bytes(
      `${r.id}|${r.memoryId}|${r.operation}|${JSON.stringify(r.oldValue ?? null)}|${JSON.stringify(
        r.newValue ?? null,
      )}|${r.createdAt}`,
    ),
  );
}

// A stable UTC timestamp string, formatted in SQL so both anchor + verify see the exact same bytes.
const TS_UTC = sql.raw(`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Batch a user's un-anchored history events into a Merkle tree and anchor the root on 0G Chain. */
export async function anchorMemoryHistory(
  userId: string,
): Promise<{ root: string; txHash: string; count: number } | null> {
  const rows = (await db.execute(sql`
    SELECT id, memory_id, operation, old_value, new_value, ${TS_UTC} AS created_at
    FROM memory_history
    WHERE user_id = ${userId} AND anchored_root IS NULL
    ORDER BY created_at ASC
  `)) as unknown as HistRow[];
  if (!rows.length) return null;

  const leaves = rows.map((r) =>
    leafForHistory({
      id: r.id,
      memoryId: r.memory_id,
      operation: r.operation,
      oldValue: r.old_value,
      newValue: r.new_value,
      createdAt: r.created_at,
    }),
  );
  const layers = buildLayers(leaves);
  const root = layers[layers.length - 1][0];
  const txHash = await anchorOnChain(root);

  for (let i = 0; i < rows.length; i++) {
    await db
      .update(memoryHistory)
      .set({
        leafHash: leaves[i],
        anchoredRoot: root,
        anchorTx: txHash,
        proof: proofFor(layers, i),
      })
      .where(eq(memoryHistory.id, rows[i].id));
  }
  return { root, txHash, count: rows.length };
}

/** Anchor every user with un-anchored history — for the worker; bounded + isolated. */
export async function anchorHistoryDue(
  opts: { start?: number; budgetMs?: number; limit?: number } = {},
): Promise<number> {
  const { start = Date.now(), budgetMs = Infinity, limit = 10 } = opts;
  const rows = (await db.execute(sql`
    SELECT DISTINCT user_id FROM memory_history WHERE anchored_root IS NULL LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  let anchored = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      if (await anchorMemoryHistory(String(r.user_id))) anchored++;
    } catch (e) {
      console.error(`anchorHistoryDue: user=${r.user_id} failed:`, (e as Error).message);
    }
  }
  return anchored;
}

export type HistoryVerify =
  | { found: false }
  | {
      found: true;
      anchored: boolean;
      valid: boolean;
      operation: string;
      createdAt: string;
      leafHash: string | null;
      anchoredRoot: string | null;
      anchorTx: string | null;
    };

/** Recompute a history entry's leaf and walk its proof to the anchored root. */
export async function verifyHistoryEntry(id: string): Promise<HistoryVerify> {
  const [r] = (await db.execute(sql`
    SELECT id, memory_id, operation, old_value, new_value, ${TS_UTC} AS created_at,
           leaf_hash, anchored_root, anchor_tx, proof
    FROM memory_history WHERE id = ${id} LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!r) return { found: false };
  const recomputed = leafForHistory({
    id: String(r.id),
    memoryId: String(r.memory_id),
    operation: String(r.operation),
    oldValue: r.old_value,
    newValue: r.new_value,
    createdAt: String(r.created_at),
  });
  const leafHash = r.leaf_hash == null ? null : String(r.leaf_hash);
  const anchoredRoot = r.anchored_root == null ? null : String(r.anchored_root);
  const proof = (r.proof as string[] | null) ?? null;
  const leafOk = !!leafHash && recomputed.toLowerCase() === leafHash.toLowerCase();
  const anchored = !!anchoredRoot && !!proof;
  const valid = leafOk && anchored ? verifyProof(leafHash!, proof!, anchoredRoot!) : false;
  return {
    found: true,
    anchored,
    valid,
    operation: String(r.operation),
    createdAt: String(r.created_at),
    leafHash,
    anchoredRoot,
    anchorTx: r.anchor_tx == null ? null : String(r.anchor_tx),
  };
}

/** A memory's full anchored audit trail — for the "verified history" view in the Index. */
export async function memoryAuditTrail(
  userId: string,
  memoryId: string,
): Promise<
  { id: string; operation: string; createdAt: string; anchored: boolean; anchorTx: string | null }[]
> {
  const rows = await db
    .select()
    .from(memoryHistory)
    .where(and(eq(memoryHistory.userId, userId), eq(memoryHistory.memoryId, memoryId)))
    .orderBy(memoryHistory.createdAt);
  return rows.map((r) => ({
    id: r.id,
    operation: r.operation,
    createdAt: String(r.createdAt),
    anchored: !!r.anchoredRoot,
    anchorTx: r.anchorTx,
  }));
}
