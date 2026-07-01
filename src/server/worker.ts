import { sql } from "drizzle-orm";
import { db } from "../db";
import { runDreaming } from "./dreaming";
import { storeEntryOn0G } from "./engine";
import { anchorDue } from "./anchor";
import { runWeeklyDigests } from "./digest";
import { runProactiveNudges } from "./proactivity";
import { scoreEntryValence } from "./valence";
import { backfillSignals, computeOmissionRadar, usersDueForRadar } from "./omission";
import { consolidateDue } from "./consolidate";

let ticking = false;

// One scheduler tick: generate the overnight "dream" for every user with enough
// history. Re-entrant calls are skipped so a slow tick can't overlap the next one
// (which would double-dream users and contend on the DB). Per-user errors are
// isolated so one failure never stops the rest.
export async function tick(): Promise<{
  users: number;
  dreamed: number;
  pruned?: number;
  backfilled?: number;
  anchored?: number;
  digested?: number;
  nudged?: number;
  valenced?: number;
  signalsBackfilled?: number;
  radared?: number;
  consolidated?: number;
  skipped?: boolean;
}> {
  if (ticking) return { users: 0, dreamed: 0, skipped: true };
  ticking = true;
  try {
    // Only users who still need today's dream (idempotency-aware), so we never waste the
    // tick re-checking already-dreamed users and the time budget below never skips anyone
    // who hasn't dreamed yet.
    const rows = (await db.execute(sql`
      SELECT u.id FROM users u
      WHERE (SELECT count(*) FROM entries e WHERE e.user_id = u.id) >= 2
        AND NOT EXISTS (
          SELECT 1 FROM reflection_artifacts ra
          WHERE ra.user_id = u.id AND ra.thread_key = 'dreaming'
            AND ra.created_at >= date_trunc('day', now())
        )
      ORDER BY u.id
    `)) as unknown as Record<string, unknown>[];

    // Bounded work per tick so a serverless run (60s function cap) never times out — the
    // remaining users are picked up on the next tick, and idempotency makes that safe.
    const start = Date.now();
    const budgetMs = Number(process.env.WORKER_TICK_BUDGET_MS ?? 50_000);
    let dreamed = 0;
    for (const r of rows) {
      if (Date.now() - start > budgetMs) break;
      const userId = String(r.id);
      try {
        const d = await runDreaming(userId);
        if (d) dreamed++;
      } catch (e) {
        console.error("dreaming failed for", userId, (e as Error).message);
      }
    }

    let pruned = 0;
    try {
      pruned = await pruneStaleCaches();
    } catch (e) {
      console.error("cache prune failed:", (e as Error).message);
    }

    // Re-drive entries stranded off-chain by a transient 0G failure, within whatever time the
    // dream loop left (0G uploads are slow), so the "you own it on 0G" guarantee self-heals over
    // ticks instead of silently losing entries. A backlog catches up over nights or via backfill:0g.
    let backfilled = 0;
    try {
      backfilled = await backfill0G({ start, budgetMs });
    } catch (e) {
      console.error("0G backfill failed:", (e as Error).message);
    }

    // Daily on-chain anchor of each due user's memory root — a timestamped, tamper-evident
    // commitment to their whole state. Opportunistic + idempotent per day, like the backfill.
    let anchored = 0;
    try {
      anchored = await anchorDue({ start, budgetMs });
    } catch (e) {
      console.error("anchor step failed:", (e as Error).message);
    }

    // Hierarchical consolidation — roll up the most-recent completed week/month/year per due user.
    let consolidated = 0;
    try {
      consolidated =
        (await consolidateDue("weekly", { start, budgetMs })) +
        (await consolidateDue("monthly", { start, budgetMs })) +
        (await consolidateDue("yearly", { start, budgetMs }));
    } catch (e) {
      console.error("consolidation step failed:", (e as Error).message);
    }

    // The outbound retention channel: deliver any due weekly digests (email + push). A no-op until a
    // transport (RESEND_API_KEY / VAPID keys) is configured; idempotent + quiet-hours-aware, so it's
    // safe to run every tick and self-paces to ~weekly per user.
    let digested = 0;
    try {
      digested = (await runWeeklyDigests({ start, budgetMs })).sent;
    } catch (e) {
      console.error("weekly digest step failed:", (e as Error).message);
    }

    // Proactive memory-grounded push nudges — the Inner-Thoughts cadence gate decides who's due.
    let nudged = 0;
    try {
      nudged = (await runProactiveNudges({ start, budgetMs })).sent;
    } catch (e) {
      console.error("proactive nudge step failed:", (e as Error).message);
    }

    // Score any entry without a mood valence yet — bounded + self-healing like the 0G backfill, so
    // historical + imported entries all get a score over a few nights.
    let valenced = 0;
    try {
      valenced = await backfillValence({ start, budgetMs });
    } catch (e) {
      console.error("valence backfill failed:", (e as Error).message);
    }

    // Tag any entry without per-entry signals yet — feeds the Omission Radar's absence statistic.
    let signalsBackfilled = 0;
    try {
      signalsBackfilled = await backfillSignals({ start, budgetMs });
    } catch (e) {
      console.error("signals backfill failed:", (e as Error).message);
    }

    // The Omission Radar — one absence read per due user (history-gated, idempotent once/day/user).
    let radared = 0;
    try {
      const due = await usersDueForRadar();
      for (const userId of due) {
        if (Date.now() - start > budgetMs) break;
        try {
          const radar = await computeOmissionRadar(userId);
          if (radar) radared++;
        } catch (e) {
          console.error("omission radar failed for", userId, (e as Error).message);
        }
      }
    } catch (e) {
      console.error("omission radar step failed:", (e as Error).message);
    }
    return {
      users: rows.length,
      dreamed,
      pruned,
      backfilled,
      anchored,
      digested,
      nudged,
      valenced,
      signalsBackfilled,
      radared,
      consolidated,
    };
  } finally {
    ticking = false;
  }
}

