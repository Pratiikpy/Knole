import { useServerFn } from "@tanstack/react-start";
import { inftStatusFn, mintMemoryINFTFn } from "@/server/fns";
import { isAuthRequired } from "@/lib/authError";
import { useEffect, useState } from "react";

type Token = { tokenId: string; txHash: string; root: string; version: number; mintedAt: string };

/**
 * The iNFT ownership card — mint your evolving memory as a token you truly own (ERC-7857 spirit on
 * 0G): encrypted on 0G Storage, portable across your own wallets, and impossible to list or sell.
 * Renders only once a KnoleMemory contract is deployed (KNOLE_NFT_ADDRESS set) — otherwise nothing,
 * so no half-built feature is ever shown.
 */
export function INFTCard() {
  const getStatus = useServerFn(inftStatusFn);
  const doMint = useServerFn(mintMemoryINFTFn);
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState<Token | null>(null);
  const [minting, setMinting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    getStatus()
      .then((s) => {
        if (!alive) return;
        setConfigured(!!s.configured);
        setToken((s.token as Token | null) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [getStatus]);

  if (!configured) return null;

  const mint = async () => {
    if (minting) return;
    setMinting(true);
    setMsg("");
    try {
      const r = await doMint();
      if (r && "error" in r) {
        setMsg(
          r.error === "no-wallet"
            ? "Connect a wallet in Settings first — your iNFT mints to it."
            : r.error === "no-memory"
              ? "Write a few entries first — there's not enough yet to mint."
              : "Couldn't mint just now. Try again in a moment.",
        );
      } else if (r) {
        setToken(r as Token);
      }
    } catch (e) {
      setMsg(
        isAuthRequired(e)
          ? "Sign in to mint your memory — you're viewing the demo."
          : "Couldn't mint just now. Try again.",
      );
    } finally {
      setMinting(false);
    }
  };

  const explorer = (tx: string) => `https://chainscan-galileo.0g.ai/tx/${tx}`;

  return (
    <div className="mt-10 rounded-2xl border border-tan/30 bg-tan/[0.04] p-6">
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">Own your memory</div>
      {token ? (
        <>
          <p className="font-display text-[18px] italic leading-snug text-ink-soft">
            Minted. Your memory lives as an iNFT you hold — encrypted, evolving, and not for sale.
          </p>
          <div className="mt-3 space-y-1 text-[12px] text-muted-foreground">
            <div>
              Token #{token.tokenId} · version {token.version}
            </div>
            <a
              href={explorer(token.txHash)}
              target="_blank"
              rel="noreferrer"
              className="text-tan hover:text-ink"
            >
              view on 0G explorer →
            </a>
          </div>
          <button
            onClick={mint}
            disabled={minting}
            className="mt-4 rounded-full border border-rule px-4 py-2 text-[12px] text-ink transition-colors hover:border-tan/40 disabled:opacity-40"
          >
            {minting ? "Updating…" : "Update with your latest self"}
          </button>
        </>
      ) : (
        <>
          <p className="font-display text-[18px] italic leading-snug text-ink-soft">
            Mint your memory as a token you truly own — encrypted on 0G, portable across your own
            wallets, and impossible to list or sell. Your memory is sacred, not for sale.
          </p>
          <button
            onClick={mint}
            disabled={minting}
            className="mt-4 rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-opacity disabled:opacity-40"
          >
            {minting ? "Minting…" : "Mint my memory iNFT"}
          </button>
        </>
      )}
      {msg && (
        <p aria-live="polite" className="mt-3 text-[12px] text-destructive">
          {msg}
        </p>
      )}
    </div>
  );
}
