import { ethers } from "ethers";
import type { Page } from "@playwright/test";

/**
 * Install a REAL (test) EOA as an injected EIP-1193 + EIP-6963 wallet so Privy's "connect a wallet"
 * path can complete headlessly. Signatures are genuine ECDSA from a fresh random key — Privy verifies
 * the signature, not the identity, so a valid sig from any address authenticates. Emits the connect /
 * accountsChanged events Privy waits on. Returns the address.
 */
export async function installMockWallet(page: Page): Promise<string> {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;

  await page.exposeFunction("__mockSign", async (hexMsg: string) => {
    const bytes = ethers.getBytes(hexMsg);
    return await wallet.signMessage(bytes);
  });

  await page.addInitScript((addr) => {
    type Handler = (data: unknown) => void;
    const listeners: Record<string, Handler[]> = {};
    const emit = (ev: string, data: unknown) =>
      (listeners[ev] || []).forEach((h) => {
        try {
          h(data);
        } catch {
          /* ignore */
        }
      });

    const provider = {
      isMetaMask: true,
      isConnected: () => true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            setTimeout(() => {
              emit("connect", { chainId: "0x1" });
              emit("accountsChanged", [addr]);
            }, 0);
            return [addr];
          case "eth_chainId":
            return "0x1";
          case "net_version":
            return "1";
          case "personal_sign":
            return await (
              window as unknown as { __mockSign: (m: string) => Promise<string> }
            ).__mockSign(params![0] as string);
          case "eth_sign":
            return await (
              window as unknown as { __mockSign: (m: string) => Promise<string> }
            ).__mockSign(params![1] as string);
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
            return null;
          default:
            return null;
        }
      },
      on: (ev: string, h: Handler) => {
        (listeners[ev] = listeners[ev] || []).push(h);
      },
      removeListener: (ev: string, h: Handler) => {
        listeners[ev] = (listeners[ev] || []).filter((x) => x !== h);
      },
      removeAllListeners: () => {
        for (const k of Object.keys(listeners)) delete listeners[k];
      },
    };
    (window as unknown as { ethereum: unknown }).ethereum = provider;

    const info = {
      uuid: "00000000-0000-0000-0000-000000000001",
      name: "Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      rdns: "com.test.wallet",
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, address);

  return address;
}
