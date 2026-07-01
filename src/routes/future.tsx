import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";
import { parseRecalledHeader } from "@/components/knole/recall";
import { whoamiFn, futureReadyFn } from "@/server/fns";
import { useState, useRef, useEffect } from "react";

export const Route = createFileRoute("/future")({
  head: () => ({
    meta: [
      { title: "Future Self — Knole" },
      {
        name: "description",
        content: "A grounded conversation with who you're becoming — drawn from your own values.",
      },
    ],
  }),
  component: FuturePage,
});

type Msg = {
  who: "you" | "knole";
  text: string;
  remembered?: { label: string; receipts: { date: string; quote: string }[] };
};

const HORIZONS = [5, 10, 20] as const;

const seed: Msg[] = [
  {
    who: "knole",
    text: "I'm you, a way down the road. I can't tell you what happens — only who you keep being. What do you want to ask me?",
  },
];

function FuturePage() {
  const [messages, setMessages] = useState<Msg[]>(seed);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [horizon, setHorizon] = useState<number>(10);
  const endRef = useRef<HTMLDivElement>(null);

  // A demo guest can't write (auth-gated); the readiness gate keeps a thin Index from grounding a
  // hallucinated future self. Learn both up front.
  const whoami = useServerFn(whoamiFn);
  const [demoGated, setDemoGated] = useState(false);
  const futureReady = useServerFn(futureReadyFn);
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    whoami()
      .then((r) => alive && setDemoGated(!!r.isDemo && !!r.gated))
      .catch(() => {});
    futureReady()
      .then((r) => alive && setReady(r.ready))
      .catch(() => alive && setReady(true)); // on error, don't block — let them try
    return () => {
      alive = false;
    };
  }, [whoami, futureReady]);

  useEffect(() => {
    // Respect reduced-motion: jump instead of smooth-scroll for motion-sensitive users.
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, [messages, loading]);

  const send = async () => {
    const text = draft.trim();
    if (!text || loading) return;
    const history = messages.map((m) => ({
      role: (m.who === "you" ? "user" : "assistant") as "user" | "assistant",
      content: m.text,
    }));
    setMessages((m) => [...m, { who: "you", text }, { who: "knole", text: "" }]);
    setDraft("");
    setLoading(true);
    const setLastKnole = (t: string) =>
      setMessages((m) => {
        const copy = m.slice();
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].who === "knole") {
            copy[i] = { ...copy[i], text: t };
            break;
          }
        }
        return copy;
      });
    if (demoGated) {
      setLastKnole("Sign in to meet your own future self — you're viewing the demo.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/future/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history, horizon }),
      });
      if (!res.ok || !res.body) {
        setLastKnole(
          res.status === 401
            ? "Sign in to meet your own future self — you're viewing the demo."
            : "Something interrupted me — say that again?",
        );
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setLastKnole(acc);
      }
      // The memories the future self drew on, surfaced as receipts (rides in a header like chat).
      const remembered = parseRecalledHeader(res.headers.get("x-knole-recalled"));
      if (remembered) {
        setMessages((m) => {
          const copy = m.slice();
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].who === "knole") {
              copy[i] = { ...copy[i], remembered };
              break;
            }
          }
          return copy;
        });
      }
    } catch {
      setLastKnole("Something interrupted me — say that again?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell>
      <section className="px-6 pb-32 pt-10">
        <div className="mx-auto max-w-[58ch]">
          <div className="knole-stagger mb-10">
            <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              A conversation with who you're becoming
            </p>
            <h1 className="font-display text-[40px] italic leading-none">
              Talk to your future self.
            </h1>
            <p className="mt-3 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
              This is a mirror of your own values and patterns — not a prediction. Your future self
              can only speak from what you've told Knole.
            </p>
            <div className="mt-5 inline-flex items-center gap-1 rounded-full border border-rule p-1">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`rounded-full px-4 py-1.5 text-[12px] transition-colors ${
                    horizon === h ? "bg-ink text-paper" : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  {h} years
                </button>
              ))}
            </div>
          </div>

          {ready === false ? (
            <div className="animate-fade-up rounded-2xl border border-rule bg-card/50 p-8">
              <p className="font-display text-[20px] italic leading-snug text-muted-foreground">
                Your future self can only speak from what you've shared. Write on Today for a few
                days first — once Knole knows a little of who you are, come back and meet the person
                you're becoming.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((m, i) => (
                <div key={i} className={m.who === "you" ? "flex justify-end" : "animate-fade-up"}>
                  {m.who === "you" ? (
                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-ink px-5 py-3.5 text-[15px] leading-relaxed text-paper">
                      {m.text}
                    </div>
                  ) : (
                    <div className="max-w-[90%] border-l-2 border-tan/30 pl-5">
                      <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-tan">
                        You · {horizon} years on
                      </div>
                      <p className="font-display text-[19px] leading-[1.5] italic text-ink-soft">
                        {m.text}
                        {loading && i === messages.length - 1 && (
                          <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-tan align-middle" />
                        )}
                      </p>
                      {m.remembered && (
                        <div className="mt-4">
                          <MemoryPill
                            label="what your future self remembered"
                            receipts={m.remembered.receipts}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {ready !== false && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
            <div className="mx-auto flex max-w-[58ch] items-end gap-3 px-6 py-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask the thing you actually want to know…"
                className="min-h-[44px] max-h-40 flex-1 resize-none rounded-2xl border border-rule bg-card px-4 py-3 font-display text-[17px] italic leading-snug text-ink placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-tan/30"
              />
              <button
                onClick={send}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-medium text-paper transition-opacity disabled:opacity-30"
                disabled={!draft.trim() || loading}
              >
                Send
              </button>
            </div>
            <div className="flex flex-col items-center gap-1 pb-3">
              <p className="text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                a mirror, not a prophecy · only you can read this
              </p>
            </div>
          </div>
        )}
      </section>
    </Shell>
  );
}