/**
 * Re-drive entries that never reached 0G (kv_ref IS NULL — a transient 0G outage during journaling).
 * Bounded by a row limit and an optional time budget (0G uploads are ~20s each, so a tick can only
 * fit a few); the rest catch up on later runs. Per-entry errors are isolated. Returns how many were
 * stored. Run on-demand for a full catch-up: `npm run backfill:0g`.
 */
export async function backfill0G(
  opts: { start?: number; budgetMs?: number; limit?: number; userId?: string } = {},
): Promise<number> {
  const { start = Date.now(), budgetMs = Infinity, limit = 25, userId } = opts;
  const rows = (await db.execute(sql`
    SELECT id, user_id, text FROM entries
    WHERE kv_ref IS NULL ${userId ? sql`AND user_id = ${userId}` : sql``}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  let stored = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      await storeEntryOn0G(String(r.user_id), String(r.id), String(r.text));
      stored++;
    } catch (e) {
      console.error(`backfill0G: entry=${r.id} failed:`, (e as Error).message);
    }
  }
  if (stored)
    console.log(`backfill0G: re-drove ${stored} stranded entr${stored === 1 ? "y" : "ies"} to 0G`);
  return stored;
}

/**
 * Score the valence of any entry without one yet (a path missed it, or it predates the mood feature /
 * arrived via import). Bounded by the time budget like backfill0G, so it self-heals over ticks;
 * per-entry errors are isolated. Returns how many were scored.
 */
export async function backfillValence(
  opts: { start?: number; budgetMs?: number; limit?: number } = {},
): Promise<number> {
  const { start = Date.now(), budgetMs = Infinity, limit = 100 } = opts;
  const rows = (await db.execute(sql`
    SELECT id, user_id, text FROM entries
    WHERE valence IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  let scored = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      await scoreEntryValence(String(r.user_id), String(r.id), String(r.text));
      scored++;
    } catch (e) {
      console.error(`backfillValence: entry=${r.id} failed:`, (e as Error).message);
    }
  }
  return scored;
}

/**
 * Drop superseded cache artifacts (mirror / nudge / resurface) — only the latest per
 * user+thread is ever read, so the rest are dead weight. Dreams are kept as a history.
 * Returns the number removed.
 */
export async function pruneStaleCaches(): Promise<number> {
  const removed = (await db.execute(sql`
    DELETE FROM reflection_artifacts
    WHERE thread_key IN ('mirror', 'nudge', 'resurface', 'omission')
      AND id NOT IN (
        SELECT DISTINCT ON (user_id, thread_key) id
        FROM reflection_artifacts
        WHERE thread_key IN ('mirror', 'nudge', 'resurface', 'omission')
        ORDER BY user_id, thread_key, created_at DESC
      )
    RETURNING id
  `)) as unknown as Record<string, unknown>[];
  return removed.length;
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
