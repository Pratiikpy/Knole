import "dotenv/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MemData, Indexer } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { signerProvider } from "./signerProvider";

// 0G is the storage transport. We do our own AES-256-GCM (authenticated) encryption before upload,
// so a tampered blob fails to decrypt loudly — the SDK's built-in AES is confidentiality-only.
//
// Network is one switch: OG_NETWORK=mainnet selects the Aristotle mainnet config (verified values),
// else the Galileo testnet (the safe default). Any single endpoint can still be overridden by its own
// env var. Chain IDs are NOT hardcoded into calls — verifyChain() reads eth_chainId at runtime and
// warns on mismatch (the testnet has shown 16601/16602 in different docs).
export type NetName = "mainnet" | "testnet";
const NETWORKS = {
  mainnet: {
    name: "mainnet" as NetName,
    rpc: "https://evmrpc.0g.ai",
    indexer: "https://indexer-storage-turbo.0g.ai",
    explorer: "https://chainscan.0g.ai",
    chainId: 16661,
    flow: "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526",
  },
  testnet: {
    name: "testnet" as NetName,
    rpc: "https://evmrpc-testnet.0g.ai",
    indexer: "https://indexer-storage-testnet-turbo.0g.ai",
    explorer: "https://chainscan-galileo.0g.ai",
    chainId: 16602, // Galileo — updated after the testnet reset (was 16601)
    flow: "",
  },
} as const;
type NetCfg = (typeof NETWORKS)[NetName];

export const NET_NAME: NetName =
  (process.env.OG_NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet";
export const OG_NET: NetCfg = NETWORKS[NET_NAME];
export const OG_EXPLORER = process.env.OG_CHAIN_EXPLORER ?? OG_NET.explorer;

// Fallback network for graceful degradation. Default: when primary is mainnet, fall back to testnet
// so a mainnet RPC hiccup or an unfunded wallet can't hard-fail a user action. OG_FALLBACK=off disables.
const FALLBACK_NAME: NetName | null = (() => {
  const v = (process.env.OG_FALLBACK ?? (NET_NAME === "mainnet" ? "testnet" : "off")).toLowerCase();
  if (v === "off" || v === "") return null;
  const n = v === "mainnet" ? "mainnet" : v === "testnet" ? "testnet" : null;
  return n && n !== NET_NAME ? n : null;
})();

// The explicit OG_RPC_URL / OG_STORAGE_INDEXER overrides apply to the PRIMARY network only; the
// fallback network always uses its canonical endpoints.
function endpointsFor(net: NetCfg): { rpc: string; indexer: string } {
  if (net.name === NET_NAME) {
    return {
      rpc: process.env.OG_RPC_URL ?? net.rpc,
      indexer: process.env.OG_STORAGE_INDEXER ?? net.indexer,
    };
  }
  return { rpc: net.rpc, indexer: net.indexer };
}

// Primary first, then the fallback (if enabled) — the order write/read operations try networks in.
const NET_CHAIN: NetCfg[] = [OG_NET, ...(FALLBACK_NAME ? [NETWORKS[FALLBACK_NAME]] : [])];

const RPC = endpointsFor(OG_NET).rpc; // primary RPC (used by verifyChain)

export function providerFor(net: NetCfg = OG_NET): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(endpointsFor(net).rpc);
}
// Signing goes through the custody seam (env key in dev, KMS-backed Signer in prod) — never a raw key here.
export function signerFor(net: NetCfg = OG_NET): ethers.Signer {
  return signerProvider.signer(providerFor(net));
}
const indexer = (net: NetCfg = OG_NET) => new Indexer(endpointsFor(net).indexer);

/**
 * Resolve a per-network contract address from env: `<PREFIX>_MAINNET` / `<PREFIX>_TESTNET` win, else
 * the bare `<PREFIX>` (legacy single-value). Lets one deploy per chain coexist during the migration.
 */
export function contractAddress(prefix: string, net: NetName = NET_NAME): string {
  return process.env[`${prefix}_${net.toUpperCase()}`] ?? process.env[prefix] ?? "";
}

/**
 * Run a chain operation on the primary network; on an infrastructure failure (RPC unreachable, wallet
 * unfunded, timeout) retry it on the fallback network. Returns the result plus which network served it,
 * so callers can record the chain a write actually landed on. Never silently swallows the final error.
 */
