import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";
import { chatFn } from "@/server/fns";
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
};

const seed: Msg[] = [
  {
    who: "knole",
    text: "I'm here. What's on your mind tonight — a sentence, a feeling, a place?",
  },
];

function ChatPage() {
  const doChat = useServerFn(chatFn);
  const [messages, setMessages] = useState<Msg[]>(seed);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const send = async () => {
    const text = draft.trim();
    if (!text || loading) return;
    const history = messages.map((m) => ({
      role: (m.who === "you" ? "user" : "assistant") as "user" | "assistant",
      content: m.text,
    }));
    setMessages((m) => [...m, { who: "you", text }]);
    setDraft("");
    setLoading(true);
    try {
      const res = await doChat({ data: { message: text, history } });
      setMessages((m) => [...m, { who: "knole", text: res.reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { who: "knole", text: "Something interrupted me — say that again?" },
      ]);
    } finally {
      setLoading(false);
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
              One question at a time. You can correct me anytime — just say so.
            </p>
          </div>

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
                    </p>
                    {m.remembered && (
                      <div className="mt-4">
                        <MemoryPill label={m.remembered.label} receipts={m.remembered.receipts} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="animate-fade-up border-l-2 border-tan/30 pl-5">
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-tan">Knole</div>
                <p className="font-display text-[19px] italic text-muted-foreground">thinking…</p>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
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
          <p className="pb-3 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            encrypted · only you can read this
          </p>
        </div>
      </section>
    </Shell>
  );
}
