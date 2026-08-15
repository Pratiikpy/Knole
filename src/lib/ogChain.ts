import { defineChain } from "viem";

// The 0G chains as viem objects, for Privy's supportedChains/defaultChain — so a user's own wallet
// can sign transactions (on-chain grants, self-custody mints) on the network Knole lives on.
export const ogMainnet = defineChain({
  id: 16661,
  name: "0G Aristotle",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc.0g.ai"] } },
  blockExplorers: { default: { name: "0G ChainScan", url: "https://chainscan.0g.ai" } },
});

export const ogTestnet = defineChain({
  id: 16602,
  name: "0G Galileo",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "0G ChainScan", url: "https://chainscan-galileo.0g.ai" } },
});

export const ogChain = import.meta.env.VITE_OG_NETWORK === "mainnet" ? ogMainnet : ogTestnet;
