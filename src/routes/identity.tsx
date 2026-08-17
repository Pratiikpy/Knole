import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PrivyProvider, useWallets } from "@privy-io/react-auth";
import { Shell } from "@/components/knole/Shell";
import { PassportCard } from "@/components/knole/PassportCard";
import { SelfPortraitCard } from "@/components/knole/SelfPortraitCard";
import { ogChain } from "@/lib/ogChain";
import { resolveSigner } from "@/lib/walletSigner";
import {
  identityCapsuleFn,
  createIdentityGrantFn,
  listIdentityGrantsFn,
  revokeIdentityGrantFn,
  onchainGrantContextFn,
  encodeGrantCallFn,
  listOnchainGrantsFn,
  sponsorGrantGasFn,
} from "@/server/fns";
import { useEffect, useState } from "react";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";

export const Route = createFileRoute("/identity")({
  head: () => ({
    meta: [
      { title: "Portable identity — Knole" },
      {
        name: "description",
        content: "Carry who you are to other 0G apps — with your permission.",
      },
    ],
  }),
  component: IdentityRoute,
});

// Privy scoped to this route (same code-split reasoning as settings): on-chain grants are signed by
// the USER's own wallet — the server encodes and reads, but only the token owner can grant.
function IdentityRoute() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "light", accentColor: "#7c6545" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        supportedChains: [ogChain],
        defaultChain: ogChain,
      }}
    >
      <IdentityPage />
    </PrivyProvider>
  );
}

type Capsule = {
  values: string[];
  patterns: string[];
  relationships: string[];
  commitments: string[];
  preferences: string[];
};
type Grant = { gid: string; scope: string; exp: number; revoked: boolean };

