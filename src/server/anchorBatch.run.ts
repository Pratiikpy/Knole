import { anchorDueBatched, verifyBatchedAnchor } from "./anchor";
import { buildLayers, proofFor } from "./receipts";
import { keccak256, toUtf8Bytes } from "ethers";

// Prove the gas-batching: many users' memory roots collapse to one Merkle root (one on-chain tx),
// yet each user's anchor stays independently verifiable via its proof. First the math (no chain),
// then a real end-to-end batch against the DB + 0G if any users are due.

const leaf = (u: string, r: string) => keccak256(toUtf8Bytes(`${u}:${r}`));
const items = Array.from({ length: 7 }, (_, i) => ({
  userId: `user-${i}`,
  root: keccak256(toUtf8Bytes(`root-${i}`)),
}));
const leaves = items.map((it) => leaf(it.userId, it.root));
const layers = buildLayers(leaves);
const batchRoot = layers[layers.length - 1][0];

let allOk = true;
for (let i = 0; i < items.length; i++) {
  const proof = proofFor(layers, i);
  const ok = verifyBatchedAnchor(items[i].userId, items[i].root, proof, batchRoot);
  if (!ok) allOk = false;
}
// A tampered root must NOT verify against the batch root.
const tampered = verifyBatchedAnchor(
  items[0].userId,
  keccak256(toUtf8Bytes("forged")),
  proofFor(layers, 0),
  batchRoot,
);
console.log(`batch math: ${items.length} users → 1 root ${batchRoot.slice(0, 14)}…`);
console.log(`  all ${items.length} verify against the batch root: ${allOk ? "✓" : "✗ FAIL"}`);
console.log(`  tampered root rejected: ${!tampered ? "✓" : "✗ FAIL"}`);
if (!allOk || tampered) process.exit(1);

console.log("\nrunning a real batched anchor against the DB + 0G…");
const batch = await anchorDueBatched({ limit: 500 });
console.log(
  batch
    ? `✅ ${batch.users} user(s) anchored on 0G in 1 tx ${batch.txHash} (root ${batch.batchRoot.slice(0, 14)}…)`
    : "nothing due right now — math above already proves the batching + verifiability",
);
process.exit(0);
