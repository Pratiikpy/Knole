import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";

export const Route = createFileRoute("/remembered")({
  head: () => ({
    meta: [
      { title: "A memory — Knole" },
      { name: "description", content: "Knole brought something back." },
    ],
  }),
  component: RememberedPage,
});

function RememberedPage() {
  return (
    <Shell>
      <section className="px-6 pb-28 pt-16">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-3 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-tan">
            <span className="size-1.5 rounded-full bg-tan animate-breathe" />
            On this day · seven weeks ago
          </div>
          <h1 className="font-display text-[44px] leading-[1.02] italic">
            Something you said is asking to be heard again.
          </h1>

          <div className="relative mt-14">
            {/* Past entry */}
            <div className="rounded-2xl border border-rule bg-card/40 p-7">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  September 02 · evening
                </span>
                <span className="font-display text-xs italic text-muted-foreground">past you</span>
              </div>
              <p className="font-display text-[22px] italic leading-snug text-ink-soft">
                "I told Sam I'd plant the bulbs before the first frost. I keep finding reasons not
                to. It's not the bulbs. It's that planting them means I believe I'll be here, in
                this house, for the spring."
              </p>
            </div>

            {/* Thread SVG */}
            <div className="relative mx-auto h-32 w-px">
              <svg viewBox="0 0 2 128" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="thread" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#8c7355" stopOpacity="0" />
                    <stop offset="50%" stopColor="#8c7355" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#8c7355" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line
                  x1="1"
                  y1="0"
                  x2="1"
                  y2="128"
                  stroke="url(#thread)"
                  strokeWidth="1.5"
                  className="animate-thread"
                />
              </svg>
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-2.5 rounded-full bg-tan/70 shadow-[0_0_18px_rgba(140,115,85,0.6)] animate-breathe" />
            </div>

            {/* Today's entry */}
            <div className="rounded-2xl border border-tan/30 bg-tan/[0.04] p-7 shadow-[0_30px_80px_-50px_rgba(140,115,85,0.4)]">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-tan">Today</span>
                <span className="font-display text-xs italic text-muted-foreground">now</span>
              </div>
              <p className="text-[15px] leading-relaxed text-ink-soft">
                You haven't mentioned the bulbs since. The first frost was last week. Before we
                write tonight, I want to ask — gently — whether the question underneath the bulbs
                is still living somewhere inside you.
              </p>
              <div className="mt-5">
                <MemoryPill
                  label="why Knole brought this up"
                  receipts={[
                    {
                      date: "Sep 02 · your entry",
                      quote:
                        "Planting them means I believe I'll be here, in this house, for the spring.",
                    },
                    {
                      date: "Sep 18 · your entry",
                      quote: "Sam asked again. I changed the subject.",
                    },
                    {
                      date: "Oct 21 · weather",
                      quote: "First frost recorded in your area.",
                    },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="mt-14 flex items-center justify-between">
            <button className="text-[12px] text-muted-foreground hover:text-ink">
              not now — bring it up another day
            </button>
            <Link
              to="/today"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper"
            >
              answer it
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
