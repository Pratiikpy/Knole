import { backfill0G } from "./worker";

// On-demand: re-drive every entry stranded off-chain (kv_ref NULL) back to 0G after a transient
// outage — a fast manual catch-up alongside the worker's opportunistic per-tick backfill. No time
// budget; bounded only by the batch limit, so re-run until it reports 0. `npm run backfill:0g`.
const n = await backfill0G({ limit: 500 });
console.log(`backfill:0g — re-drove ${n} stranded entr${n === 1 ? "y" : "ies"} to 0G`);
process.exit(0);
