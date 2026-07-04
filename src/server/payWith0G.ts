import { ethers } from "ethers";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { addCredits, getCredits } from "./billing";
import { providerFor } from "./og";

const { reflectionArtifacts } = schema;

// Pay-with-0G (Part 7C) — top up credits by sending 0G to the treasury from the wallet you already
// have, then claiming the transaction. The claim is verified fully on-chain (confirmed, to = treasury,
// value) and deduped by tx hash, so a transfer can only ever be credited once. No card, no middleman —
// the same wallet that holds your memory iNFT funds your usage. Verified on the primary network.

const TREASURY = (
  process.env.ZG_TREASURY_ADDRESS ??
  process.env.EVM_WALLET_ADDRESS ??
  ""
).toLowerCase();
// Wei of 0G per credit. Default 1e13 (0.00001 0G/credit) — testnet-nominal; tune for mainnet pricing.
const RATE_WEI = BigInt(process.env.ZG_CREDIT_RATE_WEI ?? "10000000000000");

export function payWith0GConfigured(): boolean {
  return !!TREASURY;
}

export function treasuryInfo(): { address: string; weiPerCredit: string; configured: boolean } {
  return { address: TREASURY, weiPerCredit: RATE_WEI.toString(), configured: !!TREASURY };
}

export type ClaimResult =
  | { ok: true; credited: number; credits: number }
  | { ok: false; reason: string };

/** Verify a 0G transfer to the treasury on-chain and credit the sender. Idempotent per tx hash. */
export async function claimOgPayment(userId: string, txHash: string): Promise<ClaimResult> {
  if (!TREASURY) return { ok: false, reason: "not_configured" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: "bad_hash" };

  // Dedupe globally — a given tx can only ever be claimed once, by anyone.
  const dup = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts
    WHERE thread_key = 'og-credit' AND content->>'txHash' = ${txHash} LIMIT 1
  `)) as unknown as unknown[];
  if (dup[0]) return { ok: false, reason: "already_claimed" };

  const provider = providerFor();
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!tx || !receipt || receipt.status !== 1) return { ok: false, reason: "not_confirmed" };
  if ((tx.to ?? "").toLowerCase() !== TREASURY) return { ok: false, reason: "wrong_recipient" };
  if (tx.value <= 0n) return { ok: false, reason: "zero_value" };

  const credited = Number(tx.value / RATE_WEI);
  if (credited < 1) return { ok: false, reason: "too_small" };

  // Record the claim first (the dedupe key), then credit.
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "state",
    threadKey: "og-credit",
    content: { txHash, credited, from: tx.from },
    sources: {},
  });
  await addCredits(userId, credited);
  return { ok: true, credited, credits: await getCredits(userId) };
}
