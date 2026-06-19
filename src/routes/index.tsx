import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Knole — a private AI that actually understands you" },
      {
        name: "description",
        content:
          "Write to it like a journal. It writes back like someone who gets you. Encrypted under your key — only you can read it.",
      },
      {
        property: "og:title",
        content: "Knole — a private AI that actually understands you",
      },
      {
        property: "og:description",
        content: "Not an assistant. A mirror. Remembers your whole life. Unreadable even by us.",
      },
    ],
  }),
  component: LandingPage,
});

const lines = [
  "I keep saying I want rest, but I think I just want to be left alone for a week.",
  "There's that Tuesday weight again. Same as the rainy stretch in March.",
  "I don't know if I'm tired of the work or tired of who I am while I'm doing it.",
];

function LandingPage() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [showReply, setShowReply] = useState(false);

  useEffect(() => {
    setTyped("");
    setShowReply(false);
    const line = lines[idx];
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(line.slice(0, i));
      if (i >= line.length) {
        clearInterval(id);
        setTimeout(() => setShowReply(true), 600);
        setTimeout(() => setIdx((n) => (n + 1) % lines.length), 6800);
      }
    }, 34);
    return () => clearInterval(id);
  }, [idx]);

  return (
    <Shell hideNav>
      {/* HERO */}
      <section className="relative px-6 pb-28 pt-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[80vh] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(140,115,85,0.10),transparent_70%)]" />

        <div className="mx-auto max-w-[58ch]">
          <div className="mb-8 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="size-1 rounded-full bg-tan" />
            Encrypted · only you can read it
          </div>

          <h1 className="font-display text-balance text-[60px] leading-[0.96] tracking-tight md:text-[88px]">
            A private AI that
            <br />
            <em className="italic text-tan">actually</em> understands you.
          </h1>

          <p className="mt-8 max-w-[46ch] text-pretty text-[17px] leading-relaxed text-muted-foreground">
            You write to it like a journal. It writes back like someone who gets you — remembers
            your whole life, notices the patterns you can't see in yourself, and helps you
            understand who you are.
            <br />
            <span className="text-ink-soft">Not an assistant. A mirror.</span>
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-5">
            <Link
              to="/onboarding"
              className="group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[14px] font-medium text-paper transition-transform hover:translate-y-[-1px]"
            >
              <span>Start writing</span>
              <svg
                viewBox="0 0 24 24"
                className="size-4 transition-transform group-hover:translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            <p className="max-w-[34ch] text-[12px] leading-relaxed text-muted-foreground">
              No signup wall. Encrypted under your key. It can't be reset, read, or taken away.
            </p>
          </div>
        </div>

        {/* Live "the journal writes back" demo */}
        <div className="mx-auto mt-20 max-w-[58ch]">
          <div className="rounded-2xl border border-rule bg-card/60 p-7 shadow-[0_30px_80px_-50px_rgba(28,25,23,0.25)]">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-tan animate-breathe" />
                The journal writes back
              </span>
              <span className="font-display text-xs italic text-muted-foreground">
                Tuesday · 21:14
              </span>
            </div>

            <p className="font-display text-[22px] leading-snug text-ink">
              {typed}
              <span className="ml-0.5 inline-block h-5 w-px translate-y-0.5 bg-ink/70 align-middle [animation:blink_1s_steps(2)_infinite]" />
            </p>

            {showReply && (
              <div className="animate-fade-up mt-6 border-l-2 border-tan/40 pl-5">
                <p className="text-[14px] leading-relaxed text-ink-soft">
                  You've described this exact feeling three times since March — always on the flat
                  days after you push hard. It usually softens after a long walk. What kind of alone
                  are you looking for tonight?
                </p>
                <div className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Knole · grounded in your own words
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 14-DAY MIRROR */}
      <section className="border-t border-rule px-6 py-24">
        <div className="mx-auto max-w-[60ch]">
          <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-tan">The 14-Day Mirror</p>
          <h2 className="font-display text-balance text-[44px] italic leading-[1.04] md:text-[52px]">
            Write for fourteen days. On day fifteen, Knole shows you something
            <span className="text-tan"> only it could.</span>
          </h2>
          <p className="mt-6 max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">
            Most journals are a graveyard for your thoughts. This one notices. A pattern you'd never
            name yourself, written back to you gently and with receipts. That moment is the whole
            product — everything else is just the path to it.
          </p>

          <div className="mt-12 grid grid-cols-7 gap-2">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className={`aspect-square rounded-md border ${
                  i < 8
                    ? "border-tan/30 bg-tan/10"
                    : i === 13
                      ? "border-tan/60 bg-tan/25 animate-breathe"
                      : "border-rule bg-card/40"
                }`}
                title={i === 13 ? "Pattern Mirror" : `Day ${i + 1}`}
              />
            ))}
          </div>
          <div className="mt-3 flex justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>Day 1 · today</span>
            <span className="text-tan">Day 15 · Pattern Mirror</span>
          </div>
        </div>
      </section>

      {/* THREE PROMISES */}
      <section className="border-t border-rule px-6 py-24">
        <div className="mx-auto max-w-[64ch] grid gap-12 md:grid-cols-3">
          {[
            {
              t: "Daily Reflection",
              b: "Write or talk. The journal writes back inside the same entry — calm, honest, never a yes-man.",
            },
            {
              t: "Pattern Mirror",
              b: "Each week, a private letter from yourself about yourself. The throughline you couldn't see.",
            },
            {
              t: "Ask My Life",
              b: "Ask yourself anything. Knole answers from your own past — and shows you exactly where it came from.",
            },
          ].map((c) => (
            <div key={c.t}>
              <h3 className="font-display text-2xl italic">{c.t}</h3>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{c.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRIVACY */}
      <section className="border-t border-rule px-6 py-24">
        <div className="mx-auto max-w-[54ch] text-center">
          <div className="mb-5 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-tan">
            <svg
              viewBox="0 0 24 24"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </svg>
            Verified private
          </div>
          <p className="font-display text-balance text-[34px] italic leading-[1.1]">
            Encrypted under your key.
            <br />
            Unreadable even by us.
          </p>
          <p className="mx-auto mt-5 max-w-[40ch] text-[13px] leading-relaxed text-muted-foreground">
            No tracking. No audience. Your memory is encrypted under your key and stored on 0G —
            recoverable even if Knole vanished. Export it anytime, and walk away with your whole
            mind.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/onboarding"
              className="rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper"
            >
              Begin the fourteen days
            </Link>
            <Link
              to="/extension"
              className="rounded-full border border-rule px-5 py-3 text-[13px] text-ink hover:border-ink/20"
            >
              Save to Knole · Chrome
            </Link>
          </div>
        </div>
      </section>

      <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
    </Shell>
  );
}
