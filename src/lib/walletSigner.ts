// Resolve a signing EIP-1193 provider for a specific wallet address on the 0G chain.
// Prefers Privy's wallet handle (covers embedded wallets); falls back to the raw injected provider
// when it already holds the right address — Privy's wallet list can lag a page load behind an
// injected wallet that is otherwise perfectly able to sign.
export type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

type PrivyWallet = {
  address: string;
  switchChain: (chainId: number) => Promise<void>;
  getEthereumProvider: () => Promise<Eip1193>;
};

export async function resolveSigner(
  wallets: PrivyWallet[],
  expectedWallet: string,
  chainId: number,
): Promise<Eip1193 | null> {
  const want = expectedWallet.toLowerCase();
  const w = wallets.find((x) => x.address.toLowerCase() === want);
  if (w) {
    await w.switchChain(chainId).catch(() => {});
    return w.getEthereumProvider();
  }
  const injected = (window as { ethereum?: Eip1193 }).ethereum;
  if (!injected) return null;
  const accounts = (await injected
    .request({ method: "eth_requestAccounts" })
    .catch(() => [])) as string[];
  if (!accounts.some((a) => a.toLowerCase() === want)) return null;
  await injected
    .request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    })
    .catch(() => {});
  return injected;
}
