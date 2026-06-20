import { waitUntil } from "@vercel/functions";

const ON_VERCEL = !!process.env.VERCEL;

/**
 * Run a background task (memory extraction, 0G storage) without blocking the response.
 *
 * On a long-lived server (dev, or a Node host) fire-and-forget completes naturally. On
 * Vercel's serverless runtime, work scheduled after the response is NOT guaranteed to run,
 * which would silently drop memory extraction + 0G storage for real entries — so there we
 * hand the task to `waitUntil`, which keeps the function alive until it finishes. If there's
 * no active request context, we fall back to fire-and-forget. Worst case this behaves
 * exactly like the previous `void task.catch(...)`, so it can never be worse than before.
 */
export function background(task: Promise<unknown>, label = "background task"): void {
  const safe = task.catch((e) => console.error(`${label} failed:`, (e as Error)?.message ?? e));
  if (ON_VERCEL) {
    try {
      waitUntil(safe);
      return;
    } catch {
      // no active request context (e.g. a worker tick) — fall through to fire-and-forget
    }
  }
  void safe;
}
