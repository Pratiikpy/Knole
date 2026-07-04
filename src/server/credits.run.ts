import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  billingConfigured,
  getBilling,
  addCredits,
  deductCredits,
  getCredits,
  createCreditCheckout,
} from "./billing";

// Integration test for pay-as-you-go credits (Part 7C). Ledger ops against the DB + a real test-mode
// Stripe checkout session. Needs STRIPE_SECRET_KEY (test) in .env. `DB_HTTP=1 npm run test:credits`.

const { users } = schema;
const PRIVY_ID = "credits-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "credits-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  // Fresh balance.
  const b0 = await getBilling(userId);
  if (b0.credits !== 0 || b0.plan !== "free")
    fail(`fresh user should be free/0, got ${JSON.stringify(b0)}`);

  // Add + spend + guard against overspend (atomic).
  await addCredits(userId, 20);
  if ((await getCredits(userId)) !== 20) fail("addCredits didn't apply");
  if (!(await deductCredits(userId, 5))) fail("deduct of 5 from 20 should succeed");
  if ((await getCredits(userId)) !== 15) fail("balance should be 15 after spending 5");
  if (await deductCredits(userId, 100)) fail("overspend must be rejected");
  if ((await getCredits(userId)) !== 15) fail("rejected overspend must not change the balance");

  console.log(`ledger        : 0 → +20 → -5 = 15 · overspend rejected ✓`);

  // Real test-mode Stripe checkout for a credit pack (only if the secret key is present).
  if (billingConfigured() || process.env.STRIPE_SECRET_KEY) {
    const url = await createCreditCheckout(userId, "small");
    if (!/^https:\/\/checkout\.stripe\.com|^https:\/\/[a-z0-9.-]*stripe\.com/.test(url))
      fail(`unexpected checkout url: ${url.slice(0, 60)}`);
    console.log(`stripe checkout: ${url.slice(0, 48)}… ✓ (test mode)`);
  } else {
    console.log(`stripe checkout: skipped (no STRIPE_SECRET_KEY)`);
  }

  console.log(
    "✅ CREDITS: ledger add/spend/guard + one-time Stripe credit-pack checkout (Part 7C)",
  );
  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("credits test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
