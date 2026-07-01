import { chatReplyStream, type Turn } from "./chat";
import { embed } from "./embed";
import { retrieveMemories } from "./engine";
import { handleStreamingReply } from "./streamReply";
import { detectCrisis, CRISIS_REPLY, oneShot } from "./safety";

/**
 * Streaming chat endpoint (POST /chat/stream). Mirrors chatFn but streams Knole's reply
 * token-by-token (TTFT). Guards + persistence live in handleStreamingReply.
 */
export function handleChatStream(request: Request): Promise<Response> {
  return handleStreamingReply(request, "chat", async (userId, body) => {
    const b = body as { message?: unknown; history?: unknown };
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
    const memories = await retrieveMemories(userId, qVec, 6, message);
    return {
      entryText: message,
      entryKind: "chat" as const,
      qVec,
      gen: chatReplyStream(history, message, memories),
      // Recalled memories ride in a header (mirrors journalStream) so the body stays pure reply text
      // and the client can show the "it remembered" receipts.
      headers: {
        "x-knole-recalled": encodeURIComponent(
          JSON.stringify(
            memories.map((r) => ({
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
