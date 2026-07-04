import "dotenv/config";
import { eq } from "drizzle-orm";
import { ethers } from "ethers";
import { db, schema } from "../db";
import { claimOgPayment, treasuryInfo } from "./payWith0G";
import { getCredits } from "./billing";

// Integration test for pay-with-0G (Part 7C). Sends a REAL 0G transfer to the treasury, then verifies
// the on-chain claim credits the user, is idempotent, and rejects bad tx. Needs a funded 0G wallet.
//   DB_HTTP=1 npm run test:og-pay

const { users } = schema;
const PRIVY_ID = "ogpay-test-user";
const RPC = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const PK = process.env.EVM_PRIVATE_KEY ?? "";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "ogpay-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  const info = treasuryInfo();
  if (!info.configured) fail("pay-with-0G not configured (no treasury address)");
  if (!PK) fail("no EVM_PRIVATE_KEY to send a test transfer");

  const rate = BigInt(info.weiPerCredit);
  const value = rate * 5n; // should credit exactly 5

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  console.log(`sending ${ethers.formatEther(value)} 0G to treasury ${info.address}…`);
  const tx = await wallet.sendTransaction({ to: info.address, value });
  await tx.wait(1);
  console.log(`confirmed tx ${tx.hash}`);

  // Claim it.
  const r = await claimOgPayment(userId, tx.hash);
  if (!r.ok) fail(`claim failed: ${r.reason}`);
  if (r.credited !== 5) fail(`expected 5 credits, got ${r.credited}`);
  if ((await getCredits(userId)) !== 5) fail("balance should be 5 after claim");

  // Idempotent — the same tx can't be claimed twice.
  const again = await claimOgPayment(userId, tx.hash);
  if (again.ok || again.reason !== "already_claimed") fail("double-claim must be rejected");

  // A non-existent tx is rejected.
  const bogus = await claimOgPayment(userId, "0x" + "ab".repeat(32));
  if (bogus.ok) fail("a bogus tx must not credit");

  console.log(`claim         : +${r.credited} credits ✓`);
  console.log(`balance       : ${await getCredits(userId)} ✓`);
  console.log(`double-claim  : rejected (${again.reason}) ✓`);
  console.log(`bogus tx      : rejected (${bogus.reason}) ✓`);
  console.log("✅ PAY-WITH-0G: on-chain transfer verified + credited, idempotent (Part 7C)");

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("og-pay test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
