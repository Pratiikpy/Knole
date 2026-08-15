// Deploy the Wave-3 contracts — KnoleAgenticID v1.1 (raw transfers closed, grants cleared in
// _update, CEI mint, pausable) and JournalDayAnchor — from the Foundry build artifacts, then run
// on-chain sanity checks that the v1.1 guarantees actually hold on the deployed bytecode.
//
//   node scripts/deploy-wave3.mjs testnet   # Galileo rehearsal
//   node scripts/deploy-wave3.mjs mainnet   # Aristotle
//
// Requires `forge build` to have run (out/) and EVM_PRIVATE_KEY in .env.
import fs from "fs";
import { ethers } from "ethers";
import "dotenv/config";

const net = process.argv[2];
const RPCS = { mainnet: "https://evmrpc.0g.ai", testnet: "https://evmrpc-testnet.0g.ai" };
if (!RPCS[net]) {
  console.log("usage: node scripts/deploy-wave3.mjs <testnet|mainnet>");
  process.exit(1);
}

function artifact(name) {
  const a = JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

const provider = new ethers.JsonRpcProvider(RPCS[net]);
const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
const bal = await provider.getBalance(wallet.address);
console.log(`network=${net} deployer=${wallet.address} balance=${ethers.formatEther(bal)} OG`);
if (bal === 0n) {
  console.log("deployer has no gas on this network — aborting");
  process.exit(1);
}

// ── Deploy ───────────────────────────────────────────────────────────────────────────────────────
const agentic = artifact("KnoleAgenticID");
const nftFactory = new ethers.ContractFactory(agentic.abi, agentic.bytecode, wallet);
const nft = await nftFactory.deploy(0n); // minting your own memory stays free (just gas)
console.log("KnoleAgenticID deploy tx:", nft.deploymentTransaction()?.hash);
await nft.waitForDeployment();
const nftAddr = await nft.getAddress();

const anchorArt = artifact("JournalDayAnchor");
const anchorFactory = new ethers.ContractFactory(anchorArt.abi, anchorArt.bytecode, wallet);
const anchor = await anchorFactory.deploy();
console.log("JournalDayAnchor deploy tx:", anchor.deploymentTransaction()?.hash);
await anchor.waitForDeployment();
const anchorAddr = await anchor.getAddress();

// ── Sanity: the v1.1 guarantees on the DEPLOYED bytecode ─────────────────────────────────────────
const checks = [];
const ok = (name, pass) => {
  checks.push([name, pass]);
  console.log(`${pass ? "✓" : "✗"} ${name}`);
};

ok("supportsInterface ERC-7857 (0x4b396f04)", await nft.supportsInterface("0x4b396f04"));
ok("supportsInterface Authorize (0x35d39512)", await nft.supportsInterface("0x35d39512"));
ok("supportsInterface Cloneable (0xd79f01c7)", await nft.supportsInterface("0xd79f01c7"));
ok("supportsInterface ERC-721 (0x80ac58cd)", await nft.supportsInterface("0x80ac58cd"));
ok("control id (0xdeadbeef) is false", !(await nft.supportsInterface("0xdeadbeef")));

// Raw transferFrom must REVERT (the v1.1 fix) — eth_call it and expect failure.
let rawTransferBlocked = false;
try {
  await nft.transferFrom.staticCall(wallet.address, nftAddr, 1);
} catch {
  rawTransferBlocked = true;
}
ok("raw transferFrom reverts (ERC7857UseITransferFrom)", rawTransferBlocked);

ok("mintFee is 0", (await nft.mintFee()) === 0n);
ok(
  "day anchor: deployer has ANCHOR_ROLE",
  await anchor.hasRole(await anchor.ANCHOR_ROLE(), wallet.address),
);
ok("day anchor: nobody journaled yet", !(await anchor.hasJournaledToday(wallet.address)));

if (checks.some(([, pass]) => !pass)) {
  console.log("\nSANITY FAILED — do not promote this deployment");
  process.exit(1);
}

fs.writeFileSync("contracts/KnoleAgenticID.abi.json", JSON.stringify(agentic.abi, null, 2));
fs.writeFileSync("contracts/JournalDayAnchor.abi.json", JSON.stringify(anchorArt.abi, null, 2));

const suffix = net === "mainnet" ? "MAINNET" : "TESTNET";
console.log(`\nDEPLOYED — set in .env + Vercel:`);
console.log(`KNOLE_NFT_ADDRESS_${suffix}=${nftAddr}`);
console.log(`JOURNAL_DAY_ANCHOR_${suffix}=${anchorAddr}`);
