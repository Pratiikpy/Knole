import { reflectStream } from "./reflect";
import { embed } from "./embed";
import { retrieveMemories } from "./engine";
import { handleStreamingReply } from "./streamReply";

/**
 * Streaming journal endpoint (POST /journal/stream). Mirrors journalFn but streams the reflection
 * token-by-token (TTFT); the recalled memories ride in an x-knole-recalled header so the response
 * body stays pure reflection text. Guards + persistence live in handleStreamingReply.
 */
export function handleJournalStream(request: Request): Promise<Response> {
  return handleStreamingReply(request, "journal", async (userId, body) => {
    const entry = String((body as { entry?: string }).entry ?? "").trim();
    if (entry.length < 1 || entry.length > 20000) {
      return { error: 400, msg: "entry must be 1–20000 chars" };
    }
    const qVec = await embed(entry);
    const recalled = await retrieveMemories(userId, qVec, 6, entry);
    return {
      entryText: entry,
      entryKind: "journal" as const,
      qVec,
      gen: reflectStream(entry, recalled),
      headers: {
        "x-knole-recalled": encodeURIComponent(
          JSON.stringify(
            recalled.map((r) => ({ content: r.content, quote: r.sourceQuote ?? null })),
          ),
        ),
      },
    };
  });
}
