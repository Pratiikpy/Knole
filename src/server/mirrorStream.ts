import { buildMirror } from "./mirror";
import { isSameOrigin } from "./sameOrigin";
import { currentUserId } from "./session";
import { enforceRate } from "./rateLimit";

const txt = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * POST /mirror/stream — compose the Pattern Mirror with a live train of thought.
 *
 * The composition is a ~60s sealed-inference call, the single longest wait in the product, and it
 * used to sit behind a static "Composing your mirror…" screen. This endpoint opens a stream
 * immediately and narrates: real stage statuses while gathering, then honest keep-alive lines
 * (elapsed-time based, not fabricated stages) while the model writes. The final frame carries the
 * whole composed mirror as JSON.
 *
 * Frame protocol matches /ask/stream: \x1e{json}\x1e control frames — {status} lines, then one
 * {mirror} (or {error}) frame at the end.
 */
export async function handleMirrorStream(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return txt(403, "forbidden");
  const userId = await currentUserId();
  enforceRate("mirror-compose", 6, 60_000);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ctl = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode("\x1e" + JSON.stringify(obj) + "\x1e"));
        } catch {
          /* reader gone — composition continues below and lands in the cache */
        }
      };
      ctl({ status: "Reading back through your entries" });

      // Honest keep-alive: while the model writes, say so — with phrasing that moves, so a
      // minute-long wait reads as a process, not a hang. These rotate on elapsed time.
      const LINES = [
        "Composing your mirror — this takes about a minute",
        "Cross-reading your entries for the throughline",
        "Weighing the patterns against each other",
        "Choosing the words carefully",
        "Nearly there — polishing the reflection",
      ];
      let tick = 0;
      const heartbeat = setInterval(() => {
        ctl({ status: LINES[Math.min(tick++, LINES.length - 1)] });
      }, 14_000);
      ctl({ status: LINES[0] });
      tick = 1;

      try {
        const mirror = await buildMirror(userId, { compose: true });
        ctl({ mirror });
      } catch (e) {
        console.error("mirror-stream compose failed:", (e as Error).message);
        ctl({ error: "compose-failed" });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}
