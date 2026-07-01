// Compile contracts/KnoleMemory.sol and deploy it to the 0G chain. One-time: records the address in
// KNOLE_NFT_ADDRESS. Reuses EVM_PRIVATE_KEY + OG_RPC_URL from .env.
import fs from "fs";
import path from "path";
import solc from "solc";
import { ethers } from "ethers";
import "dotenv/config";

const ROOT = process.cwd();
const src = fs.readFileSync(path.join(ROOT, "contracts/KnoleMemory.sol"), "utf8");

// Resolve OpenZeppelin (and transitive) imports out of node_modules for the solc compiler.
function findImport(importPath) {
  try {
    return { contents: fs.readFileSync(path.join(ROOT, "node_modules", importPath), "utf8") };
  } catch {
    return { error: "File not found: " + importPath };
  }
}

const input = {
  language: "Solidity",
  sources: { "KnoleMemory.sol": { content: src } },
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
const c = out.contracts["KnoleMemory.sol"]["KnoleMemory"];
const abi = c.abi;
const bytecode = c.evm.bytecode.object;
console.log("compiled OK — bytecode", bytecode.length / 2, "bytes");
fs.writeFileSync(path.join(ROOT, "contracts/KnoleMemory.abi.json"), JSON.stringify(abi, null, 2));

const RPC = process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai";
const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, new ethers.JsonRpcProvider(RPC));
const factory = new ethers.ContractFactory(abi, bytecode, wallet);
console.log("deploying from", wallet.address, "...");
const contract = await factory.deploy();
console.log("deploy tx:", contract.deploymentTransaction()?.hash);
await contract.waitForDeployment();
const addr = await contract.getAddress();
console.log("\nDEPLOYED KnoleMemory at: " + addr);
console.log("→ set KNOLE_NFT_ADDRESS=" + addr + " in .env");
