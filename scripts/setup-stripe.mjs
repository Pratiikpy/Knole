import "dotenv/config";
import Stripe from "stripe";
import fs from "node:fs";

// One-shot Stripe setup: creates the "Knole Deeper" product, its monthly + yearly recurring prices,
// and the webhook endpoint the app listens on — then writes STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY
// / STRIPE_WEBHOOK_SECRET into .env. Idempotent (reuses the product + matching prices on re-run) and
// refuses to run against a live key. The amounts match the /upgrade copy ($9/mo, $84/yr).
const KEY = process.env.STRIPE_SECRET_KEY ?? "";
if (!KEY.startsWith("sk_test_")) {
  console.error("Refusing: STRIPE_SECRET_KEY is not a test key (sk_test_…). No resources created.");
  process.exit(1);
}
const stripe = new Stripe(KEY);
const WEBHOOK_URL = "https://www.knole.me/stripe/webhook";
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

// Product
const products = (await stripe.products.list({ limit: 100 })).data;
let product = products.find((p) => p.name === "Knole Deeper" && p.active);
if (!product) {
  product = await stripe.products.create({
    name: "Knole Deeper",
    description: "Longer memory, deeper reflection.",
  });
  console.log("created product", product.id);
} else console.log("reusing product", product.id);

// Prices ($9/mo, $84/yr)
const prices = (await stripe.prices.list({ product: product.id, limit: 100 })).data;
const findPrice = (interval, amount) =>
  prices.find(
    (p) =>
      p.active &&
      p.currency === "usd" &&
      p.unit_amount === amount &&
      p.recurring?.interval === interval,
  );
let monthly = findPrice("month", 900);
if (!monthly)
  monthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 900,
    currency: "usd",
    recurring: { interval: "month" },
  });
let yearly = findPrice("year", 8400);
if (!yearly)
  yearly = await stripe.prices.create({
    product: product.id,
    unit_amount: 8400,
    currency: "usd",
    recurring: { interval: "year" },
  });
console.log("monthly", monthly.id, "· yearly", yearly.id);

// Webhook — recreate any endpoint for our exact URL so we capture a fresh signing secret.
const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter(
  (w) => w.url === WEBHOOK_URL,
);
for (const w of existing) {
  await stripe.webhookEndpoints.del(w.id);
  console.log("removed old webhook", w.id);
}
const wh = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: EVENTS });
console.log("created webhook", wh.id);

const out = {
  STRIPE_PRICE_MONTHLY: monthly.id,
  STRIPE_PRICE_YEARLY: yearly.id,
  STRIPE_WEBHOOK_SECRET: wh.secret,
};

// Write into .env (replace existing keys, else append).
let env = fs.readFileSync(".env", "utf8");
for (const [k, v] of Object.entries(out)) {
  const line = `${k}=${v}`;
  const re = new RegExp(`^${k}=.*$`, "m");
  env = re.test(env) ? env.replace(re, line) : `${env.endsWith("\n") ? env : env + "\n"}${line}\n`;
}
fs.writeFileSync(".env", env);

console.log("\n.env updated with:");
console.log(`  STRIPE_PRICE_MONTHLY=${out.STRIPE_PRICE_MONTHLY}`);
console.log(`  STRIPE_PRICE_YEARLY=${out.STRIPE_PRICE_YEARLY}`);
console.log(`  STRIPE_WEBHOOK_SECRET=${out.STRIPE_WEBHOOK_SECRET.slice(0, 12)}…`);
// Emit machine-readable line for the wrapper to push to Vercel.
console.log("VALUES:" + JSON.stringify(out));
