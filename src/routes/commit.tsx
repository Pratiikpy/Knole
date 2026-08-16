import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PrivyProvider, useWallets } from "@privy-io/react-auth";
import { ethers } from "ethers";
import { Shell } from "@/components/knole/Shell";
import { ogChain } from "@/lib/ogChain";
import { resolveSigner } from "@/lib/walletSigner";
import { commitContextFn, encodeCommitFn, encodeCommitActionFn } from "@/server/fns";
import type { CommitContext, CommitmentRow } from "@/server/commitment";

export const Route = createFileRoute("/commit")({
  head: () => ({
    meta: [
      { title: "Commit — Knole" },
      {
        name: "description",
        content: "Stake it, journal your days, get every bit of it back. Never a wager.",
      },
    ],
  }),
  component: CommitRoute,
});

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";
const EXPLORER = "https://chainscan.0g.ai";

function CommitRoute() {
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
      <CommitPage />
    </PrivyProvider>
  );
}

// The India geo-gate: the Online Gaming Act 2025 is untested for commitment contracts, so the
// stake flow is closed for users whose clock says India until a legal opinion says otherwise.
function inIndia(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz === "Asia/Kolkata" || tz === "Asia/Calcutta";
  } catch {
    return false;
  }
}

function CommitPage() {
  const loadCtx = useServerFn(commitContextFn);
  const encCommit = useServerFn(encodeCommitFn);
  const encAction = useServerFn(encodeCommitActionFn);
  const { wallets } = useWallets();

  const [ctx, setCtx] = useState<CommitContext | null>(null);
  const [goal, setGoal] = useState(7);
  const [windowDays, setWindowDays] = useState(10);
  const [stake, setStake] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const gated = inIndia();

  const refresh = () =>
    loadCtx()
      .then((c) => setCtx(c))
      .catch(() => setNote("Sign in with a wallet to make a commitment."));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTx = async (tx: { to: string; data: string }, value?: bigint) => {
    if (!ctx?.wallet) throw new Error("no wallet");
    const signer = await resolveSigner(wallets, ctx.wallet, ctx.chainId);
    if (!signer) throw new Error("wallet unavailable");
    const params: Record<string, string> = { from: ctx.wallet, to: tx.to, data: tx.data };
    if (value) params.value = "0x" + value.toString(16);
    return (await signer.request({
      method: "eth_sendTransaction",
      params: [params],
    })) as string;
  };

  const stakeIt = async () => {
    if (busy || gated) return;
    setBusy("stake");
    setNote(null);
    try {
      const enc = await encCommit({ data: { goalDays: goal, windowDays } });
      if ("error" in enc) {
        setNote("The window can't be shorter than the goal.");
        return;
      }
      const value = ethers.parseEther(stake || "0");
      const hash = await sendTx(enc, value);
      setNote(`Committed. Transaction ${hash.slice(0, 14)}… — your days now count.`);
      window.setTimeout(() => void refresh(), 6000);
    } catch {
      setNote("The wallet didn't sign — nothing was staked.");
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: "coolOff" | "release" | "settle", id: string) => {
    if (busy) return;
    setBusy(`${action}:${id}`);
    setNote(null);
    try {
      const enc = await encAction({ data: { action, id } });
      const hash = await sendTx(enc);
      setNote(
        action === "release"
          ? `Released — your stake is on its way back. ${hash.slice(0, 14)}…`
          : action === "coolOff"
            ? `Cancelled within cooling-off — full refund. ${hash.slice(0, 14)}…`
            : `Settled — your completion share is back; the rest burned, provably. ${hash.slice(0, 14)}…`,
      );
      window.setTimeout(() => void refresh(), 6000);
    } catch {
      setNote("The wallet didn't sign — nothing changed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Commitment
          </p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Stake it. Show up. Take it back.
          </h1>
          <p className="mt-4 max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground">
            A commitment contract, never a wager: stake OG against journaling N days, and the chain
            itself counts your days through the proof-of-journaling anchor. Hit the goal and the
            full stake returns the moment you do. Miss it and you still get back your completion
            share — the remainder burns, provably.{" "}
            <span className="text-ink-soft">
              Nobody — least of all us — can profit from a miss.
            </span>
          </p>

          {/* the rules, transparent */}
          <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-5 text-[12px] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">The rules</div>
            You can never receive more than you staked · 24h cooling-off, full refund ·{" "}
            {ctx?.graceDays ?? 2} grace days applied automatically at the window's end · release is
            instant the moment the goal is hit · a missed goal refunds stake × days ÷ goal, the rest
            goes to the burn address · if our anchoring pipeline ever breaks, a one-way switch makes
            every active stake fully refundable — the operator's only power is in your favor ·{" "}
            <a
              href={`${EXPLORER}/address/${ctx?.contract ?? ""}`}
              target="_blank"
              rel="noreferrer"
              className="text-tan hover:text-ink"
            >
              read the contract ↗
            </a>
            . Void where prohibited.
          </div>

          {gated && (
            <div className="mt-6 rounded-2xl border border-rule bg-card/60 p-5">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Staking is closed in your region for now — India's Online Gaming Act (2025) is
                untested for commitment contracts, and we'd rather wait for a clear legal opinion
                than guess with your money. Everything else in Knole is yours as always.
              </p>
            </div>
          )}

          {!gated && ctx && !ctx.wallet && (
            <p className="mt-6 text-[13px] text-muted-foreground">
              Connect a wallet in{" "}
              <Link to="/settings" className="text-tan hover:text-ink">
                Settings
              </Link>{" "}
              first — the stake comes from and returns to your own wallet.
            </p>
          )}

          {/* the stake form */}
          {!gated && ctx?.wallet && (
            <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-6">
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    journal days
                  </span>
                  <input
                    type="number"
                    min={3}
                    max={120}
                    value={goal}
                    onChange={(e) => {
                      const v = Math.max(3, Math.min(120, Number(e.target.value) || 3));
                      setGoal(v);
                      if (windowDays < v) setWindowDays(v);
                    }}
                    className="mt-1 w-full rounded-xl border border-rule bg-paper/60 px-3 py-2 font-display text-[20px] italic tabular-nums text-ink focus:border-tan/40 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    within days
                  </span>
                  <input
                    type="number"
                    min={goal}
                    max={120}
                    value={windowDays}
                    onChange={(e) =>
                      setWindowDays(Math.max(goal, Math.min(120, Number(e.target.value) || goal)))
                    }
                    className="mt-1 w-full rounded-xl border border-rule bg-paper/60 px-3 py-2 font-display text-[20px] italic tabular-nums text-ink focus:border-tan/40 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    stake (OG)
                  </span>
                  <input
                    value={stake}
                    onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="mt-1 w-full rounded-xl border border-rule bg-paper/60 px-3 py-2 font-display text-[20px] italic tabular-nums text-ink focus:border-tan/40 focus:outline-none"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {goal} journaled days within {windowDays} — stakes between {ctx.minStake} and{" "}
                {ctx.maxStake} OG. Only real reflected entries count.
              </p>
              <button
                onClick={() => void stakeIt()}
                disabled={busy === "stake"}
                className="mt-4 rounded-full bg-ink px-6 py-3 text-[14px] text-paper transition-opacity disabled:opacity-50"
              >
                {busy === "stake" ? "Waiting for your wallet…" : "Stake & commit"}
              </button>
            </div>
          )}

          {note && <p className="mt-4 text-[13px] text-ink-soft">{note}</p>}

          {/* existing commitments */}
          {ctx && ctx.commitments.length > 0 && (
            <div className="mt-8 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-tan">
                Your commitments
              </div>
              {ctx.commitments.map((c) => (
                <CommitmentCard key={c.id} c={c} busy={busy} onAct={act} />
              ))}
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}

function CommitmentCard({
  c,
  busy,
  onAct,
}: {
  c: CommitmentRow;
  busy: string | null;
  onAct: (a: "coolOff" | "release" | "settle", id: string) => Promise<void>;
}) {
  const pct = Math.min(100, Math.round((c.achieved / c.goalDays) * 100));
  const windowOver = Date.now() > Date.parse(c.windowEnd);
  const coolingOpen = Date.now() < Date.parse(c.coolingOffUntil) && c.state === "active";
  return (
    <div className="rounded-2xl border border-rule bg-card/50 p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] text-ink">
          {c.stake} OG · {c.goalDays} days
        </span>
        <span className="text-[11px] text-muted-foreground">
          {c.state === "active"
            ? windowOver
              ? "window closed"
              : `until ${new Date(c.windowEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
            : c.state}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rule">
        <div className="h-full rounded-full bg-tan transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[12px]">
        <span className="text-muted-foreground">
          {c.achieved} of {c.goalDays} days journaled
        </span>
        {c.state === "active" && (
          <span className="flex gap-3">
            {c.claimableNow && (
              <button
                onClick={() => void onAct("release", c.id)}
                disabled={busy !== null}
                className="text-tan underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                {busy === `release:${c.id}` ? "releasing…" : "release my stake"}
              </button>
            )}
            {!c.claimableNow && windowOver && (
              <button
                onClick={() => void onAct("settle", c.id)}
                disabled={busy !== null}
                className="text-muted-foreground underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                {busy === `settle:${c.id}` ? "settling…" : "settle & take my share"}
              </button>
            )}
            {coolingOpen && (
              <button
                onClick={() => void onAct("coolOff", c.id)}
                disabled={busy !== null}
                className="text-muted-foreground underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                {busy === `coolOff:${c.id}` ? "cancelling…" : "cancel (cooling-off)"}
              </button>
            )}
          </span>
        )}
        {c.state === "settled" && windowOver && (
          <span className="text-muted-foreground">
            you still journaled {c.achieved} {c.achieved === 1 ? "day" : "days"} — that counts.{" "}
            <Link to="/commit" className="text-tan hover:text-ink">
              fresh start →
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}
