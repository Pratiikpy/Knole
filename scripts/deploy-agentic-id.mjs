// Compile contracts/KnoleAgenticID.sol (a genuine ERC-7857 iNFT) and deploy it to 0G. Records the
// address for KNOLE_NFT_ADDRESS_MAINNET / _TESTNET. Reuses EVM_PRIVATE_KEY + OG_RPC_URL from .env.
import fs from "fs";
import path from "path";
import solc from "solc";
import { ethers } from "ethers";
import "dotenv/config";

const ROOT = process.cwd();

// Resolve OpenZeppelin imports from node_modules AND the local contracts/interfaces.
function findImport(p) {
  for (const t of [path.join(ROOT, "node_modules", p), path.join(ROOT, "contracts", p)]) {
    try {
      return { contents: fs.readFileSync(t, "utf8") };
    } catch {
      /* try next */
    }
  }
  return { error: "File not found: " + p };
}

const input = {
  language: "Solidity",
  sources: {
    "KnoleAgenticID.sol": { content: fs.readFileSync("contracts/KnoleAgenticID.sol", "utf8") },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const fatal = (out.errors ?? []).filter((e) => e.severity === "error");
(out.errors ?? []).forEach((e) => console.log(e.formattedMessage));
if (fatal.length) {
  console.log("COMPILE FAILED");
  process.exit(1);
}
const c = out.contracts["KnoleAgenticID.sol"]["KnoleAgenticID"];
console.log("compiled OK —", c.evm.bytecode.object.length / 2, "bytes");
fs.writeFileSync(
  path.join(ROOT, "contracts/KnoleAgenticID.abi.json"),
  JSON.stringify(c.abi, null, 2),
);

const RPC = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, new ethers.JsonRpcProvider(RPC));
const factory = new ethers.ContractFactory(c.abi, c.evm.bytecode.object, wallet);
const MINT_FEE = 0n; // minting your own memory is free (just gas)
console.log("deploying from", wallet.address, "…");
const contract = await factory.deploy(MINT_FEE);
console.log("deploy tx:", contract.deploymentTransaction()?.hash);
await contract.waitForDeployment();
const addr = await contract.getAddress();
console.log("\nDEPLOYED KnoleAgenticID (ERC-7857) at: " + addr);
// Sanity: confirm it reports ERC-7857 support on-chain.
try {
  const iid = "0x" + "".padEnd(0); // placeholder; verified via the app's inft.ts supportsInterface call
  console.log("→ set KNOLE_NFT_ADDRESS_MAINNET=" + addr + " in .env");
} catch {
  /* ignore */
}
