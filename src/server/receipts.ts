import { createHash } from "node:crypto";
import { sql, eq, and, isNull } from "drizzle-orm";
import { keccak256, concat } from "ethers";
import { db, schema } from "../db";
import { anchorOnChain } from "./og";
import { sealedActive } from "./sealed";

const { receipts } = schema;

// Reflection receipts (#8): "receipts, not promises" made literal. Every reflection is committed to a
// tamper-evident leaf hash; leaves are batched into a sorted-pair Merkle tree whose root is anchored on
// 0G Chain. Each receipt keeps its proof, so anyone can recompute the leaf, walk the proof to the
// anchored root, and open the tx on-chain — no trust required. The receipt stores only HASHES, never
// the private text, so it's safe to expose on a public verify page.

const MODEL = process.env.ZG_MODEL || process.env.NVIDIA_DEFAULT_MODEL || "model";
const sha256 = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");

/** The committed leaf for a reflection — deterministic, recomputable by anyone from the stored fields. */
export function leafFor(fields: {
  inputHash: string;
  outputHash: string;
  model: string;
  sealed: boolean;
  ts: string;
}): string {
  return keccak256(
    new TextEncoder().encode(
      `${fields.inputHash}|${fields.outputHash}|${fields.model}|${fields.sealed ? 1 : 0}|${fields.ts}`,
    ),
  );
}

// Sorted-pair keccak (OpenZeppelin-style) — order-independent, so verification needs no left/right bit.
// Exported so the tamper-evident memory-history anchor reuses the exact same Merkle construction.
export function hashPair(a: string, b: string): string {
  const [x, y] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([x, y]));
}

export function buildLayers(leaves: string[]): string[][] {
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const l = cur[i];
      const r = i + 1 < cur.length ? cur[i + 1] : cur[i]; // duplicate a lone leaf
      next.push(hashPair(l, r));
    }
    layers.push(next);
  }
  return layers;
}

export function proofFor(layers: string[][], index: number): string[] {
  const proof: string[] = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const sib = idx ^ 1;
    proof.push(sib < layer.length ? layer[sib] : layer[idx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Recompute a leaf up the proof and compare to the root — the whole verification, done anywhere. */
export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  let h = leaf;
  for (const s of proof) h = hashPair(h, s);
  return h.toLowerCase() === root.toLowerCase();
}

/** Commit a reflection to a receipt. Fire-and-forget from the reflection paths. Returns the id. */
export async function recordReceipt(
  userId: string,
  args: {
    entryId?: string | null;
    replyId?: string | null;
    input: string;
    output: string;
    /** The PER-RESPONSE attestation result. A fallback (non-TEE) reply must anchor sealed:false —
     * the config-level sealedActive() is only the default for paths that can't thread the flag. */
    sealed?: boolean;
    /** The model that ACTUALLY produced this response. Same reasoning as `sealed`: the env-level
     * ZG_MODEL is only a default for paths that cannot thread it. The receipt is the one place the
     * product says "no trust required, only math", so naming a model that did not write the answer
     * is the worst possible field to get wrong — and it was wrong for every reflection, since the
     * TEE serves deepseek-v4-flash while ZG_MODEL reads glm-5.1. */
    model?: string;
  },
): Promise<string | null> {
  if (!args.input || !args.output) return null;
  const ts = new Date();
  const inputHash = sha256(args.input);
  const outputHash = sha256(args.output);
  const sealed = args.sealed ?? sealedActive();
  const model = args.model || MODEL;
  const leafHash = leafFor({ inputHash, outputHash, model, sealed, ts: ts.toISOString() });
  const [row] = await db
    .insert(receipts)
    .values({
      userId,
      entryId: args.entryId ?? null,
      replyId: args.replyId ?? null,
      inputHash,
      outputHash,
      model,
      sealed,
      leafHash,
      createdAt: ts,
    })
    .returning({ id: receipts.id });
  return row?.id ?? null;
}

/**
 * Batch every un-anchored receipt for a user into one Merkle tree, anchor the root on 0G Chain, and
 * write each receipt's root + tx + proof. Idempotent-ish: only touches receipts with no root yet.
 */
export async function anchorReceiptsForUser(
  userId: string,
): Promise<{ root: string; txHash: string; count: number } | null> {
  const rows = await db
    .select({ id: receipts.id, leafHash: receipts.leafHash })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), isNull(receipts.anchoredRoot)))
    .orderBy(receipts.createdAt);
  if (!rows.length) return null;

  const leaves = rows.map((r) => r.leafHash);
  const layers = buildLayers(leaves);
  const root = layers[layers.length - 1][0];
  const txHash = await anchorOnChain(root);

  for (let i = 0; i < rows.length; i++) {
    await db
      .update(receipts)
      .set({ anchoredRoot: root, anchorTx: txHash, proof: proofFor(layers, i) })
      .where(eq(receipts.id, rows[i].id));
  }
  return { root, txHash, count: rows.length };
}

