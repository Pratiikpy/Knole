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

  // Everything from here happens INSIDE the stream, so the connection opens instantly and the
  // retrieval stages narrate themselves as they run (khoj's train-of-thought). Frame protocol:
  // control frames are {json} (status / receipts / privacy); everything outside a frame
  // is answer text. Receipts moving off the response header also removes the header-size ceiling
  // that long CJK excerpts could blow through.
  const enc = new TextEncoder();
  const claimId = gate.allowed ? gate.claimId : undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ctl = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode("" + JSON.stringify(obj) + ""));
        } catch {
          /* reader gone */
        }
      };
      const say = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          /* reader gone */
        }
      };
      let privacy = { sealed: false, anonymised: true };
      try {
        const result = await askMyLifeStream(userId, question, (line) => ctl({ status: line }));
        if (result.empty) {
          say(result.summary);
          ctl({ privacy });
          return;
        }
        ctl({ receipts: result.receipts });
        ctl({ status: "Writing your answer" });
        const gen = result.gen;
        let step = await gen.next();
        while (!step.done) {
          say(step.value);
          step = await gen.next();
        }
        privacy = { sealed: step.value.sealed, anonymised: step.value.anonymised };
      } catch (e) {
        console.error("ask-stream failed:", (e as Error).message);
        // The daily allowance was consumed before the ask ran; a model failure must not cost one
        // of the three free questions.
        if (claimId) await refundAskClaim(claimId).catch(() => {});
        say("Something interrupted the search - ask again in a moment.");
      } finally {
        ctl({ privacy });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}
