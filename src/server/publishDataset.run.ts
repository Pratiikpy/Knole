// Publish the sensing training dataset to 0G Storage (public, unencrypted — derived only from public
// corpora + synthetic examples, never user journals) and anchor a provenance commitment on-chain, so
// the "Auditable AI" claim is verifiable: anyone can download the exact training data by its storage
// root and check the on-chain commitment binding dataset + base model + config together.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import { putData, anchorOnChain, NET_NAME } from "./og";

const DATASET = resolve(process.cwd(), "../finetune/data/train_sensing.clean.jsonl");
const BASE_MODEL_HASH = "0xb4f76a886b8655c92bb021922d60b5e4d9271a5c9da98b6cb10937a06c2c75a7";
const TASK_ID = "71ecc942-235c-4932-9af2-636b48673dbd";
const CONFIG = "LoRA · neftune 5 · 3 epochs · batch 4 · lr 2e-4 · 1233 steps";

const bytes = new Uint8Array(readFileSync(DATASET));
const sha256 = ethers.sha256(bytes);
console.log(`dataset bytes=${bytes.length} sha256=${sha256} network=${NET_NAME}`);

console.log("uploading dataset to 0G Storage (public)…");
const { rootHash, txHash: uploadTx, network } = await putData(bytes); // no key → public/auditable
console.log(`storageRoot=${rootHash} uploadTx=${uploadTx} net=${network}`);

// Commit dataset + base model + config to the chain: a single tamper-evident hash anyone can recompute.
const commitment = ethers.keccak256(
  ethers.toUtf8Bytes(
    JSON.stringify({
      storageRoot: rootHash,
      baseModelHash: BASE_MODEL_HASH,
      sha256,
      taskId: TASK_ID,
      config: CONFIG,
    }),
  ),
);
console.log(`commitment=${commitment} — anchoring on-chain…`);
const anchorTx = await anchorOnChain(commitment);
console.log(`anchorTx=${anchorTx}`);

console.log(
  "PROVENANCE=" +
    JSON.stringify({
      datasetStorageRoot: rootHash,
      datasetSha256: sha256,
      datasetBytes: bytes.length,
      commitment,
      provenanceAnchorTx: anchorTx,
      network,
    }),
);
process.exit(0);
