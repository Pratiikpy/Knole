import { saveEntry, saveReply, extractMemories, storeEntryOn0G } from "./engine";
import { scoreEntryValence } from "./valence";
import { storeSignals } from "./omission";
import { clientEncEnabledFor } from "./clientEnc";
import { requireUserId } from "./session";
import { background } from "./background";
import { enforceRate } from "./rateLimit";

export type StreamPrepared = {
  entryText: string; // the user's text to persist (the journal entry / chat message)
  entryKind: "journal" | "chat";
  qVec: number[];
  gen: AsyncGenerator<string, unknown, void>; // de-anonymised reply deltas
  headers?: Record<string, string>; // extra response headers (e.g. recalled memories)
  skipExtract?: boolean; // crisis intercept: save the entry, but never derive recallable data from it
};

type Prepare = (
  userId: string,
  body: unknown,
) => Promise<StreamPrepared | { error: number; msg: string }>;

/**
 * The shared shell for a same-origin streaming reply endpoint (journal + chat). Server fns can't
 * stream a response body, so these are raw handlers; this re-implements the guards the serverFn
 * middleware gives for free — same-origin CSRF (Origin/Host), the auth gate, the rate limit — then
 * saves the entry, streams the de-anonymised reply token-by-token, and persists the reply + extracts
 * memories after the stream. The caller's `prepare` does the path-specific work (parse the body,
 * embed, recall, build the delta generator) and returns the text to save plus that generator.
 */
export async function handleStreamingReply(
  request: Request,
  rateKey: string,
  prepare: Prepare,
): Promise<Response> {
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
    enforceRate(rateKey, 40, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    /* invalid JSON → caught by prepare's validation */
  }

  let prepared: StreamPrepared;
  let entryId: string;
  let clientEnc = false;
  try {
    const p = await prepare(userId, rawBody);
    if ("error" in p) return txt(p.error, p.msg);
    prepared = p;
    const row = await saveEntry(userId, prepared.entryText, prepared.qVec, prepared.entryKind);
    entryId = row.id;
    // When client-side encryption is on, the SERVER must not encrypt the 0G copy — the client uploads
    // an already-encrypted blob (keyed to its wallet) via the sweep. Otherwise persist on 0G in the
    // background — don't block the reply.
    clientEnc = await clientEncEnabledFor(userId);
    if (!clientEnc) {
      background(
        storeEntryOn0G(userId, entryId, prepared.entryText),
        `0G store entry=${entryId} user=${userId}`,
      );
    }
  } catch (e) {
    console.error(`${rateKey}-stream setup failed:`, (e as Error).message);
    return txt(500, "couldn't start");
  }

  const { entryText, gen, headers, skipExtract } = prepared;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const delta of gen) {
          full += delta;
          controller.enqueue(enc.encode(delta));
        }
        // Persist the reply + extract memories BEFORE closing so serverless keeps the function alive
        // through the write; extraction itself rides background()/waitUntil.
        if (full) {
          await saveReply(entryId, full, true);
          // Crisis intercept: the entry is saved (it's the user's private journal, and theirs), but a
          // self-harm disclosure must NEVER become derived data that could resurface — no recallable
          // memory, no mood-graph "representative entry", no signal topics.
          if (!skipExtract) {
            background(extractMemories(userId, entryId, entryText), "extractMemories");
            background(scoreEntryValence(userId, entryId, entryText), "scoreValence");
            background(storeSignals(userId, entryId, entryText, new Date()), "storeSignals");
          }
        }
      } catch (e) {
        console.error(`${rateKey}-stream reply failed:`, (e as Error).message);
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
      "x-knole-entry-id": entryId,
      "x-knole-og": clientEnc ? "client" : "server",
      ...(headers ?? {}),
    },
  });
}
