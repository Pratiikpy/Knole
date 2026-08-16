import { ethers } from "ethers";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { putData, signerFor, providerFor, contractAddress, NET_NAME, OG_NET } from "./og";
import { keyForUser, retrieveIdentityMemories } from "./engine";
import { ensureWalletCaptured } from "./auth";

const { users, reflectionArtifacts } = schema;

// KnoleMemory iNFT (ERC-7857 spirit). The user mints their evolving memory/persona as a token they
// OWN: an encrypted snapshot is stored on 0G Storage (the per-user key encrypts it), and the token
// records only the storage root + a hash. Mint + evolve need NO oracle (the oracle in the full spec is
// only for re-encrypting on a sale — which Knole deliberately never does). Ready the moment a deployed
// KnoleMemory contract address is supplied — per-network via KNOLE_NFT_ADDRESS_MAINNET / _TESTNET
// (or the legacy bare KNOLE_NFT_ADDRESS); honest "not configured" until then.

const NFT_ADDRESS = contractAddress("KNOLE_NFT_ADDRESS");
const PK = process.env.EVM_PRIVATE_KEY ?? "";

// The genuine ERC-7857 (KnoleAgenticID): the token carries encrypted IntelligentData (a pointer to
// the AES-256-GCM-encrypted snapshot on 0G Storage + its Merkle-root hash). Minted straight to the
// USER's own wallet — server-sponsored via iMintWithRole (owner = the user, never a central wallet),
// or client-signed via the public iMint from the user's Privy wallet.
const ABI = [
  "function iMint(address to, (string dataDescription, bytes32 dataHash)[] datas) payable returns (uint256)",
  "function iMintWithRole(address to, (string dataDescription, bytes32 dataHash)[] datas) returns (uint256)",
  "function evolve(uint256 tokenId, (string dataDescription, bytes32 dataHash)[] datas)",
  "function getIntelligentDatas(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

export function inftConfigured(): boolean {
  return !!NFT_ADDRESS && !!PK;
}

// Minted on the primary network (the contract address is resolved per-network); the iNFT record notes
// which chain so the token can always be looked up on the right one.
function contract(): ethers.Contract {
  return new ethers.Contract(NFT_ADDRESS, ABI, signerFor());
}

type Snapshot = {
  v: 1;
  mintedAt: string;
  identity: { type: string; content: string }[];
  throughline: string;
  stats: { entries: number; days: number };
  empty: boolean;
};

/** The durable "who you are" snapshot that the iNFT carries — identity memories + the latest essence. */
export async function memorySnapshot(userId: string): Promise<Snapshot> {
  const identity = await retrieveIdentityMemories(userId, 24);
  const mRows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key IN ('essence_yearly', 'essence_monthly') AND superseded_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  let throughline = "";
  if (mRows[0]) {
    const c = mRows[0].content as { throughline?: string; essence?: string };
    throughline = c?.throughline || c?.essence || "";
  }
  const stat = (await db.execute(sql`
    SELECT count(*) AS c, count(DISTINCT date_trunc('day', created_at)) AS d
    FROM entries WHERE user_id = ${userId}
  `)) as unknown as Record<string, unknown>[];
  const entries = Number(stat[0]?.c ?? 0);
  const days = Number(stat[0]?.d ?? 0);
  return {
    v: 1,
    mintedAt: new Date().toISOString(),
    identity: identity.map((m) => ({ type: m.type, content: m.content })),
    throughline,
    stats: { entries, days },
    empty: identity.length === 0 && entries < 2,
  };
}

export type INFTRecord = {
  tokenId: string;
  txHash: string;
  root: string;
  version: number;
  mintedAt: string;
  network?: string;
  /** The contract the token lives on. Records without it predate the v1.1 redeploy and are stale. */
  contract?: string;
};

export async function inftStatus(userId: string): Promise<INFTRecord | null> {
  const rows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key = 'inft' ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  return rows[0] ? (rows[0].content as INFTRecord) : null;
}

/** Mint (or evolve, if already minted) the user's memory iNFT to their own wallet. */
export async function mintMemoryINFT(userId: string): Promise<INFTRecord | { error: string }> {
  if (!inftConfigured()) return { error: "not-configured" };
  await ensureWalletCaptured(userId); // heal a lost login-time capture race before deciding no-wallet
  const [u] = await db
    .select({ wallet: users.walletAddress, clientKey: users.clientKeyAddr })
    .from(users)
    .where(eq(users.id, userId));
  // Prefer the synced wallet; fall back to the client-encryption wallet (set when the user sealed
  // their 0G copy to it) — both are the user's own address, and it's who the token is minted to.
  const wallet = u?.wallet || u?.clientKey;
  if (!wallet) return { error: "no-wallet" };
  const snap = await memorySnapshot(userId);
  if (snap.empty) return { error: "no-memory" };

  const json = JSON.stringify(snap);
  const key = keyForUser(userId);
  const { rootHash } = await putData(json, { key }); // encrypted under the per-user key → 0G Storage
  const uri = `0g://${rootHash}`;
  // ERC-7857 IntelligentData: the on-chain dataHash IS the 0G Storage Merkle root of the encrypted
  // blob (the plaintext never touches the chain; only a key the user controls decrypts it).
  const datas = [{ dataDescription: uri, dataHash: rootHash }];

  const existing = await inftStatus(userId);
  const c = contract();

  // Only evolve a token that lives on the CURRENT network AND the current contract. A record from
  // another chain, or minted on a prior deployment (e.g. v1.0 before the raw-transfer fix — records
  // without a contract tag), can't be evolved here — fall through to mint fresh on this contract.
  if (
    existing &&
    (existing.network ?? "testnet") === NET_NAME &&
    (existing.contract ?? "").toLowerCase() === NFT_ADDRESS.toLowerCase()
  ) {
    const tx = await c.evolve(existing.tokenId, datas);
    const rcpt = await tx.wait();
    const rec: INFTRecord = {
      tokenId: existing.tokenId,
      txHash: rcpt?.hash ?? tx.hash,
      root: rootHash,
      version: existing.version + 1,
      mintedAt: existing.mintedAt,
      network: existing.network ?? NET_NAME,
      contract: NFT_ADDRESS,
    };
    await db
      .insert(reflectionArtifacts)
      .values({ userId, type: "pattern", threadKey: "inft", content: rec });
    return rec;
  }

  // Server-sponsored mint straight to the user's own wallet (owner = the user). The client-signed
  // path (the user's Privy wallet calling the public iMint) is offered in the UI as the primary flow.
  const tx = await c.iMintWithRole(wallet, datas);
  const rcpt = await tx.wait();
  let tokenId = "1";
  try {
    for (const log of rcpt?.logs ?? []) {
      const parsed = c.interface.parseLog(log);
      // ERC-721 mint = Transfer from the zero address.
      if (parsed?.name === "Transfer" && parsed.args.from === ethers.ZeroAddress) {
        tokenId = String(parsed.args.tokenId);
        break;
      }
    }
  } catch {
    /* fall back to "1" if the event can't be parsed */
  }
  const rec: INFTRecord = {
    tokenId,
    txHash: rcpt?.hash ?? tx.hash,
    root: rootHash,
    version: 1,
    mintedAt: new Date().toISOString(),
    network: NET_NAME,
    contract: NFT_ADDRESS,
  };
  await db
    .insert(reflectionArtifacts)
    .values({ userId, type: "pattern", threadKey: "inft", content: rec });
  return rec;
}

// ── Self-custody mint: the USER's wallet calls the public iMint — they are minter AND owner ──────

export type ClientMintPrep =
  | { to: string; data: string; wallet: string; chainId: number }
  | { error: string };

/** Build everything the user's wallet needs to sign its own mint: snapshot → encrypt → 0G Storage,
 * then the encoded iMint(wallet, datas) calldata. The server never signs this path. */
export async function prepareClientMint(userId: string): Promise<ClientMintPrep> {
  if (!inftConfigured()) return { error: "not-configured" };
  await ensureWalletCaptured(userId);
  const [u] = await db
    .select({ wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId));
  // ONLY the Privy-verified wallet. clientKeyAddr is self-declared at encryption enrollment with no
  // proof of control, so trusting it here would let anyone claim a stranger's mint as their own.
  const wallet = u?.wallet;
  if (!wallet) return { error: "no-wallet" };
  const existing = await inftStatus(userId);
  if (
    existing &&
    (existing.network ?? "testnet") === NET_NAME &&
    (existing.contract ?? "").toLowerCase() === NFT_ADDRESS.toLowerCase()
  ) {
    return { error: "already-minted" };
  }
  const snap = await memorySnapshot(userId);
  if (snap.empty) return { error: "no-memory" };
  const { rootHash } = await putData(JSON.stringify(snap), { key: keyForUser(userId) });
  const datas = [{ dataDescription: `0g://${rootHash}`, dataHash: rootHash }];
  const data = new ethers.Interface(ABI).encodeFunctionData("iMint", [wallet, datas]);
  return { to: NFT_ADDRESS, data, wallet, chainId: OG_NET.chainId };
}

/** Verify the user's self-signed mint on-chain and store the record. The chain is the source of
 * truth: we read the receipt, the Transfer-from-zero tokenId, and the token's own data. */
export async function confirmClientMint(
  userId: string,
  txHash: string,
): Promise<INFTRecord | { error: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { error: "bad-tx" };
  const provider = providerFor();
  let receipt: ethers.TransactionReceipt | null = null;
  for (let i = 0; i < 12 && !receipt; i++) {
    receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
    if (!receipt) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!receipt || receipt.status !== 1) return { error: "tx-not-found" };
  if ((receipt.to ?? "").toLowerCase() !== NFT_ADDRESS.toLowerCase())
    return { error: "wrong-contract" };

  const iface = new ethers.Interface(ABI);
  let tokenId = "";
  let owner = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "Transfer" && parsed.args.from === ethers.ZeroAddress) {
        tokenId = String(parsed.args.tokenId);
        owner = String(parsed.args.to);
        break;
      }
    } catch {
      /* not ours */
    }
  }
  if (!tokenId) return { error: "no-mint-event" };
  const [u] = await db
    .select({ wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId));
  const expected = (u?.wallet ?? "").toLowerCase();
  if (!expected || owner.toLowerCase() !== expected) return { error: "owner-mismatch" };

  // One token, one account: without this, several accounts could each "confirm" the same public
  // mint and every one of them would read as an iNFT holder (which unlocks paid entitlements).
  const taken = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts
    WHERE thread_key = 'inft' AND user_id <> ${userId}
      AND content->>'tokenId' = ${tokenId}
      AND lower(content->>'contract') = ${NFT_ADDRESS.toLowerCase()}
    LIMIT 1
  `)) as unknown as unknown[];
  if (taken.length) return { error: "already-claimed" };

  const c = contract();
  const datas = (await c.getIntelligentDatas(tokenId)) as { dataDescription: string }[];
  const root = (datas[0]?.dataDescription ?? "").replace(/^0g:\/\//, "");
  const rec: INFTRecord = {
    tokenId,
    txHash,
    root,
    version: 1,
    mintedAt: new Date().toISOString(),
    network: NET_NAME,
    contract: NFT_ADDRESS,
  };
  await db
    .insert(reflectionArtifacts)
    .values({ userId, type: "pattern", threadKey: "inft", content: rec });
  return rec;
}