export async function withFallback<T>(
  op: (net: NetCfg) => Promise<T>,
  label: string,
): Promise<{ result: T; network: NetName }> {
  let lastErr: unknown;
  for (const net of NET_CHAIN) {
    try {
      return { result: await op(net), network: net.name };
    } catch (e) {
      lastErr = e;
      if (net !== NET_CHAIN[NET_CHAIN.length - 1]) {
        console.warn(`${label} failed on ${net.name} (${(e as Error).message}); trying fallback…`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed on all networks`);
}

// Verify, once, that the RPC actually serves the network we think it does — a misconfigured RPC
// (a testnet endpoint with OG_NETWORK=mainnet, or vice-versa) would silently write to the wrong
// chain. Warn rather than throw, so a transient RPC hiccup can't take the app down.
let chainChecked = false;
export async function verifyChain(): Promise<{ ok: boolean; chainId: number } | null> {
  if (chainChecked) return null;
  chainChecked = true;
  try {
    const net = await new ethers.JsonRpcProvider(RPC).getNetwork();
    const id = Number(net.chainId);
    if (id !== OG_NET.chainId) {
      console.warn(
        `0G chain mismatch: RPC ${RPC} reports chainId ${id}, expected ${OG_NET.chainId}. Check OG_NETWORK / OG_RPC_URL.`,
      );
      return { ok: false, chainId: id };
    }
    return { ok: true, chainId: id };
  } catch (e) {
    console.warn("0G chain verify skipped:", (e as Error).message);
    return null;
  }
}

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

/**
 * Try each candidate key in turn and return the first that authenticates. Because GCM's auth tag
 * means only the right key yields valid plaintext, this is how a blob written under a since-rotated
 * key version still decrypts (pass the user's keys newest-version-first). Throws if none verify.
 */
export function gcmDecryptAny(keys: Uint8Array[], blob: Uint8Array): Uint8Array {
  if (keys.length === 0) throw new Error("no candidate keys to decrypt with");
  let lastErr: unknown;
  for (const key of keys) {
    try {
      return gcmDecrypt(key, blob);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("decryption failed for all candidate keys");
}

export type PutResult = { rootHash: string; txHash: string; network?: NetName };

/** AES-256-GCM encrypt (when a key is given), then upload to 0G Storage (primary net, fallback on failure). */
export async function putData(
  data: string | Uint8Array,
  opts?: { key?: Uint8Array },
): Promise<PutResult> {
  void verifyChain(); // once-guarded, non-blocking: warn early if the RPC is on the wrong chain
  const plain = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const bytes = opts?.key ? gcmEncrypt(opts.key, plain) : plain;
  const retry = { Retries: 3, Interval: 5, MaxGasPrice: 0 };
  const uploadTimeoutMs = Number(process.env.OG_UPLOAD_TIMEOUT_MS ?? 120000);

  const { result, network } = await withFallback(async (net) => {
    const mem = new MemData(bytes); // rebuilt per attempt — upload consumes the stream
    const [, treeErr] = await mem.merkleTree();
    if (treeErr !== null) throw new Error(`merkleTree: ${treeErr}`);
    const [tx, err] = await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      indexer(net).upload(mem, endpointsFor(net).rpc, signerFor(net) as any, undefined, retry),
      uploadTimeoutMs,
      "0G upload",
    );
    if (err !== null) throw new Error(`upload: ${err}`);
    return "rootHash" in tx
      ? { rootHash: tx.rootHash, txHash: tx.txHash }
      : { rootHash: tx.rootHashes[0], txHash: tx.txHashes[0] };
  }, "0G upload");
  return { ...result, network };
}

/**
 * Download by root hash, then AES-256-GCM decrypt + verify. Pass `key` for a single key, or `keys`
 * for version-aware decryption that tolerates key rotation (tried newest-first); raw bytes if neither.
 */
export async function getData(
  rootHash: string,
  opts?: { key?: Uint8Array; keys?: Uint8Array[] },
): Promise<Uint8Array> {
  const timeoutMs = Number(process.env.OG_TIMEOUT_MS ?? 45000);
  const { result: raw } = await withFallback(async (net) => {
    const [blob, err] = await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      indexer(net).downloadToBlob(rootHash, { proof: true } as any),
      timeoutMs,
      "0G download",
    );
    if (err !== null) throw new Error(`download: ${err}`);
    return new Uint8Array(await blob.arrayBuffer());
  }, "0G download");
  if (opts?.keys) return gcmDecryptAny(opts.keys, raw);
  return opts?.key ? gcmDecrypt(opts.key, raw) : raw;
}

/** Random 32-byte AES-256 key. */
export function newAesKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/**
 * Anchor a 32-byte root on-chain: a self-transaction carrying it in calldata — a cheap, timestamped,
 * tamper-evident commitment to the whole memory state. Change any anchored entry and the recomputed
 * root no longer matches what's on the chain. Returns the confirmed tx hash.
 */
export async function anchorOnChain(rootHex: string): Promise<string> {
  const data = rootHex.startsWith("0x") ? rootHex : `0x${rootHex}`;
  const timeout = Number(process.env.OG_ANCHOR_TIMEOUT_MS ?? 90000);
  const { result } = await withFallback(async (net) => {
    const s = signerFor(net);
    const addr = await s.getAddress(); // async: KMS signers have no sync .address
    const tx = await withTimeout(
      s.sendTransaction({ to: addr, value: 0n, data }),
      timeout,
      "0G anchor tx",
    );
    await withTimeout(tx.wait(), timeout, "0G anchor confirm");
    return tx.hash;
  }, "0G anchor");
  return result;
}
