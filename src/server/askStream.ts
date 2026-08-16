import { askMyLifeStream } from "./ask";
import { isSameOrigin } from "./sameOrigin";
import { gateAsk, refundAskClaim } from "./askPresets";
import { currentUserId } from "./session";
import { enforceRate } from "./rateLimit";

/**
 * Streaming "Ask My Life" endpoint (POST /ask/stream). A READ (currentUserId — the demo can ask too,
 * unlike the gated journal/chat writes), so it doesn't use the entry-saving streaming helper. Streams
 * the grounded answer token-by-token; the receipts (the user's own quoted words) + a privacy flag
 * ride in headers so the body stays pure answer text. Same-origin CSRF + rate guards inline.
 */
export async function handleAskStream(request: Request): Promise<Response> {
  const txt = (status: number, body: string) => new Response(body, { status });

  if (!isSameOrigin(request)) return txt(403, "forbidden");

  try {
    enforceRate("ask", 30, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let question = "";
  let presetId: string | undefined;
  try {
    const body = (await request.json()) as { question?: string; presetId?: string };
    question = String(body.question ?? "").trim();
    if (typeof body.presetId === "string") presetId = body.presetId;
  } catch {
    /* invalid JSON → caught by the length check */
  }
  if (question.length < 1 || question.length > 500) return txt(400, "question must be 1–500 chars");

  const userId = await currentUserId();

  // The free-tier gate (gnothi): presets always pass and use the SERVER's canonical text; custom
  // questions are unlimited on Deep / for iNFT holders, else draw from a small daily allowance.
  let gate: Awaited<ReturnType<typeof gateAsk>>;
  try {
    gate = await gateAsk(userId, question, presetId);
  } catch {
    gate = { allowed: true, question, custom: true, remaining: null }; // gate down → never block asking
  }
  if (!gate.allowed) {
    return new Response(
      JSON.stringify({
        gated: true,
        message:
          "You've used today's three custom questions. The preset questions stay open - or go Deep for unlimited asking.",
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  }
  question = gate.question;

  let result: Awaited<ReturnType<typeof askMyLifeStream>>;
  try {
    result = await askMyLifeStream(userId, question);
  } catch (e) {
    console.error("ask-stream setup failed:", (e as Error).message);
    // The daily allowance was consumed before the ask ran, so a model timeout used to cost the
    // user one of their three free questions for nothing. Give it back.
    if (gate.allowed && gate.claimId) await refundAskClaim(gate.claimId);
    return txt(500, "couldn't search");
  }

  // Nothing to answer from → a plain (non-streamed) message; no receipts/privacy footer.
  if (result.empty) {
    return new Response(result.summary, {
      headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The real per-call privacy flags (sealed = TEE attestation verified) are only known once the
      // generator finishes — after headers have flushed. So iterate manually to capture the return
      // value and emit it as a trailing sentinel frame; the client splits it off the answer text.
      let privacy = { sealed: false, anonymised: true };
      try {
        const gen = result.gen;
        let step = await gen.next();
        while (!step.done) {
          controller.enqueue(enc.encode(step.value));
          step = await gen.next();
        }
        privacy = { sealed: step.value.sealed, anonymised: step.value.anonymised };
      } catch (e) {
        console.error("ask-stream reply failed:", (e as Error).message);
      } finally {
        // \x1e (record separator) can't occur in the model's prose, so the client can safely split the
        // JSON footer from the answer — surfacing the honest "sealed enclave" badge only when verified.
        controller.enqueue(enc.encode("\x1e" + JSON.stringify(privacy)));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
      "x-knole-receipts": encodeURIComponent(JSON.stringify(result.receipts)),
      // Optimistic default (anonymise gateway always runs); the trailing sentinel frame carries the
      // real, per-call {sealed, anonymised} once the TEE attestation has been verified.
      "x-knole-privacy": encodeURIComponent(JSON.stringify({ sealed: false, anonymised: true })),
    },
  });
}
