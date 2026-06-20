import { askMyLifeStream } from "./ask";
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

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return txt(403, "forbidden");

  try {
    enforceRate("ask", 30, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let question = "";
  try {
    const body = (await request.json()) as { question?: string };
    question = String(body.question ?? "").trim();
  } catch {
    /* invalid JSON → caught by the length check */
  }
  if (question.length < 1 || question.length > 500) return txt(400, "question must be 1–500 chars");

  const userId = await currentUserId();

  let result: Awaited<ReturnType<typeof askMyLifeStream>>;
  try {
    result = await askMyLifeStream(userId, question);
  } catch (e) {
    console.error("ask-stream setup failed:", (e as Error).message);
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
      try {
        for await (const delta of result.gen) controller.enqueue(enc.encode(delta));
      } catch (e) {
        console.error("ask-stream reply failed:", (e as Error).message);
      } finally {
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
      // The streaming path always runs the anonymise gateway (sealed/TEE inference is off); the
      // footer reflects that. The non-streaming askMyLife still reports the exact per-call flags.
      "x-knole-privacy": encodeURIComponent(JSON.stringify({ sealed: false, anonymised: true })),
    },
  });
}
