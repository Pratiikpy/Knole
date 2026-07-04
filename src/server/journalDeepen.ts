import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { requireUserId } from "./session";
import { enforceRate } from "./rateLimit";
import { embed } from "./embed";
import { retrieveMemories, saveReply, extractMemories } from "./engine";
import { background } from "./background";
import { detectCrisis, CRISIS_REPLY } from "./safety";
import { deepenStream, loadThread, DEEPEN_MODES, type DeepenMode } from "./deepen";
import { recordReceipt } from "./receipts";

const { entries } = schema;

/**
 * Streaming deepen endpoint (POST /journal/deepen). The person answers the reflection's question;
 * Knole saves the answer as a reply, streams a follow-up (reflect-first, one question), and persists
 * it — turning a one-shot reflection into a real conversation. Same guards as the other stream
 * handlers (same-origin CSRF, auth, rate limit). The original entry must already exist and be theirs.
 *
 * Design: the thread lives as `replies` under the entry (isAi=false = the person, true = Knole), so an
 * entry and its whole back-and-forth stay together. The canonical journal write is on 0G; durable
 * disclosure in an answer flows to memories via extraction (which carry their own provenance).
 */
export async function handleDeepenStream(request: Request): Promise<Response> {
  const txt = (status: number, body: string) => new Response(body, { status });

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
    enforceRate("deepen", 60, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let body: { entryId?: string; answer?: string; mode?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* invalid JSON → caught below */
  }
  const entryId = String(body.entryId ?? "");
  const answer = String(body.answer ?? "").trim();
  const modeRaw = String(body.mode ?? "reflect") as DeepenMode;
  const mode: DeepenMode = DEEPEN_MODES.has(modeRaw) ? modeRaw : "reflect";
  if (!entryId || answer.length < 1 || answer.length > 20000) return txt(400, "bad request");

  // Ownership gate — only deepen an entry that's theirs.
  const [own] = await db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)))
    .limit(1);
  if (!own) return txt(404, "not found");

  // Save the person's answer first, so the reconstructed thread ends on it.
  const crisis = detectCrisis(answer).crisis;
  try {
    await saveReply(entryId, answer, false);
  } catch (e) {
    console.error("deepen: saving answer failed:", (e as Error).message);
    return txt(500, "couldn't save");
  }

  // Crisis intercept — hand off to real help, never mirror, never derive recallable data.
  let gen: AsyncGenerator<string, unknown, void>;
  if (crisis) {
    gen = (async function* () {
      yield CRISIS_REPLY;
    })();
  } else {
    const thread = await loadThread(userId, entryId);
    if (!thread) return txt(404, "not found");
    const qVec = await embed(answer);
    const recalled = await retrieveMemories(userId, qVec, 5, answer);
    gen = deepenStream(
      thread.entryText,
      thread.turns,
      recalled.map((r) => ({ content: r.content, sourceQuote: r.sourceQuote })),
      mode,
    );
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
        if (full) {
          const reply = await saveReply(entryId, full, true);
          // Durable disclosure in the answer becomes memory (linked to the parent entry). Valence +
          // signals are per-entry and already set from the original write, so they're not re-run here.
          if (!crisis) {
            background(extractMemories(userId, entryId, answer), "deepen extractMemories");
            background(
              recordReceipt(userId, { entryId, replyId: reply.id, input: answer, output: full }),
              "deepen recordReceipt",
            );
          }
        }
      } catch (e) {
        console.error("deepen-stream reply failed:", (e as Error).message);
        if (!full)
          controller.enqueue(enc.encode("Something interrupted me — try again in a moment."));
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
      ...(crisis ? { "x-knole-crisis": "1" } : {}),
    },
  });
}
