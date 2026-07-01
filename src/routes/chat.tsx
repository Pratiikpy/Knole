import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";
import { parseRecalledHeader } from "@/components/knole/recall";
import { CrisisCard } from "@/components/knole/CrisisCard";
import { whoamiFn, composeEntryFn } from "@/server/fns";
import { useState, useRef, useEffect } from "react";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Knole" },
      { name: "description", content: "Think out loud with Knole." },
    ],
  }),
  component: ChatPage,
});

type Msg = {
  who: "you" | "knole";
  text: string;
  remembered?: { label: string; receipts: { date: string; quote: string }[] };
  crisis?: boolean;
};

type Composed = { title: string; body: string; tags: string[]; mood: string | null };

const seed: Msg[] = [
  {
    who: "knole",
    text: "I'm here. What's on your mind tonight — a sentence, a feeling, a place?",
  },
];

// Chat is ephemeral now (saved only when you compose it into an entry) — keep the live transcript
// here so an accidental navigation doesn't lose the thread.
const RESTORE_KEY = "knole.chat.draft.v1";

function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>(seed);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composed, setComposed] = useState<Composed | null>(null);
  const [composeError, setComposeError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const hasUserTurn = messages.some((m) => m.who === "you");

  // A demo guest can't write (auth-gated). Learn that up front so send()/compose() show the honest
  // sign-in line directly instead of firing a doomed request that 401s into the console.
  const whoami = useServerFn(whoamiFn);
  const doCompose = useServerFn(composeEntryFn);
  const [demoGated, setDemoGated] = useState(false);
  useEffect(() => {
    let alive = true;
    whoami()
      .then((r) => alive && setDemoGated(!!r.isDemo && !!r.gated))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [whoami]);

  // Restore a half-finished thread on mount; persist it on every turn.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RESTORE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Msg[];
        if (Array.isArray(parsed) && parsed.length > 1) setMessages(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      if (messages.length > 1) localStorage.setItem(RESTORE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

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
    // Add the user turn + an empty Knole turn that fills in as the reply streams.
    setMessages((m) => [...m, { who: "you", text }, { who: "knole", text: "" }]);
    setDraft("");
    setLoading(true);
    setComposeError("");
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
    // Known demo guest: answer with the sign-in line directly — no doomed fetch, no 401 in the console.
    if (demoGated) {
      setLastKnole("Sign in to chat with your own Knole — you're viewing the demo.");
      setLoading(false);
      return;
    }
    try {
      // Non-persisting: the thread isn't saved per turn — "turn this into an entry" is the save.
      const res = await fetch("/chat/reflect-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!res.ok || !res.body) {
        setLastKnole(
          res.status === 401
            ? "Sign in to chat with your own Knole — you're viewing the demo."
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
      // Surface the "it remembered" receipts — recalled memories ride in a header, mirroring journal.
      const remembered = parseRecalledHeader(res.headers.get("x-knole-recalled"));
      const inCrisis = res.headers.get("x-knole-crisis") === "1";
      if (remembered || inCrisis) {
        setMessages((m) => {
          const copy = m.slice();
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].who === "knole") {
              copy[i] = {
                ...copy[i],
                remembered: remembered ?? copy[i].remembered,
                crisis: inCrisis,
              };
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

  const compose = async () => {
    if (!hasUserTurn || loading || composing) return;
    setComposeError("");
    if (demoGated) {
      setComposeError("Sign in to save your conversation as an entry — you're viewing the demo.");
      return;
    }
    setComposing(true);
    try {
      const history = messages
        .filter((m) => m.text.trim())
        .map((m) => ({
          role: (m.who === "you" ? "user" : "assistant") as "user" | "assistant",
          content: m.text,
        }));
      const r = await doCompose({ data: { history } });
      setComposed({ title: r.title, body: r.body, tags: r.tags, mood: r.mood });
      setMessages(seed); // fresh thread; the entry now lives in the journal
      try {
        localStorage.removeItem(RESTORE_KEY);
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setComposeError(
        "Couldn't compose that just now — your conversation is still here. Try again.",
      );
    } finally {
      setComposing(false);
    }
  };

  return (
    <Shell>
      <section className="px-6 pb-32 pt-10">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-10">
            <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              An open conversation
            </p>
            <h1 className="font-display text-[40px] italic leading-none">Think out loud.</h1>
            <p className="mt-3 text-[14px] text-muted-foreground">
              Talk freely — nothing's saved until you turn it into an entry. One question at a time.
            </p>
          </div>

          {composed && (
            <div className="animate-fade-up mb-10 rounded-2xl border border-tan/30 bg-tan/[0.05] p-7">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.22em] text-tan">
                  Saved to your journal
                </span>
                <button
                  onClick={() => setComposed(null)}
                  className="text-[11px] text-muted-foreground hover:text-ink"
                >
                  dismiss
                </button>
              </div>
              {composed.title && (
                <h2 className="font-display text-[26px] italic leading-tight text-ink">
                  {composed.title}
                </h2>
              )}
              <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                {composed.body}
              </p>
              {(composed.tags.length > 0 || composed.mood) && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {composed.mood && (
                    <span className="rounded-full bg-tan/10 px-3 py-1 text-[11px] italic text-tan">
                      {composed.mood}
                    </span>
                  )}
                  {composed.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-tan/30 px-3 py-1 text-[11px] text-tan"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <Link
                to="/the-index"
                className="mt-5 inline-block text-[12px] text-tan hover:text-ink"
              >
                see what Knole remembered →
              </Link>
            </div>
          )}

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
                      Knole
                    </div>
                    <p className="font-display text-[19px] leading-[1.5] italic text-ink-soft">
                      {m.text}
                      {loading && i === messages.length - 1 && (
                        <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-tan align-middle" />
                      )}
                    </p>
                    {m.remembered && (
                      <div className="mt-4">
                        <MemoryPill label={m.remembered.label} receipts={m.remembered.receipts} />
                      </div>
                    )}
                    {m.crisis && (
                      <div className="mt-4">
                        <CrisisCard />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
          {(hasUserTurn || composeError) && (
            <div className="mx-auto flex max-w-[58ch] items-center justify-between gap-3 px-6 pt-2.5">
              <span className="text-[11px] text-destructive">{composeError}</span>
              <button
                onClick={compose}
                disabled={!hasUserTurn || loading || composing}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-tan/40 px-3.5 py-1.5 text-[11px] font-medium text-tan transition-colors hover:bg-tan/[0.06] disabled:opacity-30"
              >
                {composing ? "Composing…" : "Turn this into an entry →"}
              </button>
            </div>
          )}
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
              placeholder="Say the small true thing first…"
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
              anonymised before any AI · encrypted, yours
            </p>
          </div>
        </div>
      </section>
    </Shell>
  );
}
