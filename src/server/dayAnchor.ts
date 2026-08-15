import "dotenv/config";
import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { contractAddress, signerFor } from "./og";
import { background } from "./background";
import { ensureWalletCaptured } from "./auth";

const { users } = schema;

// JournalDayAnchor — the on-chain proof-of-journaling day counter (idempotent per UTC day). Written
// on entry save for wallet-linked users; contracts (KnoleCommitment) settle against the count.
const ABI = [
  "function recordDay(address user)",
  "function hasJournaledToday(address user) view returns (bool)",
  "function journaledDayCount(address user) view returns (uint32)",
];

const ANCHOR_ADDRESS = contractAddress("JOURNAL_DAY_ANCHOR");

export function dayAnchorConfigured(): boolean {
  return !!ANCHOR_ADDRESS && !!process.env.EVM_PRIVATE_KEY;
}

function anchor(): ethers.Contract {
  return new ethers.Contract(ANCHOR_ADDRESS, ABI, signerFor());
}

/**
 * Record that this user journaled today (their user-owned wallet is the on-chain identity).
 * Skips silently for guests/no-wallet users and when already recorded — the view check first keeps
 * the common repeat-entry case gas-free; the contract stays idempotent regardless.
 */
export async function recordJournaledDay(userId: string): Promise<void> {
  if (!dayAnchorConfigured()) return;
  await ensureWalletCaptured(userId); // heal a lost login-time capture race
  const found = await db
    .select({ wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const wallet = found[0]?.wallet;
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return;

  const c = anchor();
  if (await c.hasJournaledToday(wallet)) return;
  const tx = await c.recordDay(wallet);
  await tx.wait();
  console.log(
    `day-anchor: recorded ${wallet} (${await c.journaledDayCount(wallet)} days) tx=${tx.hash}`,
  );
}

/** Fire-and-forget wrapper for the entry-save path. */
export function recordJournaledDayBg(userId: string): void {
  background(recordJournaledDay(userId), "journalDayAnchor");
}
