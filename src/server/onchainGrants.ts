import "dotenv/config";
import { ethers } from "ethers";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { contractAddress, providerFor, signerFor, NET_NAME, OG_NET } from "./og";
import { inftStatus } from "./inft";

const { users, reflectionArtifacts } = schema;

// On-chain portable-identity grants — the ERC-7857 Authorize extension, for real. The token OWNER
// (the user's own wallet) signs authorizeUsage/revokeAuthorization; the server never can, by design.
// The server's role is exactly three things: tell the client what to sign (encoded calldata), read
// the live grant list from the chain, and sponsor a dust of gas so a fresh embedded wallet can sign
// its first grant without buying tokens.

const NFT_ADDRESS = contractAddress("KNOLE_NFT_ADDRESS");
const IFACE = new ethers.Interface([
  "function authorizeUsage(uint256 tokenId, address user)",
  "function revokeAuthorization(uint256 tokenId, address user)",
  "function authorizedUsersOf(uint256 tokenId) view returns (address[])",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

const GAS_SPONSOR_AMOUNT = ethers.parseEther("0.002"); // covers several grant txs
const GAS_MIN_BALANCE = ethers.parseEther("0.0005");

export type OnchainGrantContext =
  | { available: false; reason: "no-wallet" | "no-token" }
  | { available: true; tokenId: string; contract: string; chainId: number; wallet: string };

/** Whether this user can sign on-chain grants: needs their wallet + an iNFT on the current contract. */
export async function onchainGrantContext(userId: string): Promise<OnchainGrantContext> {
  const [u] = await db
    .select({ wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.wallet) return { available: false, reason: "no-wallet" };
  const rec = await inftStatus(userId);
  const onCurrent =
    rec &&
    (rec.network ?? "testnet") === NET_NAME &&
    (rec.contract ?? "").toLowerCase() === NFT_ADDRESS.toLowerCase();
  if (!onCurrent) return { available: false, reason: "no-token" };
  return {
    available: true,
    tokenId: rec.tokenId,
    contract: NFT_ADDRESS,
    chainId: OG_NET.chainId,
    wallet: u.wallet,
  };
}

/** Encode the owner-signed call for the client — keeps ethers out of the client bundle. */
export async function encodeGrantCall(
  userId: string,
  args: { grantee: string; revoke?: boolean },
): Promise<{ to: string; data: string } | { error: string }> {
  if (!ethers.isAddress(args.grantee)) return { error: "bad-address" };
  const ctx = await onchainGrantContext(userId);
  if (!ctx.available) return { error: ctx.reason };
  const fn = args.revoke ? "revokeAuthorization" : "authorizeUsage";
  return { to: ctx.contract, data: IFACE.encodeFunctionData(fn, [ctx.tokenId, args.grantee]) };
}

/** The live grant list, read from the chain — the registry IS the contract, not our database. */
export async function listOnchainGrants(
  userId: string,
): Promise<{ grants: string[]; tokenId?: string }> {
  const ctx = await onchainGrantContext(userId);
  if (!ctx.available) return { grants: [] };
  const c = new ethers.Contract(ctx.contract, IFACE, providerFor());
  const grants = (await c.authorizedUsersOf(ctx.tokenId)) as string[];
  return { grants: [...grants], tokenId: ctx.tokenId };
}

/**
 * Send a dust of gas to the user's wallet so their first grant tx can be signed without buying 0G.
 * Once per day per user, only when the balance is actually short. Self-custody stays intact — the
 * server funds gas, never signs.
 */
export async function sponsorGrantGas(
  userId: string,
): Promise<{ sponsored: boolean; balance: string }> {
  const ctx = await onchainGrantContext(userId);
  if (!ctx.available) return { sponsored: false, balance: "0" };
  const provider = providerFor();
  const bal = await provider.getBalance(ctx.wallet);
  if (bal >= GAS_MIN_BALANCE) return { sponsored: false, balance: ethers.formatEther(bal) };

  const recent = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key = 'gas-sponsor' AND created_at > now() - interval '1 day' LIMIT 1
  `)) as unknown as unknown[];
  if (recent.length > 0) return { sponsored: false, balance: ethers.formatEther(bal) };

  const tx = await signerFor().sendTransaction({
    to: ctx.wallet,
    value: GAS_SPONSOR_AMOUNT,
  });
  await tx.wait();
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "pattern",
    threadKey: "gas-sponsor",
    content: { tx: tx.hash, amount: ethers.formatEther(GAS_SPONSOR_AMOUNT) },
  });
  const after = await provider.getBalance(ctx.wallet);
  return { sponsored: true, balance: ethers.formatEther(after) };
}
