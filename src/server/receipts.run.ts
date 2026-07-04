import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { recordReceipt, anchorReceiptsForUser, verifyReceipt } from "./receipts";

// Integration test for reflection receipts (#8). Records receipts, anchors their Merkle root on 0G
// Chain (a real tx), verifies each recomputes + walks the proof to the anchored root, and proves a
// tampered receipt fails. On-demand (needs a funded 0G wallet):
//   DB_HTTP=1 npm run test:receipts

const { users } = schema;
const PRIVY_ID = "receipts-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "receipts-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = await recordReceipt(userId, {
      input: `Entry number ${i}: a real reflection input.`,
      output: `Reflection ${i}: reflecting your words back.`,
    });
    if (!id) fail(`recordReceipt ${i} returned null`);
    ids.push(id);
  }

  // Before anchoring: found, but not yet anchored → not valid (nothing to verify against).
  const pre = await verifyReceipt(ids[0]);
  if (!pre.found) fail("receipt not found pre-anchor");
  if (pre.found && (pre.anchored || pre.valid))
    fail("should not be anchored/valid before anchoring");

  // Anchor the batch on 0G Chain (real tx).
  const t0 = Date.now();
  const anchor = await anchorReceiptsForUser(userId);
  if (!anchor) fail("anchorReceiptsForUser returned null");
  if (anchor.count !== 3) fail(`expected 3 receipts anchored, got ${anchor.count}`);
  console.log(`anchored 3 receipts in ${Date.now() - t0}ms`);
  console.log(`  root: ${anchor.root}`);
  console.log(`  tx  : ${anchor.txHash}`);

  // Every receipt now verifies: leaf recomputes and the proof walks to the anchored root.
  for (const id of ids) {
    const v = await verifyReceipt(id);
    if (!v.found || !v.anchored) fail(`receipt ${id} not anchored after batch`);
    if (!v.valid) fail(`receipt ${id} did not verify against the anchored root`);
    if (v.found && v.receipt.anchoredRoot !== anchor.root) fail("receipt root mismatch");
  }
  console.log(`all 3 receipts verify against the on-chain root ✓`);

  // Tamper: alter a stored hash → the leaf no longer recomputes → verification fails.
  await db.execute(sql`UPDATE receipts SET input_hash = '0xdeadbeef' WHERE id = ${ids[0]}`);
  const tampered = await verifyReceipt(ids[0]);
  if (tampered.found && tampered.valid) fail("a tampered receipt must NOT verify");
  console.log(`tampered receipt correctly fails verification ✓`);

  console.log(
    "✅ RECEIPTS: recorded, Merkle-batched, anchored on 0G Chain, verifiable, tamper-evident (#8)",
  );
  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("receipts test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
