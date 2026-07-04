import { anchorDueBatched } from "./anchor";

// On-demand: anchor every due user's memory root on-chain — a manual catch-up alongside the worker's
// opportunistic anchoring. Gas-batched: all due users go on-chain in ONE tx. `npm run anchor:run`.
const batch = await anchorDueBatched({ limit: 500 });
console.log(
  batch
    ? `anchor:run — anchored ${batch.users} memory root(s) in 1 tx ${batch.txHash}`
    : "anchor:run — nothing due",
);
process.exit(0);
