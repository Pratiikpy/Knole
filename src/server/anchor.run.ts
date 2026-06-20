import { anchorDue } from "./anchor";

// On-demand: anchor every due user's memory root on-chain (one tx each) — a manual catch-up
// alongside the worker's opportunistic per-tick anchoring. `npm run anchor:run`.
const n = await anchorDue({ limit: 200 });
console.log(`anchor:run — anchored ${n} memory root(s) on-chain`);
process.exit(0);
