import { tick, startWorker } from "./worker";

// `--once` runs a single tick and exits (used by tests / a cron job that invokes
// the worker per night). Otherwise it stays alive and ticks on WORKER_TICK_MS
// (default: nightly).
if (process.argv.includes("--once")) {
  const r = await tick();
  console.log(`one tick: ${r.dreamed}/${r.users} users dreamed`);
  process.exit(0);
} else {
  const intervalMs = Number(process.env.WORKER_TICK_MS ?? 24 * 60 * 60 * 1000);
  startWorker(intervalMs);
}
