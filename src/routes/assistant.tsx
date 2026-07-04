import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { CrisisCard } from "@/components/knole/CrisisCard";
import { useRef, useState } from "react";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Ask Knole — Knole" },
      {
        name: "description",
        content: "A private assistant that knows your life and can't read your data.",
      },
    ],
  }),
  component: AssistantPage,
});

type Turn = { role: "you" | "knole"; text: string };

function AssistantPage() {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [crisis, setCrisis] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    const history = messages;
    setMessages((m) => [...m, { role: "you", text: q }, { role: "knole", text: "" }]);
    setInput("");
    setBusy(true);
    setCrisis(false);
    const setLast = (text: string) =>
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: "knole", text };
        return c;
      });
    try {
      const res = await fetch("/assistant/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      if (!res.ok || !res.body) {
        setLast(
          res.status === 429
            ? "A moment — too many at once. Try again shortly."
            : "Something interrupted me — try again in a moment.",
        );
        return;
      }
      if (res.headers.get("x-knole-crisis") === "1") setCrisis(true);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setLast(acc);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch {
      setLast("Something interrupted me — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[62ch]">
          <h1 className="mb-1 font-display text-[44px] italic leading-none">Ask Knole</h1>
          <p className="mb-8 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
            Anything — a question, a hard email to draft, a decision to weigh. Private by
            architecture: your name is stripped before the model sees it, and nothing here is saved
            to your journal. A ChatGPT that knows you and can't read your data.
          </p>

          {messages.length === 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {[
                "Help me draft a kind but firm reply to my landlord",
                "Talk me through whether to take the new job",
                "What should I say to reconnect with an old friend?",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="rounded-full border border-rule px-3 py-1.5 text-left text-[12px] text-muted-foreground hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="mb-4 max-h-[56vh] space-y-5 overflow-y-auto">
            {messages.map((m, i) =>
              m.role === "you" ? (
                <div key={i}>
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    you
                  </span>
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
                    {m.text}
                  </p>
                </div>
              ) : (
                <div key={i} className="border-l-2 border-tan/40 pl-5">
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                    {m.text || <span className="italic text-muted-foreground">thinking…</span>}
                    {busy && i === messages.length - 1 && m.text && (
                      <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-tan align-middle" />
                    )}
                  </p>
                  {crisis && i === messages.length - 1 && (
                    <div className="mt-3">
                      <CrisisCard />
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          <div className="sticky bottom-4 rounded-2xl border border-rule bg-card/70 p-3 backdrop-blur">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
              }}
              rows={2}
              placeholder="Ask anything…"
              className="w-full resize-none border-none bg-transparent text-[15px] leading-relaxed text-ink placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">private · ⌘↵ to send</span>
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
              >
                {busy ? "…" : "Ask"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </Shell>
  );
}
