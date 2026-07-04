import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { anchorMemoryHistory, verifyHistoryEntry } from "./tamperEvident";

// Integration test for tamper-evident recall (#12). Seeds memory-history events, anchors their Merkle
// root on 0G Chain, verifies each, and proves a tampered row fails. Needs a funded 0G wallet.
//   DB_HTTP=1 npm run test:tamper

const { users, memoryHistory } = schema;
const PRIVY_ID = "tamper-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "tamper-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  const memoryId = randomUUID();
  const events = [
    { operation: "created", oldValue: null, newValue: { content: "You run every morning." } },
    {
      operation: "updated",
      oldValue: { content: "You run every morning." },
      newValue: { content: "You run most mornings." },
    },
    {
      operation: "superseded",
      oldValue: { content: "You run most mornings." },
      newValue: { by: randomUUID() },
    },
  ];
  const ids: string[] = [];
  for (const e of events) {
    const [row] = await db
      .insert(memoryHistory)
      .values({
        memoryId,
        userId,
        operation: e.operation,
        oldValue: e.oldValue,
        newValue: e.newValue,
        actor: "user",
      })
      .returning({ id: memoryHistory.id });
    ids.push(row.id);
  }

  const t0 = Date.now();
  const anchor = await anchorMemoryHistory(userId);
  if (!anchor) fail("anchorMemoryHistory returned null");
  if (anchor.count !== 3) fail(`expected 3 events anchored, got ${anchor.count}`);
  console.log(`anchored 3 history events in ${Date.now() - t0}ms · tx ${anchor.txHash}`);

  for (const id of ids) {
    const v = await verifyHistoryEntry(id);
    if (!v.found || !v.anchored) fail(`history ${id} not anchored`);
    if (!v.valid) fail(`history ${id} did not verify against the anchored root`);
  }
  console.log("all 3 history events verify against the on-chain root ✓");

  // Tamper: change a stored field → the leaf no longer recomputes → verification fails.
  await db.execute(sql`UPDATE memory_history SET operation = 'forged' WHERE id = ${ids[0]}`);
  const tampered = await verifyHistoryEntry(ids[0]);
  if (tampered.found && tampered.valid) fail("a tampered history row must NOT verify");
  console.log("tampered history row correctly fails verification ✓");

  console.log("✅ TAMPER-EVIDENT RECALL: memory history Merkle-anchored on 0G, verifiable (#12)");
  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("tamper test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
