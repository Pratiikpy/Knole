// Deploy KnoleCommitment to 0G Aristotle mainnet with on-chain sanity gates before promoting.
import { readFileSync } from "fs";
import { ethers } from "ethers";
import "dotenv/config";

const RPC = "https://evmrpc.0g.ai";
const ANCHOR = "0xdbD0fd283f00eb7c9E1f7521f66bAfd8cd0948e6";
// No verifiable charity exists on 0G yet; the charity slot points at the burn address and the UI
// offers burn only, stated openly. The contract keeps the charity path for a future deployment.
const CHARITY = "0x000000000000000000000000000000000000dEaD";

const artifact = JSON.parse(readFileSync("out/KnoleCommitment.sol/KnoleCommitment.json", "utf8"));
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(
  process.env.OG_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY,
  provider,
);
console.log(
  "deployer:",
  wallet.address,
  "| balance:",
  ethers.formatEther(await provider.getBalance(wallet.address)),
);

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
const contract = await factory.deploy(ANCHOR, CHARITY);
console.log("deploy tx:", contract.deploymentTransaction().hash);
// 0G mainnet RPC receipt-polling quirk: poll manually.
let receipt = null;
for (let i = 0; i < 40 && !receipt; i++) {
  receipt = await provider
    .getTransactionReceipt(contract.deploymentTransaction().hash)
    .catch(() => null);
  if (!receipt) await new Promise((r) => setTimeout(r, 3000));
}
if (!receipt || receipt.status !== 1) throw new Error("deploy not confirmed");
const addr = receipt.contractAddress;
console.log("KnoleCommitment:", addr);

// sanity gates
const c = new ethers.Contract(addr, artifact.abi, provider);
console.log("anchor wired:", (await c.anchor()) === ANCHOR);
console.log("charity:", await c.charity());
console.log(
  "MIN_STAKE:",
  ethers.formatEther(await c.MIN_STAKE()),
  "| GRACE_DAYS:",
  await c.GRACE_DAYS(),
);
console.log("userFavor starts false:", (await c.userFavor()) === false);
// plain transfer must revert
try {
  await wallet.sendTransaction({ to: addr, value: 1n });
  console.log("plain transfer: DID NOT REVERT (BAD)");
} catch {
  console.log("plain transfer reverts: true");
}
