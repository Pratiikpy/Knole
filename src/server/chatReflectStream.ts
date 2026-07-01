import { chatReplyStream, type Turn } from "./chat";
import { embed } from "./embed";
import { retrieveMemories } from "./engine";
import { requireUserId } from "./session";
import { enforceRate } from "./rateLimit";
import { detectCrisis, CRISIS_REPLY } from "./safety";

/**
 * Non-persisting streaming chat endpoint (POST /chat/reflect-stream). Conversational capture makes
 * chat ephemeral — the thread is NOT saved per turn; persistence happens once via composeEntryFn
 * ("turn this into an entry"). So this re-implements handleStreamingReply's guards (same-origin CSRF,
 * auth, rate limit) but never saveEntry/saveReply/extractMemories. Streams the reply + recall header.
 */
export async function handleChatReflectStream(request: Request): Promise<Response> {
  const txt = (status: number, body: string) => new Response(body, { status });

  // CSRF: same-origin POST only.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return txt(403, "forbidden");

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return txt(401, "auth required");
  }

  try {
    enforceRate("chat", 40, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* invalid JSON → caught by the validation below */
  }
  const b = body as { message?: unknown; history?: unknown };
  const message = String(b.message ?? "").trim();
  if (message.length < 1 || message.length > 4000) return txt(400, "message must be 1-4000 chars");

  // SB243 crisis intercept — pause the reflection and stream the referral. Chat is ephemeral, so
  // nothing is saved here either way; the client renders the CrisisCard on x-knole-crisis.
  if (detectCrisis(message).crisis) {
    const cenc = new TextEncoder();
    const cstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(cenc.encode(CRISIS_REPLY));
        controller.close();
      },
    });
    return new Response(cstream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-content-type-options": "nosniff",
        "x-knole-crisis": "1",
      },
    });
  }

  // Validate the conversation history defensively (it comes from the client).
  const raw: unknown[] = Array.isArray(b.history) ? b.history.slice(-40) : [];
  const history: Turn[] = [];
  for (const t of raw) {
    if (t && typeof t === "object" && "role" in t && "content" in t) {
      const role = (t as { role: unknown }).role;
      const content = (t as { content: unknown }).content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        history.push({ role, content: content.slice(0, 4000) });
      }
    }
  }

  let gen: AsyncGenerator<string, unknown, void>;
  let recalledHeader: string;
  try {
    const qVec = await embed(message);
    const memories = await retrieveMemories(userId, qVec, 6, message);
    gen = chatReplyStream(history, message, memories);
    recalledHeader = encodeURIComponent(
      JSON.stringify(
        memories.map((r) => ({
          content: r.content,
          quote: r.sourceQuote ?? null,
          when: r.createdAt,
        })),
      ),
    );
  } catch (e) {
    console.error("chat-reflect setup failed:", (e as Error).message);
    return txt(500, "couldn't start");
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const delta of gen) {
          full += delta;
          controller.enqueue(enc.encode(delta));
        }
      } catch (e) {
        console.error("chat-reflect reply failed:", (e as Error).message);
        if (!full) {
          controller.enqueue(enc.encode("Something interrupted me — try again in a moment."));
        }
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
      "x-knole-recalled": recalledHeader,
    },
  });
}
