import { useServerFn } from "@tanstack/react-start";
import { useWallets } from "@privy-io/react-auth";
import {
  inftStatusFn,
  mintMemoryINFTFn,
  prepareClientMintFn,
  confirmClientMintFn,
  sponsorGrantGasFn,
} from "@/server/fns";
import { isAuthRequired } from "@/lib/authError";
import { resolveSigner } from "@/lib/walletSigner";
import { useEffect, useState } from "react";

type Token = { tokenId: string; txHash: string; root: string; version: number; mintedAt: string };

/**
 * The iNFT ownership card — mint your evolving memory as a genuine ERC-7857 Agentic ID on 0G: the
 * encrypted snapshot lives on 0G Storage, the token records only its Merkle-root hash, and it's minted
 * to (owned by) your own wallet. Renders only once the KnoleAgenticID contract is deployed — otherwise
 * nothing, so no half-built feature is ever shown.
 */
export function INFTCard() {
  const getStatus = useServerFn(inftStatusFn);
  const doMint = useServerFn(mintMemoryINFTFn);
  const prepareSelf = useServerFn(prepareClientMintFn);
  const confirmSelf = useServerFn(confirmClientMintFn);
  const sponsorGas = useServerFn(sponsorGrantGasFn);
  const { wallets } = useWallets();
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState<Token | null>(null);
  const [minting, setMinting] = useState(false);
  const [selfMinting, setSelfMinting] = useState(false);
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

  // Self-custody mint: the user's OWN wallet calls the public iMint — they are minter and owner,
  // and the transaction on ChainScan shows their address as the sender, not ours.
  const selfMint = async () => {
    if (selfMinting || minting) return;
    setSelfMinting(true);
    setMsg("");
    try {
      const prep = await prepareSelf();
      if ("error" in prep) {
        setMsg(
          prep.error === "no-wallet"
            ? "Connect a wallet in Settings first — your iNFT mints to it."
            : prep.error === "no-memory"
              ? "Write a few entries first — there's not enough yet to mint."
              : prep.error === "already-minted"
                ? "Already minted — use “Update with your latest self” below."
                : "Couldn't prepare the mint just now. Try again.",
        );
        return;
      }
      await sponsorGas().catch(() => {}); // dust gas for a fresh wallet; no-op when funded
      const provider = await resolveSigner(wallets, prep.wallet, prep.chainId);
      if (!provider) {
        setMsg("Sign in with your wallet first — this mint is signed by you.");
        return;
      }
      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: prep.wallet, to: prep.to, data: prep.data }],
      })) as string;
      const rec = await confirmSelf({ data: { txHash } });
      if ("error" in rec) {
        setMsg("The mint transaction didn't confirm — check your wallet and try again.");
        return;
      }
      setToken(rec as Token);
    } catch (e) {
      setMsg(
        isAuthRequired(e)
          ? "Sign in to mint your memory — you're viewing the demo."
          : "Couldn't mint just now. Try again.",
      );
    } finally {
      setSelfMinting(false);
    }
  };

  const explorer = (tx: string) => `https://chainscan.0g.ai/tx/${tx}`;

  return (
    <div className="mt-10 rounded-2xl border border-tan/30 bg-tan/[0.04] p-6">
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">Own your memory</div>
      {token ? (
        <>
          <p className="font-display text-[18px] italic leading-snug text-ink-soft">
            Minted. Your memory lives as an ERC-7857 iNFT owned by your wallet — encrypted on 0G,
            evolving with you, yours to carry or grant.
          </p>
          <div className="mt-3 space-y-1 text-[12px] text-muted-foreground">
            <div>
              Token #{token.tokenId} · version {token.version} ·{" "}
              <span className="text-tan">
                {token.version >= 8
                  ? "Deepening"
                  : token.version >= 4
                    ? "Becoming"
                    : token.version >= 2
                      ? "Forming"
                      : "Nascent"}
              </span>
            </div>
            <div className="italic">
              It grows with you — each time you evolve it, this version is anchored on-chain, a
              record of who you're becoming.
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
            Mint your memory as a genuine <strong className="font-medium">ERC-7857</strong> iNFT —
            the encrypted snapshot on 0G Storage, the token owned by your own wallet, evolving with
            you and yours to carry across wallets or grant a 0G agent scoped access.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={mint}
              disabled={minting || selfMinting}
              className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-opacity disabled:opacity-40"
            >
              {minting ? "Minting…" : "Mint my memory iNFT"}
            </button>
            <button
              onClick={selfMint}
              disabled={minting || selfMinting}
              title="Your wallet signs the public iMint itself — the transaction sender on ChainScan is you, not Knole."
              className="rounded-full border border-rule px-4 py-2.5 text-[12px] text-ink transition-colors hover:border-tan/40 disabled:opacity-40"
            >
              {selfMinting ? "Waiting for your wallet…" : "or sign it yourself"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Both paths mint to your own wallet. “Sign it yourself” makes even the mint transaction
            yours — we sponsor a dust of gas, your wallet does the rest.
          </p>
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
