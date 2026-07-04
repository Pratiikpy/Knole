import { sql } from "drizzle-orm";
import { keccak256, toUtf8Bytes } from "ethers";
import { db, schema } from "../db";
import { anchorOnChain } from "./og";

const { reflectionArtifacts } = schema;
const KEY = "proof-journaling";

// Proof-of-journaling (#11) — a provable habit you can show, privately. The consistency count (distinct
// days, streak) is derived from entry DATES only — never content — and committed on-chain as a
// timestamped, tamper-evident commitment. It proves "at this time, this many days were journaled"
// without revealing a single word. (A timestamped commitment, not a ZK proof — honest about that.)

export type JournalStats = {
  distinctDays: number;
  entryCount: number;
  currentStreak: number;
  firstDay: string | null;
};

export type Proof = {
  distinctDays: number;
  commitment: string;
  txHash: string;
  asOf: string;
};

/** Consistency stats from entry dates only — no content is read. */
export async function computeStats(userId: string): Promise<JournalStats> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS d
    FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ORDER BY d DESC
  `)) as unknown as Record<string, unknown>[];
  const days = rows.map((r) => String(r.d));
  const [cnt] = (await db.execute(sql`
    SELECT count(*)::int AS c FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
  `)) as unknown as Record<string, unknown>[];

  // Streak: consecutive days ending today or yesterday (missing today doesn't break a live streak).
  let streak = 0;
  if (days.length) {
    const oneDay = 86_400_000;
    const today = Math.floor(Date.now() / oneDay);
    const dayNum = (s: string) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / oneDay);
    let expected = dayNum(days[0]);
    if (today - expected <= 1) {
      for (const d of days) {
        if (dayNum(d) === expected) {
          streak++;
          expected -= 1;
        } else if (dayNum(d) < expected) {
          break;
        }
      }
    }
  }

  return {
    distinctDays: days.length,
    entryCount: Number(cnt?.c ?? 0),
    currentStreak: streak,
    firstDay: days.length ? days[days.length - 1] : null,
  };
}

/** Commit the current consistency count on 0G Chain — content-free, timestamped, tamper-evident. */
export async function mintProof(userId: string): Promise<Proof | null> {
  const stats = await computeStats(userId);
  if (stats.distinctDays < 1) return null;
  const asOf = new Date().toISOString().slice(0, 10);
  const commitment = keccak256(
    toUtf8Bytes(`${userId}|${stats.distinctDays}|${stats.currentStreak}|${asOf}`),
  );
  const txHash = await anchorOnChain(commitment);
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "state",
    threadKey: KEY,
    content: {
      distinctDays: stats.distinctDays,
      streak: stats.currentStreak,
      commitment,
      txHash,
      asOf,
    },
    sources: {},
  });
  return { distinctDays: stats.distinctDays, commitment, txHash, asOf };
}

/** The latest on-chain proof, if any — for the shareable claim + verify link. */
export async function latestProof(userId: string): Promise<Proof | null> {
  const [row] = (await db.execute(sql`
    SELECT content FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = ${KEY}
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!row) return null;
  const c = row.content as {
    distinctDays?: number;
    commitment?: string;
    txHash?: string;
    asOf?: string;
  };
  return c?.txHash && c?.commitment
    ? {
        distinctDays: c.distinctDays ?? 0,
        commitment: c.commitment,
        txHash: c.txHash,
        asOf: c.asOf ?? "",
      }
    : null;
}
