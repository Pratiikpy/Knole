import { reflectStream } from "./reflect";
import { embed } from "./embed";
import { retrieveMemories, saveEntry, saveReply, extractMemories, storeEntryOn0G } from "./engine";
import { requireUserId } from "./session";
import { background } from "./background";
import { enforceRate } from "./rateLimit";

/**
 * Same-origin streaming journal endpoint (TTFT). Mirrors journalFn — embed → recall → reflect →
 * persist entry + reply → extract memories — but streams the reflection token-by-token so the page
 * "writes back" instead of blocking ~15-38s. Server fns can't stream a response body, so this is a
 * raw handler; it re-implements the guards the serverFn middleware gives for free: a same-origin
 * CSRF check, the auth gate, and the rate limit. The recalled memories ride along in a header so the
 * body stays pure reflection text.
 */
export async function handleJournalStream(request: Request): Promise<Response> {
  const txt = (status: number, body: string) => new Response(body, { status });

  // CSRF: same-origin POST only. A cross-site fetch carries a foreign (or no) Origin — reject it.
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
    enforceRate("journal", 30, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let entry = "";
  try {
    const body = (await request.json()) as { entry?: string };
    entry = (body.entry ?? "").trim();
  } catch {
    /* invalid JSON → caught by the length check below */
  }
  if (entry.length < 1 || entry.length > 20000) return txt(400, "entry must be 1–20000 chars");

  let recalled: Awaited<ReturnType<typeof retrieveMemories>>;
  let entryId: string;
  try {
    const qVec = await embed(entry);
    recalled = await retrieveMemories(userId, qVec, 6, entry);
    const row = await saveEntry(userId, entry, qVec);
    entryId = row.id;
    // Persist the canonical entry on 0G in the background — don't block the reflection.
    background(storeEntryOn0G(userId, entryId, entry), `0G store entry=${entryId} user=${userId}`);
  } catch (e) {
    console.error("journal-stream setup failed:", (e as Error).message);
    return txt(500, "couldn't start the reflection");
  }

  const recalledHeader = encodeURIComponent(
    JSON.stringify(recalled.map((r) => ({ content: r.content, quote: r.sourceQuote ?? null }))),
  );

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const delta of reflectStream(entry, recalled)) {
          full += delta;
          controller.enqueue(enc.encode(delta));
        }
        // Persist the reply + extract memories BEFORE closing, so serverless keeps the function
        // alive through the write; extraction itself rides background()/waitUntil.
        if (full) {
          await saveReply(entryId, full, true);
          background(extractMemories(userId, entryId, entry), "extractMemories");
        }
      } catch (e) {
        console.error("journal-stream reflect failed:", (e as Error).message);
        if (!full) {
          controller.enqueue(
            enc.encode("Something interrupted the reflection — try again in a moment."),
          );
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
      "x-knole-recalled": recalledHeader,
      "x-content-type-options": "nosniff",
    },
  });
}