/** Anchor receipts for every user who has un-anchored ones. For the worker; bounded + isolated. */
export async function anchorReceiptsDue(
  opts: { start?: number; budgetMs?: number; limit?: number } = {},
): Promise<number> {
  const { start = Date.now(), budgetMs = Infinity, limit = 10 } = opts;
  const rows = (await db.execute(sql`
    SELECT DISTINCT user_id FROM receipts WHERE anchored_root IS NULL LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  let anchored = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      if (await anchorReceiptsForUser(String(r.user_id))) anchored++;
    } catch (e) {
      console.error(`anchorReceiptsDue: user=${r.user_id} failed:`, (e as Error).message);
    }
  }
  if (anchored) console.log(`anchorReceiptsDue: anchored receipts for ${anchored} user(s)`);
  return anchored;
}

export type ReceiptView = {
  id: string;
  leafHash: string;
  inputHash: string;
  outputHash: string;
  model: string;
  sealed: boolean;
  createdAt: string;
  anchoredRoot: string | null;
  anchorTx: string | null;
};

export type VerifyResult =
  | { found: false }
  | {
      found: true;
      anchored: boolean;
      valid: boolean; // leaf recomputes + proof walks to the anchored root
      receipt: ReceiptView;
    };

function toView(r: typeof receipts.$inferSelect): ReceiptView {
  return {
    id: r.id,
    leafHash: r.leafHash,
    inputHash: r.inputHash,
    outputHash: r.outputHash,
    model: r.model,
    sealed: r.sealed,
    createdAt: String(r.createdAt),
    anchoredRoot: r.anchoredRoot,
    anchorTx: r.anchorTx,
  };
}

/** Public verification: recompute the leaf from the stored fields and walk the proof to the root. */
export async function verifyReceipt(id: string): Promise<VerifyResult> {
  const [r] = await db.select().from(receipts).where(eq(receipts.id, id)).limit(1);
  if (!r) return { found: false };
  const recomputed = leafFor({
    inputHash: r.inputHash,
    outputHash: r.outputHash,
    model: r.model,
    sealed: r.sealed,
    ts: new Date(r.createdAt).toISOString(),
  });
  const leafOk = recomputed.toLowerCase() === r.leafHash.toLowerCase();
  const anchored = !!r.anchoredRoot && !!r.proof;
  const valid =
    leafOk && anchored ? verifyProof(r.leafHash, r.proof as string[], r.anchoredRoot!) : false;
  return { found: true, anchored, valid, receipt: toView(r) };
}

/** The latest receipt for an entry — powers the in-app "verify this reflection" affordance. */
export async function latestReceiptForEntry(
  userId: string,
  entryId: string,
): Promise<ReceiptView | null> {
  const [r] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.entryId, entryId)))
    .orderBy(sql`${receipts.createdAt} DESC`)
    .limit(1);
  return r ? toView(r) : null;
}
