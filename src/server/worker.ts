import { sql } from "drizzle-orm";
import { db } from "../db";
import { runDreaming } from "./dreaming";

// One scheduler tick: generate the overnight "dream" for every user with enough
// history. This is also where nudge delivery would hook in once a channel exists.
export async function tick(): Promise<{ users: number; dreamed: number }> {
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
}

export function startWorker(intervalMs: number): NodeJS.Timeout {
  console.log(`worker: ticking every ${Math.round(intervalMs / 1000)}s`);
  // Fire once on boot, then on the interval.
  void tick().then((r) => console.log(`worker tick: ${r.dreamed}/${r.users} users dreamed`));
  return setInterval(() => {
    tick()
      .then((r) => console.log(`worker tick: ${r.dreamed}/${r.users} users dreamed`))
      .catch((e) => console.error("worker tick failed:", e));
  }, intervalMs);
}
