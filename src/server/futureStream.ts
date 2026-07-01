import { futureSelfReplyStream } from "./futureself";
import { type Turn } from "./chat";
import { embed } from "./embed";
import { retrieveMemories, retrieveIdentityMemories } from "./engine";
import { handleStreamingReply } from "./streamReply";
import { detectCrisis, CRISIS_REPLY, oneShot } from "./safety";

/**
 * Streaming Future-Self endpoint (POST /future/stream). A sibling of chat: the user's turn is saved
 * as a real "chat" entry (and indexed), but the simulated reply is never memory-extracted — so the
 * projected future self can't pollute The Index with fabricated facts. Guards + persistence live in
 * handleStreamingReply.
 */
export function handleFutureStream(request: Request): Promise<Response> {
  return handleStreamingReply(request, "future", async (userId, body) => {
    const b = body as { message?: unknown; history?: unknown; horizon?: unknown };
    const message = String(b.message ?? "").trim();
    if (message.length < 1 || message.length > 4000) {
      return { error: 400, msg: "message must be 1–4000 chars" };
    }
    if (detectCrisis(message).crisis) {
      return {
        entryText: message,
        entryKind: "chat" as const,
        qVec: await embed(message),
        gen: oneShot(CRISIS_REPLY),
        skipExtract: true,
        headers: { "x-knole-crisis": "1" } as Record<string, string>,
      };
    }
    const horizonRaw = Number(b.horizon);
    const horizon = [5, 10, 20].includes(horizonRaw) ? horizonRaw : 10;
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
    const qVec = await embed(message);
    const [identity, relevant] = await Promise.all([
      retrieveIdentityMemories(userId, 10),
      retrieveMemories(userId, qVec, 6, message),
    ]);
    return {
      entryText: message,
      entryKind: "chat" as const,
      qVec,
      gen: futureSelfReplyStream(history, message, identity, relevant, horizon),
      headers: {
        "x-knole-recalled": encodeURIComponent(
          JSON.stringify(
            relevant.map((r) => ({
              content: r.content,
              quote: r.sourceQuote ?? null,
              when: r.createdAt,
            })),
          ),
        ),
      },
    };
  });
}
