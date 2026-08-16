// Deploy JournalDayAnchor v2 (historical, as-of-deadline day counts) + KnoleCommitment v2 to 0G
// mainnet, with on-chain sanity gates before either address is promoted.
import { readFileSync } from "fs";
import { ethers } from "ethers";
import "dotenv/config";

const RPC = "https://evmrpc.0g.ai";
const CHARITY = "0x000000000000000000000000000000000000dEaD";
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(process.env.OG_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY, provider);
console.log("deployer:", wallet.address, "| balance:", ethers.formatEther(await provider.getBalance(wallet.address)));

const load = (n) => JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8"));
async function deploy(name, args) {
  const a = load(name);
  const f = new ethers.ContractFactory(a.abi, a.bytecode.object, wallet);
  const c = await f.deploy(...args);
  const hash = c.deploymentTransaction().hash;
  console.log(`${name} deploy tx:`, hash);
  let r = null;
  for (let i = 0; i < 60 && !r; i++) {
    r = await provider.getTransactionReceipt(hash).catch(() => null);
    if (!r) await new Promise((res) => setTimeout(res, 3000));
  }
  if (!r || r.status !== 1) throw new Error(`${name} deploy not confirmed`);
  console.log(`${name}:`, r.contractAddress);
  return { addr: r.contractAddress, abi: a.abi, tx: hash };
}

const anchor = await deploy("JournalDayAnchor", []);
const cmt = await deploy("KnoleCommitment", [anchor.addr, CHARITY]);

// ── sanity gates on the live contracts ──
const A = new ethers.Contract(anchor.addr, anchor.abi, wallet);
const C = new ethers.Contract(cmt.addr, cmt.abi, provider);
console.log("commitment.anchor wired:", (await C.anchor()).toLowerCase() === anchor.addr.toLowerCase());
console.log("charity:", await C.charity(), "| userFavor false:", (await C.userFavor()) === false);
console.log("MIN_STAKE:", ethers.formatEther(await C.MIN_STAKE()), "| GRACE_DAYS:", await C.GRACE_DAYS());

// prove the historical read works on-chain: record a day, then query as-of yesterday vs today
const probe = wallet.address;
const tx = await A.recordDay(probe);
await tx.wait();
const today = await A.currentDay();
const cToday = await A.countAtDay(probe, today);
const cYesterday = await A.countAtDay(probe, today - 1n);
const live = await A.journaledDayCount(probe);
console.log(`recordDay tx: ${tx.hash}`);
console.log(`live count: ${live} | countAtDay(today): ${cToday} | countAtDay(yesterday): ${cYesterday}`);
console.log("historical read correct:", live === 1n && cToday === 1n && cYesterday === 0n);
console.log("\nANCHOR_V2=" + anchor.addr);
console.log("COMMITMENT_V2=" + cmt.addr);
