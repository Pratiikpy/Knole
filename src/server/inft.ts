import { ethers } from "ethers";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { putData } from "./og";
import { keyForUser, retrieveIdentityMemories } from "./engine";

const { users, reflectionArtifacts } = schema;

// KnoleMemory iNFT (ERC-7857 spirit). The user mints their evolving memory/persona as a token they
// OWN: an encrypted snapshot is stored on 0G Storage (the per-user key encrypts it), and the token
// records only the storage root + a hash. Mint + evolve need NO oracle (the oracle in the full spec is
// only for re-encrypting on a sale — which Knole deliberately never does). Ready the moment a deployed
// KnoleMemory contract address is supplied (KNOLE_NFT_ADDRESS); honest "not configured" until then.

const NFT_ADDRESS = process.env.KNOLE_NFT_ADDRESS ?? "";
const RPC = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const PK = process.env.EVM_PRIVATE_KEY ?? "";

const ABI = [
  "function mint(address to, string encryptedURI, bytes32 dataRoot, bytes32 metadataHash) returns (uint256)",
  "function evolve(uint256 tokenId, string newURI, bytes32 newRoot, bytes32 newHash)",
  "event Minted(address indexed owner, uint256 indexed tokenId, bytes32 dataRoot)",
];

export function inftConfigured(): boolean {
  return !!NFT_ADDRESS && !!PK;
}

function contract(): ethers.Contract {
  const wallet = new ethers.Wallet(PK, new ethers.JsonRpcProvider(RPC));
  return new ethers.Contract(NFT_ADDRESS, ABI, wallet);
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
  const { rootHash } = await putData(json, { key }); // encrypted under the per-user key
  const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(json));
  const uri = `0g://${rootHash}`;

  const existing = await inftStatus(userId);
  const c = contract();

  if (existing) {
    const tx = await c.evolve(existing.tokenId, uri, rootHash, metadataHash);
    const rcpt = await tx.wait();
    const rec: INFTRecord = {
      tokenId: existing.tokenId,
      txHash: rcpt?.hash ?? tx.hash,
      root: rootHash,
      version: existing.version + 1,
      mintedAt: existing.mintedAt,
    };
    await db
      .insert(reflectionArtifacts)
      .values({ userId, type: "pattern", threadKey: "inft", content: rec });
    return rec;
  }

  const tx = await c.mint(wallet, uri, rootHash, metadataHash);
  const rcpt = await tx.wait();
  let tokenId = "1";
  try {
    for (const log of rcpt?.logs ?? []) {
      const parsed = c.interface.parseLog(log);
      if (parsed?.name === "Minted") {
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
  };
  await db
    .insert(reflectionArtifacts)
    .values({ userId, type: "pattern", threadKey: "inft", content: rec });
  return rec;
}
