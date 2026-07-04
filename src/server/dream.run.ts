import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import { runDreaming } from "./dreaming";

// Integration test for Dreaming-in-TEE (#13). Seeds a user, runs the overnight dream through the 0G
// sealed path, and checks it produces an observation AND commits an on-chain-verifiable receipt.
//   OG_SEALED_INFERENCE=on NVIDIA_API_KEY= DB_HTTP=1 npm run test:dream

const { users, memories } = schema;
const PRIVY_ID = "dream-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "dream-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  await saveEntry(
    userId,
    "Kept pushing the deadline, snapped at my partner again tonight.",
    undefined,
    "journal",
  );
  await saveEntry(
    userId,
    "Went for a run and finally felt like myself for an hour.",
    undefined,
    "journal",
  );
  await saveEntry(
    userId,
    "Avoiding the hard conversation about money. Again.",
    undefined,
    "journal",
  );
  await db.insert(memories).values({
    userId,
    content: "You tend to withdraw when you're overwhelmed.",
    contentHash: `dream-test-${Date.now()}`,
    type: "pattern",
    status: "active",
  });

  const dream = await runDreaming(userId);
  if (!dream || !dream.observation) fail("dream produced no observation");
  if (/\[(PERSON|PLACE|ORG|MISC)_\d+\]/.test(dream.observation))
    fail("placeholder leaked into the dream");

  // A receipt must have been recorded for the sealed overnight computation.
  const [rc] = (await db.execute(sql`
    SELECT count(*)::int AS c FROM receipts WHERE user_id = ${userId}
  `)) as unknown as Record<string, unknown>[];
  if (Number(rc?.c ?? 0) < 1)
    fail("no receipt recorded for the dream (sealed computation not committed)");

  console.log(`observation : ${dream.observation.slice(0, 160)}…`);
  console.log(`receipt      : recorded ✓ (anchors on-chain via the worker, like #8)`);
  console.log(
    "✅ DREAMING-IN-TEE: overnight analysis ran sealed on 0G + committed a receipt (#13)",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("dream test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
