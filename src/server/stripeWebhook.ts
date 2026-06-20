import { handleStripeWebhook } from "./billing";

// Stripe webhook receiver. Server-to-server, authenticated by Stripe's signature (verified inside
// handleStripeWebhook — the trust boundary), so it is handled here in the SSR rather than as a
// CSRF-protected server fn, and it needs the RAW request body. Not under /api/* (Vercel-reserved).
export async function handleStripeWebhookRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sig = request.headers.get("stripe-signature");
  const raw = await request.text();
  try {
    const result = await handleStripeWebhook(raw, sig);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    // A forged/invalid signature, an unconfigured deployment, or a transient DB error → 400. Stripe
    // retries non-2xx, which is what we want for transient failures; a bad signature just keeps
    // failing (and is logged), never mutating state.
    console.error("stripe webhook rejected:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
}
