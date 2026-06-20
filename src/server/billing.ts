import "dotenv/config";
import Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db";

// Subscription billing via Stripe. Everything here is feature-gated: with no Stripe keys set
// the app behaves honestly (the upgrade CTA says billing isn't enabled — never a dead button),
// and nothing about the core journal depends on it. Entitlement is a single field: users.plan
// ("free" | "deep"), flipped only by verified Stripe webhooks — never by the client.

const { users } = schema;

const SECRET = process.env.STRIPE_SECRET_KEY ?? "";
const PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY ?? "";
const PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY ?? "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const APP_URL = (
  process.env.VITE_SITE_URL ??
  process.env.VITE_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

/** True only when checkout can actually run (a secret key + at least one price). */
export function billingConfigured(): boolean {
  return Boolean(SECRET && (PRICE_MONTHLY || PRICE_YEARLY));
}

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!SECRET) throw new Error("BILLING_NOT_CONFIGURED");
  if (!client) client = new Stripe(SECRET);
  return client;
}

// A Stripe customer per user, id cached on the row so we never create duplicates.
async function ensureCustomer(userId: string): Promise<string> {
  const [u] = await db
    .select({ email: users.email, customer: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new Error("user not found");
  if (u.customer) return u.customer;
  const customer = await stripe().customers.create({
    email: u.email ?? undefined,
    metadata: { knoleUserId: userId },
  });
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, userId));
  return customer.id;
}

/** Create a Stripe Checkout session for the deeper plan and return its hosted URL. */
export async function createCheckoutSession(
  userId: string,
  opts: { yearly?: boolean },
): Promise<string> {
  const price = opts.yearly ? PRICE_YEARLY : PRICE_MONTHLY;
  if (!SECRET || !price) throw new Error("BILLING_NOT_CONFIGURED");
  const customer = await ensureCustomer(userId);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: `${APP_URL}/settings?upgraded=1`,
    cancel_url: `${APP_URL}/upgrade?canceled=1`,
    allow_promotion_codes: true,
    metadata: { knoleUserId: userId },
  });
  if (!session.url) throw new Error("stripe returned no checkout url");
  return session.url;
}

/** A Stripe Billing Portal URL so a subscriber can manage or cancel. */
export async function createBillingPortalSession(userId: string): Promise<string> {
  if (!SECRET) throw new Error("BILLING_NOT_CONFIGURED");
  const customer = await ensureCustomer(userId);
  const portal = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${APP_URL}/settings`,
  });
  return portal.url;
}

// A subscription in any of these states still grants access; anything else falls back to free.
const ENTITLED = new Set(["active", "trialing", "past_due"]);

/**
 * Verify a Stripe webhook signature and reconcile entitlement. The signature check (constructEvent)
 * is the trust boundary — an unsigned or tampered body throws before any state changes. Plan flips
 * are idempotent, so Stripe's at-least-once delivery is safe.
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
): Promise<{ received: boolean; type?: string }> {
  if (!SECRET || !WEBHOOK_SECRET) throw new Error("BILLING_NOT_CONFIGURED");
  if (!signature) throw new Error("missing stripe-signature header");
  const event = stripe().webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.knoleUserId;
      // Grant only when the user id from (server-set) metadata also matches the customer Stripe
      // attached to this paid session — the same customer cross-check the subscription branches use,
      // so a tampered knoleUserId can't move a plan onto an account that didn't pay.
      if (userId && s.customer) {
        await db
          .update(users)
          .set({
            plan: "deep",
            stripeCustomerId: String(s.customer),
            ...(s.subscription ? { stripeSubscriptionId: String(s.subscription) } : {}),
          })
          .where(and(eq(users.id, userId), eq(users.stripeCustomerId, String(s.customer))));
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const entitled = event.type !== "customer.subscription.deleted" && ENTITLED.has(sub.status);
      await db
        .update(users)
        .set({ plan: entitled ? "deep" : "free", stripeSubscriptionId: sub.id })
        .where(eq(users.stripeCustomerId, String(sub.customer)));
      break;
    }
  }
  return { received: true, type: event.type };
}

/** The user's plan + whether billing is even enabled in this deployment. */
export async function getBilling(userId: string): Promise<{ plan: string; configured: boolean }> {
  const [u] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { plan: u?.plan ?? "free", configured: billingConfigured() };
}
