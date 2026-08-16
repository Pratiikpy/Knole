import { saveEntry, saveReply, extractMemories, storeEntryOn0G } from "./engine";
import { isSameOrigin } from "./sameOrigin";
import { scoreEntryValence } from "./valence";
import { storeSignals } from "./omission";
import { recordReceipt } from "./receipts";
import { recordJournaledDayBg } from "./dayAnchor";
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
  entryCreatedAt?: Date; // backfill (yesterday capture slot): date the entry into the past
  entrySections?: Record<string, string> | null; // sectioned composer: the structured fields as filled
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
  if (!isSameOrigin(request)) return txt(403, "forbidden");

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
    const row = await saveEntry(
      userId,
      prepared.entryText,
      prepared.qVec,
      prepared.entryKind,
      prepared.entryCreatedAt || prepared.entrySections
        ? { createdAt: prepared.entryCreatedAt, sections: prepared.entrySections ?? null }
        : undefined,
    );
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
      // The generator's RETURN value carries the per-response attestation result ({sealed}); a plain
      // for-await discards it, so iterate manually — the anchored receipt must record what actually
      // served this reply, not the config-level default.
      let genSealed: boolean | undefined;
      let clientGone = false;
      try {
        const it = gen[Symbol.asyncIterator]();
        for (;;) {
          const step = await it.next();
          if (step.done) {
            const r = step.value as { sealed?: boolean } | undefined;
            if (r && typeof r.sealed === "boolean") genSealed = r.sealed;
            break;
          }
          full += step.value;
          // The reader may be gone (tab closed, navigation, mobile backgrounding). Enqueueing then
          // throws — and that used to abandon the reply, the memories, the valence, the signals and
          // the receipt. Generation is already paid for, so keep consuming and persist below; only
          // the delivery stops.
          if (!clientGone) {
            try {
              controller.enqueue(enc.encode(step.value));
            } catch {
              clientGone = true;
            }
          }
        }
        // Persist the reply + extract memories BEFORE closing so serverless keeps the function alive
        // through the write; extraction itself rides background()/waitUntil.
        if (full) {
          const reply = await saveReply(entryId, full, true);
          // Proof-of-journaling: bump the on-chain day counter (idempotent per UTC day; skips
          // guests). Counts crisis entries too — writing IS journaling; only derived data is gated.
          recordJournaledDayBg(userId);
          // Crisis intercept: the entry is saved (it's the user's private journal, and theirs), but a
          // self-harm disclosure must NEVER become derived data that could resurface — no recallable
          // memory, no mood-graph "representative entry", no signal topics, and no reflection receipt.
          if (!skipExtract) {
            background(extractMemories(userId, entryId, entryText), "extractMemories");
            background(scoreEntryValence(userId, entryId, entryText), "scoreValence");
            background(
              storeSignals(userId, entryId, entryText, prepared.entryCreatedAt ?? new Date()),
              "storeSignals",
            );
            background(
              recordReceipt(userId, {
                entryId,
                replyId: reply.id,
                input: entryText,
                output: full,
                sealed: genSealed,
              }),
              "recordReceipt",
            );
          }
        }
      } catch (e) {
        console.error(`${rateKey}-stream reply failed:`, (e as Error).message);
        if (!full) {
          controller.enqueue(enc.encode("Something interrupted me — try again in a moment."));
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed by the disconnect — nothing to flush */
        }
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
