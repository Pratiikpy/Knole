import "dotenv/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MemData, Indexer } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";

// 0G Galileo testnet is the storage transport. We do our own AES-256-GCM
// (authenticated) encryption before upload, so a tampered blob fails to decrypt
// loudly — the SDK's built-in AES is confidentiality-only, with no integrity.
const RPC = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = process.env.OG_STORAGE_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
const PK = process.env.EVM_PRIVATE_KEY ?? "";

function signer(): ethers.Wallet {
  if (!PK) throw new Error("EVM_PRIVATE_KEY is not set");
  return new ethers.Wallet(PK, new ethers.JsonRpcProvider(RPC));
}
const indexer = () => new Indexer(INDEXER_RPC);

// Bound a 0G SDK call so a hung indexer/RPC can't stall the request forever.
// (The SDK exposes no AbortSignal, so we race it against a timeout.)
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// ── AES-256-GCM (authenticated encryption) ──────────────
// Blob layout: iv(12) || authTag(16) || ciphertext.
export function gcmEncrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([iv, tag, ct]));
}

export function gcmDecrypt(key: Uint8Array, blob: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const buf = Buffer.from(blob);
  if (buf.length < 28) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // .final() throws if the auth tag does not verify (tampered blob or wrong key).
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

export type PutResult = { rootHash: string; txHash: string };

/** AES-256-GCM encrypt (when a key is given), then upload to 0G Storage. */
export async function putData(
  data: string | Uint8Array,
  opts?: { key?: Uint8Array },
): Promise<PutResult> {
  const plain = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const bytes = opts?.key ? gcmEncrypt(opts.key, plain) : plain;
  const mem = new MemData(bytes);
  const [, treeErr] = await mem.merkleTree();
  if (treeErr !== null) throw new Error(`merkleTree: ${treeErr}`);

  const retry = { Retries: 3, Interval: 5, MaxGasPrice: 0 };
  const uploadTimeoutMs = Number(process.env.OG_UPLOAD_TIMEOUT_MS ?? 120000);
  const [tx, err] = await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indexer().upload(mem, RPC, signer() as any, undefined, retry),
    uploadTimeoutMs,
    "0G upload",
  );
  if (err !== null) throw new Error(`upload: ${err}`);
  return "rootHash" in tx
    ? { rootHash: tx.rootHash, txHash: tx.txHash }
    : { rootHash: tx.rootHashes[0], txHash: tx.txHashes[0] };
}

/** Download by root hash, then AES-256-GCM decrypt + verify (when a key is given). */
export async function getData(rootHash: string, opts?: { key?: Uint8Array }): Promise<Uint8Array> {
  const timeoutMs = Number(process.env.OG_TIMEOUT_MS ?? 45000);
  const [blob, err] = await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indexer().downloadToBlob(rootHash, { proof: true } as any),
    timeoutMs,
    "0G download",
  );
  if (err !== null) throw new Error(`download: ${err}`);
  const raw = new Uint8Array(await blob.arrayBuffer());
  return opts?.key ? gcmDecrypt(opts.key, raw) : raw;
}

/** Random 32-byte AES-256 key. */
export function newAesKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}
