import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { useState } from "react";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask My Life — Knole" },
      {
        name: "description",
        content: "Search your own past. Knole answers with receipts from your own words.",
      },
    ],
  }),
  component: AskPage,
});

const suggestions = [
  "When was I last this stressed?",
  "What was I saying about work in March?",
  "How do I usually talk about my mother?",
  "What did I say I'd do this summer?",
  "When did I last feel proud of myself?",
];

type Receipt = { date: string; quote: string; tag: string };

const answer: { summary: string; receipts: Receipt[] } = {
  summary:
    "You've called yourself \"stressed\" sixteen times this year. The pattern is sharpest in the week before a deadline — and it almost always softens after a long walk or a phone call with Rossi. The last spike was nine days ago.",
  receipts: [
    {
      date: "Oct 16",
      tag: "your entry",
      quote:
        "I haven't slept properly in four days. Every email feels like it's shouting.",
    },
    {
      date: "Jul 04",
      tag: "your entry",
      quote:
        "Same tight feeling in my chest as before the Brussels trip. I should call Rossi.",
    },
    {
      date: "Mar 22",
      tag: "your entry",
      quote: "The deadline week always does this to me. I keep forgetting that.",
    },
  ],
};

function AskPage() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  const submit = (text: string) => {
    if (!text.trim()) return;
    setAsked(text);
    setQ(text);
  };

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Ask My Life
          </p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Your past, with receipts.
          </h1>
          <p className="mt-4 max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
            Search your own words. Knole will quote you back to yourself — never paraphrase
            without showing where it came from.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(q);
            }}
            className="mt-10 flex items-center gap-2 rounded-2xl border border-rule bg-card px-4 py-3 focus-within:ring-2 focus-within:ring-tan/30"
          >
            <svg viewBox="0 0 24 24" className="size-5 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask anything you've ever said to yourself…"
              className="flex-1 bg-transparent font-display text-[19px] italic text-ink placeholder:text-muted-foreground/60 focus:outline-none"
            />
            {q && (
              <button
                type="submit"
                className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper"
              >
                Ask
              </button>
            )}
          </form>

          {!asked && (
            <div className="mt-8 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-full border border-rule px-3.5 py-1.5 text-[12px] italic text-muted-foreground hover:border-ink/20 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {asked && (
            <div className="animate-fade-up mt-12">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                The throughline
              </div>
              <p className="font-display text-[22px] italic leading-snug text-ink-soft">
                {answer.summary}
              </p>

              <div className="mt-10">
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-rule" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    receipts · your own words
                  </span>
                  <div className="h-px flex-1 bg-rule" />
                </div>

                <ul className="space-y-4">
                  {answer.receipts.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-rule bg-card/50 p-5"
                    >
                      <div className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <span>{r.date}</span>
                        <span>{r.tag}</span>
                      </div>
                      <p className="font-display text-[17px] italic leading-snug text-ink-soft">
                        "{r.quote}"
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
