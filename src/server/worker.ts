import { sql } from "drizzle-orm";
import { db } from "../db";
import { runDreaming } from "./dreaming";

let ticking = false;

// One scheduler tick: generate the overnight "dream" for every user with enough
// history. Re-entrant calls are skipped so a slow tick can't overlap the next one
// (which would double-dream users and contend on the DB). Per-user errors are
// isolated so one failure never stops the rest.
export async function tick(): Promise<{ users: number; dreamed: number; skipped?: boolean }> {
  if (ticking) return { users: 0, dreamed: 0, skipped: true };
  ticking = true;
  try {
    const rows = (await db.execute(sql`
      SELECT u.id FROM users u
      WHERE (SELECT count(*) FROM entries e WHERE e.user_id = u.id) >= 2
    `)) as unknown as Record<string, unknown>[];

    let dreamed = 0;
    for (const r of rows) {
      const userId = String(r.id);
      try {
        const d = await runDreaming(userId);
        if (d) dreamed++;
      } catch (e) {
        console.error("dreaming failed for", userId, (e as Error).message);
      }
    }
    return { users: rows.length, dreamed };
  } finally {
    ticking = false;
  }
}

export function startWorker(intervalMs: number): NodeJS.Timeout {
  console.log(`worker: ticking every ${Math.round(intervalMs / 1000)}s`);
  const runTick = () =>
    tick()
      .then((r) =>
        console.log(
          r.skipped
            ? "worker tick: skipped (previous tick still running)"
            : `worker tick: ${r.dreamed}/${r.users} users dreamed`,
        ),
      )
      .catch((e) => console.error("worker tick failed:", (e as Error).message));
  // Fire once on boot, then on the interval. Both paths catch, so a failed tick
  // never becomes an unhandled rejection.
  void runTick();
  return setInterval(runTick, intervalMs);
}
