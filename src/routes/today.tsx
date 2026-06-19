import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";
import { useState } from "react";

export const Route = createFileRoute("/today")({
  head: () => ({
    meta: [
      { title: "Today — Knole" },
      { name: "description", content: "Your daily journaling loop." },
    ],
  }),
  component: TodayPage,
});

const prompts = [
  "A high point",
  "Something you're looking forward to",
  "A struggle",
  "Just open space",
];

const sampleEntry =
  "I'm thinking about the garden project again. It's been months since I actually sat out there and just enjoyed the silence. I feel like I've been running on a treadmill of minor tasks. Maybe the soil is ready now.";

function TodayPage() {
  const [prompt, setPrompt] = useState(prompts[1]);
  const [entry, setEntry] = useState(sampleEntry);
  const [reflected, setReflected] = useState(false);
  const [deeper, setDeeper] = useState(false);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-10 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Today</h1>
            <span className="text-[12px] tabular-nums text-muted-foreground">{today}</span>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {prompts.map((p) => {
              const active = prompt === p;
              return (
                <button
                  key={p}
                  onClick={() => setPrompt(p)}
                  className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                    active
                      ? "bg-ink text-paper"
                      : "border border-rule text-muted-foreground hover:text-ink"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-rule bg-card/50 p-8">
            <p className="font-display text-[18px] italic text-muted-foreground">{prompt}.</p>

            <textarea
              value={entry}
              onChange={(e) => {
                setEntry(e.target.value);
                setReflected(false);
                setDeeper(false);
              }}
              rows={6}
              className="mt-4 w-full resize-none border-none bg-transparent font-display text-[22px] leading-[1.5] text-ink placeholder:text-muted-foreground/60 focus:outline-none"
              placeholder="Write what's true, even if it's small."
            />

            {!reflected && entry.trim().length > 10 && (
              <div className="mt-6 flex items-center justify-between border-t border-rule pt-5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {entry.trim().split(/\s+/).length} words
                </span>
                <button
                  onClick={() => setReflected(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper"
                >
                  Reflect
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            )}

            {reflected && (
              <div className="animate-fade-up mt-8 border-l-2 border-tan/40 pl-6">
                <div className="mb-3">
                  <MemoryPill
                    label="Knole remembered"
                    receipts={[
                      {
                        date: "Oct 14 · your entry",
                        quote:
                          "I've been running on empty. The garden is overgrown and I can't make myself care.",
                      },
                      {
                        date: "Sep 02 · your entry",
                        quote:
                          "I told Sam I'd plant the bulbs before the first frost. I keep finding reasons not to.",
                      },
                    ]}
                  />
                </div>
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  It's interesting you use the phrase{" "}
                  <span className="italic underline decoration-tan/40 decoration-2 underline-offset-4">
                    "the soil is ready."
                  </span>{" "}
                  Last autumn you wrote about the garden as a metaphor for your own burnout. Are
                  you feeling like you've finally rested enough to start something — or is part of
                  you still waiting for permission?
                </p>

                {!deeper ? (
                  <button
                    onClick={() => setDeeper(true)}
                    className="mt-5 text-[11px] uppercase tracking-[0.18em] text-tan hover:text-ink"
                  >
                    Go deeper →
                  </button>
                ) : (
                  <div className="animate-fade-up mt-6 border-t border-rule pt-5">
                    <p className="text-[15px] leading-relaxed text-ink-soft">
                      If a friend showed up tomorrow with a trowel and said,{" "}
                      <span className="italic">"let's just do an hour"</span> — would the relief be
                      louder than the resistance?
                    </p>
                    <p className="mt-4 text-[12px] italic text-muted-foreground">
                      One question is enough for tonight. Close the book — go live the answer.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-10 flex items-center justify-between text-[12px] text-muted-foreground">
            <Link to="/remembered" className="hover:text-ink">
              ← a memory from before
            </Link>
            <Link to="/the-index" className="hover:text-ink">
              what Knole knows about you →
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
