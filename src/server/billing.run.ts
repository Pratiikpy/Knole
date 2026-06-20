import "dotenv/config";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { billingConfigured, handleStripeWebhook, getBilling } from "./billing";
import { db, schema } from "../db";

// Proves the Stripe webhook trust boundary without any real Stripe account:
//   1. a VALID signature is accepted and flips entitlement (checkout.session.completed → plan=deep)
//   2. a TAMPERED signature is rejected (the security boundary — never mutates state)
//   3. customer.subscription.deleted downgrades the plan back to free
// Run: STRIPE_SECRET_KEY=sk_test_x STRIPE_WEBHOOK_SECRET=whsec_test DB_HTTP=1 npx tsx src/server/billing.run.ts

const { users } = schema;
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_x");

function signed(payload: string): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
}

async function main() {
  if (!billingConfigured()) {
    console.error("billingConfigured() is false — set STRIPE_SECRET_KEY + a price for this test");
    process.exit(1);
  }

  // A throwaway user to receive the entitlement changes.
  let [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyId, "eval-billing"))
    .limit(1);
  if (!u)
    [u] = await db
      .insert(users)
      .values({ privyId: "eval-billing", email: "bill@knole.local" })
      .returning({ id: users.id });
  const userId = u.id;
  await db
    .update(users)
    .set({ plan: "free", stripeCustomerId: "cus_test_eval", stripeSubscriptionId: null })
    .where(eq(users.id, userId));

  // 1) valid signature → checkout.session.completed → plan flips to "deep"
  const completed = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        object: "checkout.session",
        customer: "cus_test_eval",
        subscription: "sub_test_1",
        metadata: { knoleUserId: userId },
      },
    },
  });
  const res = await handleStripeWebhook(completed, signed(completed));
  const afterBuy = await getBilling(userId);
  const validOk = res.received && afterBuy.plan === "deep";

  // 2) tampered signature → rejected (throws), state unchanged
  let rejected = false;
  try {
    await handleStripeWebhook(completed, signed(completed).replace(/.$/, "0"));
  } catch {
    rejected = true;
  }

  // 3) subscription.deleted → plan back to "free"
  const deleted = JSON.stringify({
    id: "evt_2",
    object: "event",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test_1",
        object: "subscription",
        status: "canceled",
        customer: "cus_test_eval",
      },
    },
  });
  await handleStripeWebhook(deleted, signed(deleted));
  const afterCancel = await getBilling(userId);
  const downgraded = afterCancel.plan === "free";

  await db.delete(users).where(eq(users.id, userId));

  console.log(`valid-sig → plan=deep   : ${validOk ? "ok" : "FAIL"} (${afterBuy.plan})`);
  console.log(`tampered-sig → rejected : ${rejected ? "ok" : "FAIL"}`);
  console.log(`sub.deleted → plan=free : ${downgraded ? "ok" : "FAIL"} (${afterCancel.plan})`);
  const pass = validOk && rejected && downgraded;
  console.log("\n" + (pass ? "✅ BILLING WEBHOOK OK" : "❌ BILLING WEBHOOK FAILED"));
  process.exit(pass ? 0 : 1);
}

main();
