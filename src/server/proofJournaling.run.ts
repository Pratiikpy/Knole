import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import { computeStats, mintProof, latestProof } from "./proofJournaling";

// Integration test for proof-of-journaling (#11). Seeds entries across distinct days, checks the
// content-free stats + streak, then commits on 0G Chain and reads it back. Needs a funded 0G wallet.
//   DB_HTTP=1 npm run test:proof

const { users, entries } = schema;
const PRIVY_ID = "proof-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "proof-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

const backdate = (id: string, days: number) =>
  db.execute(
    sql`UPDATE entries SET created_at = now() - interval '${sql.raw(String(days))} days' WHERE id = ${id}`,
  );

try {
  // 3 consecutive days ending today, plus a duplicate day (distinct days must stay 3, entries = 4).
  for (const d of [0, 1, 2]) {
    const e = await saveEntry(userId, `Entry for day ${d}.`, undefined, "journal");
    await backdate(e.id, d);
  }
  const dup = await saveEntry(userId, "A second entry, same day.", undefined, "journal");
  await backdate(dup.id, 2);

  const stats = await computeStats(userId);
  if (stats.distinctDays !== 3) fail(`distinctDays should be 3, got ${stats.distinctDays}`);
  if (stats.entryCount !== 4) fail(`entryCount should be 4, got ${stats.entryCount}`);
  if (stats.currentStreak !== 3) fail(`streak should be 3, got ${stats.currentStreak}`);

  const t0 = Date.now();
  const proof = await mintProof(userId);
  if (!proof) fail("mintProof returned null");
  if (proof.distinctDays !== 3) fail("proof day count mismatch");
  if (!/^0x[0-9a-f]{64}$/i.test(proof.commitment)) fail(`bad commitment: ${proof.commitment}`);
  console.log(`anchored in ${Date.now() - t0}ms · tx ${proof.txHash}`);

  const latest = await latestProof(userId);
  if (latest?.txHash !== proof.txHash) fail("latestProof didn't return the fresh proof");

  console.log(`distinct days : ${stats.distinctDays} ✓`);
  console.log(`entries       : ${stats.entryCount} (distinct-day dedup ✓)`);
  console.log(`streak        : ${stats.currentStreak} ✓`);
  console.log(`commitment    : ${proof.commitment.slice(0, 22)}…`);
  console.log(`on-chain tx   : ${proof.txHash}`);
  console.log("✅ PROOF-OF-JOURNALING: content-free stats committed on 0G Chain, verifiable (#11)");

  await db.delete(users).where(eq(users.id, userId));
  void entries;
  process.exit(0);
} catch (e) {
  console.error("proof test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
