import { currentUserId } from "./session";
import { enforceRate } from "./rateLimit";
import { detectCrisis, CRISIS_REPLY } from "./safety";
import { reflectStream } from "./reflect";
import { saveEntry, saveReply, extractMemories, storeEntryOn0G, updateSettings } from "./engine";
import { background } from "./background";

/**
 * Streaming onboarding first-reflection (POST /onboard/stream) — the magical-first-5 aha, token-by-token.
 * A GUEST (no session) gets it EPHEMERALLY: the reflection streams from their own words, nothing is
 * written, so no auth is needed (there's no write to gate). Once signed in, the same reflection persists
 * (entry + reply + memory + 0G) after the stream. Mirrors handleStreamingReply's guards; server fns can't
 * stream a body, so this is a raw handler mounted in start.ts.
 */
export async function handleOnboardStream(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host)
    return new Response("forbidden", { status: 403 });
  try {
    enforceRate("onboard-stream", 10, 60_000);
  } catch {
    return new Response("slow down a moment", { status: 429 });
  }

  let body: { opener?: unknown; voice?: unknown; thing?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* validated below */
  }
  const opener = String(body.opener ?? "").slice(0, 8000);
  if (!opener.trim()) return new Response("empty", { status: 400 });
  const thing = typeof body.thing === "string" ? body.thing.slice(0, 100) : "";
  const text = thing ? `${opener}\n(Quietly on my mind this week: ${thing})` : opener;

  // SB243: a crisis disclosure gets the referral, streamed as a single message — never a mirror,
  // never persisted as recallable data.
  if (detectCrisis(text).crisis) {
    return new Response(CRISIS_REPLY, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-knole-crisis": "1",
        "x-knole-persisted": "0",
      },
    });
  }

  const userId = await currentUserId(); // the visitor's own journal — their private guest, or signed-in
  const voice = ["warm", "structural", "honest", "curious"].includes(String(body.voice))
    ? (String(body.voice) as "warm" | "structural" | "honest" | "curious")
    : undefined;
  const lensFor: Record<string, "gentle" | "pattern" | "blunt" | "decision"> = {
    warm: "gentle",
    structural: "decision",
    honest: "blunt",
    curious: "pattern",
  };
  const lens = voice ? lensFor[voice] : "gentle";

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let acc = "";
      try {
        for await (const delta of reflectStream(text, [], lens)) {
          acc += delta;
          controller.enqueue(enc.encode(delta));
        }
        // Signed-in: persist the same reflection (entry + reply + memory + 0G) after the stream.
        if (userId && acc) {
          if (voice) await updateSettings(userId, { voice }).catch(() => {});
          const row = await saveEntry(userId, text, undefined, "journal");
          await saveReply(row.id, acc, true);
          background(extractMemories(userId, row.id, text), "onboard-extract");
          background(storeEntryOn0G(userId, row.id, text), "onboard-0g");
        }
      } catch (e) {
        console.error("onboard-stream failed:", (e as Error).message);
        if (!acc) {
          controller.enqueue(
            enc.encode(
              "I'm here, and I've got this. Come back tomorrow and we'll pick up the thread.",
            ),
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
      "x-content-type-options": "nosniff",
      "x-knole-persisted": userId ? "1" : "0",
    },
  });
}
