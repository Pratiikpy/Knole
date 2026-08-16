import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { ensureWalletCaptured } from "./auth";

const { users } = schema;

// KnoleCommitment (B2) server view: the contract lives on Aristotle mainnet and settles against
// the JournalDayAnchor with no off-chain oracle. The server only ENCODES calldata and reads state;
// every transaction is signed by the USER's own wallet - the stake never touches our keys.

const COMMITMENT_ADDRESS =
  process.env.COMMITMENT_ADDRESS ?? "0x76C30B86A483E66e8F63264da13A18caf09fCE95";
const RPC =
  process.env.OG_NETWORK === "testnet" ? "https://evmrpc-testnet.0g.ai" : "https://evmrpc.0g.ai";
const CHAIN_ID = process.env.OG_NETWORK === "testnet" ? 16602 : 16661;

const ABI = [
  "function commit(uint32 goalDays, uint32 windowDays, uint8 dest) payable returns (uint256)",
  "function coolOff(uint256 id)",
  "function release(uint256 id)",
  "function settle(uint256 id)",
  "function commitmentsOf(address staker) view returns (uint256[])",
  "function commitments(uint256) view returns (address staker, uint96 stake, uint32 goalDays, uint32 startCount, uint64 createdAt, uint64 windowEnd, uint8 dest, uint8 state, uint64 pairId)",
  "function achievedDays(uint256 id) view returns (uint32)",
  "function userFavor() view returns (bool)",
  "function MIN_STAKE() view returns (uint256)",
  "function MAX_STAKE() view returns (uint256)",
  "function GRACE_DAYS() view returns (uint32)",
];

const iface = new ethers.Interface(ABI);
const provider = () => new ethers.JsonRpcProvider(RPC);

export type CommitmentRow = {
  id: string;
  stake: string; // OG, formatted
  goalDays: number;
  achieved: number;
  windowEnd: string; // ISO
  createdAt: string;
  state: "active" | "released" | "settled" | "cancelled";
  coolingOffUntil: string;
  claimableNow: boolean; // goal reached (or grace at window end, or userFavor)
};

export type CommitContext = {
  contract: string;
  chainId: number;
  wallet: string | null;
  minStake: string;
  maxStake: string;
  graceDays: number;
  commitments: CommitmentRow[];
};

const STATE = ["active", "released", "settled", "cancelled"] as const;

export async function commitContext(userId: string): Promise<CommitContext> {
  await ensureWalletCaptured(userId);
  const [u] = await db
    .select({ wallet: users.walletAddress, ck: users.clientKeyAddr })
    .from(users)
    .where(eq(users.id, userId));
  const wallet = u?.wallet || u?.ck || null;

  const p = provider();
  const c = new ethers.Contract(COMMITMENT_ADDRESS, ABI, p);
  const rows: CommitmentRow[] = [];
  if (wallet) {
    const favored: boolean = await c.userFavor().catch(() => false);
    const ids: bigint[] = await c.commitmentsOf(wallet).catch(() => []);
    for (const id of ids.slice(-12)) {
      const cm = await c.commitments(id);
      const achieved = Number(await c.achievedDays(id).catch(() => 0));
      const goal = Number(cm.goalDays);
      const windowEnd = Number(cm.windowEnd) * 1000;
      const now = Date.now();
      const claimableNow =
        STATE[Number(cm.state)] === "active" &&
        (favored || achieved >= goal || (now > windowEnd && achieved + 2 >= goal));
      rows.push({
        id: id.toString(),
        stake: ethers.formatEther(cm.stake),
        goalDays: goal,
        achieved,
        windowEnd: new Date(windowEnd).toISOString(),
        createdAt: new Date(Number(cm.createdAt) * 1000).toISOString(),
        state: STATE[Number(cm.state)] ?? "active",
        coolingOffUntil: new Date((Number(cm.createdAt) + 86_400) * 1000).toISOString(),
        claimableNow,
      });
    }
  }
  const [minStake, maxStake, grace] = await Promise.all([
    c.MIN_STAKE().catch(() => ethers.parseEther("0.05")),
    c.MAX_STAKE().catch(() => ethers.parseEther("100")),
    c.GRACE_DAYS().catch(() => 2n),
  ]);
  return {
    contract: COMMITMENT_ADDRESS,
    chainId: CHAIN_ID,
    wallet,
    minStake: ethers.formatEther(minStake),
    maxStake: ethers.formatEther(maxStake),
    graceDays: Number(grace),
    commitments: rows.reverse(),
  };
}

export function encodeCommit(goalDays: number, windowDays: number): { to: string; data: string } {
  return {
    to: COMMITMENT_ADDRESS,
    // dest 0 = Burn. The charity path stays dormant until a verifiable on-chain charity exists on 0G.
    data: iface.encodeFunctionData("commit", [goalDays, windowDays, 0]),
  };
}

export function encodeAction(
  action: "coolOff" | "release" | "settle",
  id: string,
): { to: string; data: string } {
  return { to: COMMITMENT_ADDRESS, data: iface.encodeFunctionData(action, [BigInt(id)]) };
}
