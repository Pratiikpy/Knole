// Register Knole on 0G's canonical ERC-8004 Identity Registry (mainnet), with sanity gates.
import { ethers } from "ethers";
import "dotenv/config";

const RPC = "https://evmrpc.0g.ai";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const CARD = "https://www.knole.me/.well-known/agent-card.json";

const ABI = [
  "function register(string agentURI) external returns (uint256 agentId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(
  process.env.OG_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY,
  provider,
);
console.log("registrant:", wallet.address);

// The card must be LIVE and valid before the URI goes on-chain.
const res = await fetch(CARD);
if (!res.ok) throw new Error(`agent card not live: ${res.status}`);
const card = await res.json();
if (!card.skills?.length) throw new Error("agent card has no skills");
console.log("card live:", card.name, "|", card.skills[0].id);

const c = new ethers.Contract(REGISTRY, ABI, wallet);
const tx = await c["register(string)"](CARD);
console.log("register tx:", tx.hash);
let rcpt = null;
for (let i = 0; i < 40 && !rcpt; i++) {
  rcpt = await provider.getTransactionReceipt(tx.hash).catch(() => null);
  if (!rcpt) await new Promise((r) => setTimeout(r, 3000));
}
if (!rcpt || rcpt.status !== 1) throw new Error("registration not confirmed");
const iface = new ethers.Interface(ABI);
let agentId = null;
for (const log of rcpt.logs) {
  try {
    const parsed = iface.parseLog(log);
    if (parsed?.name === "Registered") agentId = parsed.args.agentId.toString();
  } catch {
    /* not ours */
  }
}
console.log("agentId:", agentId);
console.log(
  "owner check:",
  (await c.ownerOf(agentId)).toLowerCase() === wallet.address.toLowerCase(),
);
console.log("tokenURI:", await c.tokenURI(agentId));
console.log(`\nAGENT_ID=${agentId}`);
console.log(`explorer: https://chainscan.0g.ai/tx/${tx.hash}`);