function IdentityPage() {
  const getCapsule = useServerFn(identityCapsuleFn);
  const createGrant = useServerFn(createIdentityGrantFn);
  const listGrants = useServerFn(listIdentityGrantsFn);
  const revoke = useServerFn(revokeIdentityGrantFn);

  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshGrants = () =>
    listGrants()
      .then((r) => setGrants(r.grants))
      .catch(() => {});
  useEffect(() => {
    getCapsule()
      .then((r) => setCapsule(r.capsule))
      .catch(() => {});
    refreshGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mkGrant() {
    setCopied(false);
    try {
      const r = await createGrant({ data: { scope: "summary", ttlSec: 604800 } });
      setToken(r.token);
      refreshGrants();
    } catch {
      /* ignore */
    }
  }

  const sections: [string, string[]][] = capsule
    ? [
        ["Values", capsule.values],
        ["Patterns", capsule.patterns],
        ["Relationships", capsule.relationships],
        ["Commitments", capsule.commitments],
        ["Preferences", capsule.preferences],
      ]
    : [];
  const hasCapsule = sections.some(([, v]) => v.length);

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Portable identity</h1>
            <Link to="/the-index" className="text-[12px] text-muted-foreground hover:text-ink">
              your memory →
            </Link>
          </div>
          <p className="mb-8 max-w-[50ch] text-[15px] leading-relaxed text-muted-foreground">
            Your memory is yours to carry. Grant another 0G app or agent a read-only view of who you
            are — a scoped, expiring, revocable pass. It shares only these durable traits, never a
            single entry.
          </p>

          {/* The capsule */}
          {hasCapsule ? (
            <div className="mb-8 space-y-4">
              {sections
                .filter(([, v]) => v.length)
                .map(([label, items]) => (
                  <div key={label} className="rounded-2xl border border-rule bg-card/50 p-5">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                      {label}
                    </div>
                    <ul className="space-y-1 text-[14px] leading-relaxed text-ink-soft">
                      {items.map((it) => (
                        <li key={it}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mb-8 text-[14px] text-muted-foreground">
              Write for a while first — your identity fills in from your own words, then you can
              carry it.
            </p>
          )}

          {/* Grant */}
          {hasCapsule && (
            <div className="mb-8 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
              <p className="mb-3 text-[14px] text-ink-soft">
                Create a grant — a token another 0G app can present for 7 days, until you revoke it.
              </p>
              <button
                onClick={mkGrant}
                className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper"
              >
                Create a grant
              </button>
              {token && (
                <div className="mt-4">
                  <div className="break-all rounded-lg border border-rule bg-card/60 p-3 font-mono text-[11px] text-ink-soft">
                    {token}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(token);
                        setCopied(true);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="mt-2 text-[12px] text-tan hover:text-ink"
                  >
                    {copied ? "copied ✓" : "copy grant token"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Active grants */}
          {grants.length > 0 && (
            <div>
              <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Grants you've given
              </div>
              <div className="space-y-2">
                {grants.map((g) => (
                  <div
                    key={g.gid}
                    className="flex items-center justify-between rounded-xl border border-rule/60 px-4 py-3 text-[12px]"
                  >
                    <span className="text-muted-foreground">
                      {g.scope} · expires {new Date(g.exp * 1000).toLocaleDateString()}
                      {g.revoked ? " · revoked" : ""}
                    </span>
                    {!g.revoked && (
                      <button
                        onClick={() => revoke({ data: { gid: g.gid } }).then(refreshGrants)}
                        className="text-tan hover:text-ink"
                      >
                        revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <OnchainGrantsCard />

          <div className="mb-6">
            <SelfPortraitCard />
          </div>
          <PassportCard />
        </div>
      </section>
    </Shell>
  );
}

type GrantCtx =
  | { available: false; reason: "no-wallet" | "no-token" }
  | { available: true; tokenId: string; contract: string; chainId: number; wallet: string };

/**
 * ERC-7857 grants, for real: the user's OWN wallet signs authorizeUsage/revokeAuthorization on the
 * KnoleAgenticID contract. The list below is read live from the chain — the registry is the
 * contract, not our database — and anyone can re-check it on ChainScan.
 */
function OnchainGrantsCard() {
  const getCtx = useServerFn(onchainGrantContextFn);
  const encode = useServerFn(encodeGrantCallFn);
  const listOnchain = useServerFn(listOnchainGrantsFn);
  const sponsor = useServerFn(sponsorGrantGasFn);
  const { wallets } = useWallets();

  const [ctx, setCtx] = useState<GrantCtx | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [grantee, setGrantee] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; tx?: string } | null>(null);

  const refresh = () =>
    listOnchain()
      .then((r) => setGrants(r.grants))
      .catch(() => {});
  useEffect(() => {
    getCtx()
      .then((c) => {
        setCtx(c);
        if (c.available) void refresh();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCall(target: string, revoke: boolean) {
    if (!ctx?.available || busy) return;
    setBusy(revoke ? `revoke:${target}` : "grant");
    setMsg(null);
    try {
      const call = await encode({ data: { grantee: target, revoke } });
      if ("error" in call) {
        setMsg({
          kind: "err",
          text:
            call.error === "bad-address"
              ? "That doesn't look like a wallet address."
              : "Grant isn't available yet.",
        });
        return;
      }
      await sponsor().catch(() => {}); // dust gas for a fresh wallet; no-op when funded
      const provider = await resolveSigner(wallets, ctx.wallet, ctx.chainId);
      if (!provider) {
        setMsg({
          kind: "err",
          text: "Sign in with your wallet in Settings first — grants are signed by you.",
        });
        return;
      }
      const tx = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: ctx.wallet, to: call.to, data: call.data }],
      })) as string;
      // Poll the live registry until the change lands, so the list is honest, not optimistic.
      let confirmed = false;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const now = await listOnchain();
        const has = now.grants.some((g) => g.toLowerCase() === target.toLowerCase());
        if (revoke ? !has : has) {
          setGrants(now.grants);
          confirmed = true;
          break;
        }
      }
      // The poll had no failure branch, so a reverted or stuck transaction fell through to the
      // success message anyway - the page claimed an on-chain grant that does not exist.
      if (!confirmed) {
        setMsg({
          kind: "err",
          text: "The transaction hasn't shown up on-chain yet. Check the explorer before relying on it.",
          tx,
        });
        return;
      }
      setMsg({
        kind: "ok",
        text: revoke ? "Grant revoked on-chain." : "Granted on-chain — signed by your wallet.",
        tx,
      });
      if (!revoke) setGrantee("");
    } catch {
      setMsg({ kind: "err", text: "The transaction didn't go through — try again." });
    } finally {
      setBusy(null);
    }
  }

  if (!ctx) return null;

  return (
    <div className="mt-10 rounded-2xl border border-tan/30 bg-tan/[0.04] p-6">
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
        On-chain grants · ERC-7857
      </div>
      {!ctx.available ? (
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {ctx.reason === "no-wallet"
            ? "Sign in with a wallet in Settings to grant on-chain — grants are signed by you, never by us."
            : "Mint your memory iNFT first — on-chain grants attach to your token."}{" "}
          <Link
            to={ctx.reason === "no-wallet" ? "/settings" : "/the-index"}
            className="text-tan hover:text-ink"
          >
            {ctx.reason === "no-wallet" ? "open settings →" : "mint it →"}
          </Link>
        </p>
      ) : (
        <>
          <p className="mb-4 text-[14px] leading-relaxed text-ink-soft">
            Grant a 0G agent scoped access to token&nbsp;#{ctx.tokenId} — written to the contract by{" "}
            <span className="font-mono text-[12px]">
              {ctx.wallet.slice(0, 6)}…{ctx.wallet.slice(-4)}
            </span>
            , your wallet. Revocable any time; anyone can verify the registry on ChainScan.
          </p>
          <div className="flex gap-2">
            <label htmlFor="grantee" className="sr-only">
              Agent wallet address
            </label>
            <input
              id="grantee"
              value={grantee}
              onChange={(e) => setGrantee(e.target.value)}
              placeholder="agent wallet address (0x…)"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-xl border border-rule bg-card/60 px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted-foreground/60 focus:border-tan/40 focus:outline-none"
            />
            <button
              onClick={() => sendCall(grantee.trim(), false)}
              disabled={!grantee.trim() || busy !== null}
              className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper disabled:opacity-40"
            >
              {busy === "grant" ? "Granting…" : "Grant"}
            </button>
          </div>
          {grants.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Live from the contract
              </div>
              {grants.map((g) => (
                <div
                  key={g}
                  className="flex items-center justify-between rounded-xl border border-rule/60 px-4 py-3"
                >
                  <span className="font-mono text-[11px] text-ink-soft">{g}</span>
                  <button
                    onClick={() => sendCall(g, true)}
                    disabled={busy !== null}
                    className="text-[12px] text-tan hover:text-ink disabled:opacity-40"
                  >
                    {busy === `revoke:${g}` ? "revoking…" : "revoke"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {msg && (
            <p
              aria-live="polite"
              className={`mt-3 text-[12px] ${msg.kind === "ok" ? "text-tan" : "text-destructive"}`}
            >
              {msg.text}{" "}
              {msg.tx && (
                <a
                  href={`https://chainscan.0g.ai/tx/${msg.tx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-ink"
                >
                  view tx ↗
                </a>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
