// Give the seeded demo user a wallet and mint its memory iNFT, so the showcase shows the real
// "Minted · not for sale · view on 0G explorer" card. Run after `npm run seed`; needs
// KNOLE_NFT_ADDRESS + EVM_PRIVATE_KEY. Run: npm run seed:inft
import "dotenv/config";
import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getDemoUserId } from "./engine";
import { mintMemoryINFT, inftStatus } from "./inft";

const { users } = schema;

async function main() {
  const uid = await getDemoUserId();
  const addr = new ethers.Wallet(process.env.EVM_PRIVATE_KEY as string).address;
  await db.update(users).set({ walletAddress: addr }).where(eq(users.id, uid));
  console.log("demo user:", uid, "wallet set:", addr);

  const existing = await inftStatus(uid);
  if (existing) {
    console.log("already minted — token #" + existing.tokenId + " tx " + existing.txHash);
    process.exit(0);
  }
  console.log("minting… (on-chain tx to KnoleMemory on Galileo)");
  const r = await mintMemoryINFT(uid);
  console.log("mint result:", JSON.stringify(r));
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
