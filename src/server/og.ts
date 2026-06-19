import "dotenv/config";
import { MemData, Indexer } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";

// 0G Galileo testnet. Storage = source of truth; ECIES/AES encrypt before upload.
const RPC = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = process.env.OG_STORAGE_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
const PK = process.env.EVM_PRIVATE_KEY ?? "";

function signer(): ethers.Wallet {
  if (!PK) throw new Error("EVM_PRIVATE_KEY is not set");
  return new ethers.Wallet(PK, new ethers.JsonRpcProvider(RPC));
}
const indexer = () => new Indexer(INDEXER_RPC);

export type PutResult = { rootHash: string; txHash: string };

/** Upload raw bytes/string to 0G Storage (in-memory, optionally AES-256 encrypted). */
export async function putData(
  data: string | Uint8Array,
  opts?: { key?: Uint8Array },
): Promise<PutResult> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const mem = new MemData(bytes);
  const [, treeErr] = await mem.merkleTree();
  if (treeErr !== null) throw new Error(`merkleTree: ${treeErr}`);

  const uploadOpts = opts?.key ? { encryption: { type: "aes256" as const, key: opts.key } } : undefined;
  const retry = { Retries: 3, Interval: 5, MaxGasPrice: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tx, err] = await indexer().upload(mem, RPC, signer() as any, uploadOpts, retry);
  if (err !== null) throw new Error(`upload: ${err}`);
  return "rootHash" in tx
    ? { rootHash: tx.rootHash, txHash: tx.txHash }
    : { rootHash: tx.rootHashes[0], txHash: tx.txHashes[0] };
}

/** Download + (optionally) decrypt by root hash. */
export async function getData(rootHash: string, opts?: { key?: Uint8Array }): Promise<Uint8Array> {
  const dl = opts?.key
    ? { proof: true, decryption: { symmetricKey: opts.key } }
    : { proof: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [blob, err] = await indexer().downloadToBlob(rootHash, dl as any);
  if (err !== null) throw new Error(`download: ${err}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Random 32-byte AES-256 key. */
export function newAesKey(): Uint8Array {
  return ethers.randomBytes(32);
}
