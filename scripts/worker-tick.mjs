#!/usr/bin/env node
// One worker tick, then exit — the self-hosted replacement for the Vercel cron in vercel.json.
// Run as a one-shot on a timer rather than a resident process: the tick loads the transformer
// models (anonymiser, embeddings) and this box has 2 GB, which the app server already shares.
// Exiting hands that memory straight back. Run: node scripts/worker-tick.mjs
import { tick } from "../dist/worker/index.mjs";

try {
  const result = await tick();
  console.log(`tick ok: ${JSON.stringify(result)}`);
  process.exit(0);
} catch (e) {
  console.error("tick failed:", e?.stack ?? e);
  process.exit(1);
}
