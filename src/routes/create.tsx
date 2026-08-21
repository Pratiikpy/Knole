import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import {
  generateImageFn,
  creditPacksFn,
  buyCreditsFn,
  treasuryFn,
  claimOgPaymentFn,
} from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create — Knole" },
      {
        name: "description",
        content: "Make an image, privately — generated on 0G, yours to keep.",
      },
    ],
  }),
  component: CreatePage,
});

type Pack = { id: "small" | "medium" | "large"; credits: number; cents: number; label: string };

function CreatePage() {
  const gen = useServerFn(generateImageFn);
  const getPacks = useServerFn(creditPacksFn);
  const buy = useServerFn(buyCreditsFn);
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [showBuy, setShowBuy] = useState(false);
  const getTreasury = useServerFn(treasuryFn);
  const claim = useServerFn(claimOgPaymentFn);
  const [treasury, setTreasury] = useState<{ address: string; weiPerCredit: string } | null>(null);
  const [txHash, setTxHash] = useState("");
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    getPacks()
      .then((r) => {
        setCredits(r.credits);
        setUnlimited(r.unlimited);
        setPacks([...r.packs] as Pack[]);
      })
      .catch(() => {});
    getTreasury()
      .then(
        (t) => t.configured && setTreasury({ address: t.address, weiPerCredit: t.weiPerCredit }),
      )
      .catch(() => {});
  }, [getPacks, getTreasury]);

  async function claimOg() {
    const h = txHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(h) || claiming) {
      setClaimMsg("Paste the transaction hash of your 0G transfer.");
      return;
    }
    setClaiming(true);
    setClaimMsg(null);
    try {
      const r = await claim({ data: { txHash: h } });
      if (r.ok) {
        setCredits(r.credits);
        setTxHash("");
        setClaimMsg(`+${r.credited} credits added.`);
      } else {
        setClaimMsg(
          r.reason === "already_claimed"
            ? "That transaction was already claimed."
            : r.reason === "not_confirmed"
              ? "Couldn't find a confirmed transaction — give it a moment, then retry."
              : r.reason === "wrong_recipient"
                ? "That transfer didn't go to the treasury address."
                : "Couldn't credit that one.",
        );
      }
    } catch {
      setClaimMsg("Something interrupted the claim — try again.");
    } finally {
      setClaiming(false);
    }
  }

  const ogPerCredit = treasury ? Number(BigInt(treasury.weiPerCredit)) / 1e18 : 0;

  async function run() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setErr(null);
    setImage(null);
    setShowBuy(false);
    try {
      const r = await gen({ data: { prompt: p } });
      if (r.ok) {
        setImage(r.image);
        if (typeof r.credits === "number") setCredits(r.credits);
      } else if (r.reason === "need_credits") {
        setCredits(r.credits);
        setShowBuy(true);
      } else {
        setErr(
          r.reason === "not_configured"
            ? "Image generation isn't turned on in this environment."
            : r.reason === "unavailable"
              ? "Image generation is down right now — that's on our side, not your prompt. Try again a bit later."
              : r.reason === "busy"
                ? "Too many images being made right now — give it a minute and try again."
                : "Couldn't make that one — try a different prompt.",
        );
      }
    } catch {
      setErr("Something interrupted it — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const [buying, setBuying] = useState<string | null>(null);
  async function buyPack(id: Pack["id"]) {
    if (buying) return; // a double-tap opened two Stripe Checkout sessions
    setBuying(id);
    try {
      const r = await buy({ data: { packId: id } });
      if (r.ok) {
        window.location.href = r.url;
        return; // keep the button disabled through the redirect
      }
      setErr("Couldn't start checkout. Try again in a moment.");
    } catch {
      setErr("Couldn't start checkout. Try again in a moment.");
    }
    setBuying(null);
  }

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <h1 className="mb-1 font-display text-[44px] italic leading-none">Create</h1>
          <p className="mb-8 max-w-[50ch] text-[15px] leading-relaxed text-muted-foreground">
            Make an image from a few words — generated privately on 0G, and yours to keep.
            Everything ChatGPT does, but private.
          </p>

          {!unlimited && credits !== null && (
            <p className="mb-4 text-[12px] text-muted-foreground">
              {credits} credits · 5 per image ·{" "}
              <button onClick={() => setShowBuy((s) => !s)} className="text-tan hover:text-ink">
                top up
              </button>
            </p>
          )}
          {unlimited && (
            <p className="mb-4 text-[12px] text-tan">Unlimited — you own your Knole.</p>
          )}

          <div className="mb-6 rounded-2xl border border-rule bg-card/50 p-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
              }}
              rows={2}
              placeholder="a quiet ink drawing of a river at dawn…"
              className="w-full resize-none border-none bg-transparent text-[16px] leading-relaxed text-ink placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">private · on 0G</span>
              <button
                onClick={run}
                disabled={busy || !prompt.trim()}
                className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
              >
                {busy ? "Making it…" : "Generate"}
              </button>
            </div>
          </div>

          {err && <p className="text-[13px] text-tan">{err}</p>}

          {showBuy && (
            <div className="mb-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-5">
              <p className="mb-3 text-[13px] text-ink-soft">
                Top up credits — pay once, use across image generation and more.
              </p>
              <div className="flex flex-wrap gap-2">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => buyPack(p.id)}
                    className="rounded-full border border-rule bg-card/60 px-4 py-2 text-[12px] text-ink transition-colors hover:border-tan/40"
                  >
                    {p.credits} credits · ${(p.cents / 100).toFixed(0)}
                  </button>
                ))}
              </div>
              {treasury && (
                <div className="mt-4 border-t border-rule pt-4">
                  <p className="mb-1 text-[12px] text-ink-soft">Or pay with 0G — no card.</p>
                  <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                    Send 0G to{" "}
                    <span className="break-all font-mono text-ink-soft">{treasury.address}</span> (
                    {ogPerCredit} 0G / credit), then paste the transaction hash:
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      placeholder="0x…"
                      className="flex-1 rounded-full border border-rule bg-card/60 px-3 py-1.5 font-mono text-[11px] text-ink focus:border-tan/40 focus:outline-none"
                    />
                    <button
                      onClick={claimOg}
                      disabled={claiming}
                      className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
                    >
                      {claiming ? "…" : "Claim"}
                    </button>
                  </div>
                  {claimMsg && <p className="mt-2 text-[11px] text-tan">{claimMsg}</p>}
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Or go unlimited with the Deeper plan.
              </p>
            </div>
          )}

          {busy && (
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-rule bg-card/30">
              <span className="font-display text-[16px] italic text-muted-foreground">
                drawing it, privately…
              </span>
            </div>
          )}

          {image && !busy && (
            <div className="animate-fade-up">
              <img
                src={image}
                alt={prompt}
                className="w-full rounded-2xl border border-rule"
                width={1024}
                height={1024}
              />
              <a
                href={image}
                download="knole-image.png"
                className="mt-3 inline-block text-[13px] text-tan hover:text-ink"
              >
                download — it's yours ↓
              </a>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
