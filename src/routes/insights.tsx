import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Pattern Mirror — Knole" },
      {
        name: "description",
        content:
          "A weekly letter from yourself, about yourself. The throughline you couldn't see.",
      },
    ],
  }),
  component: InsightsPage,
});

const mood = [
  { d: "Mon", v: 0.55 },
  { d: "Tue", v: 0.38 },
  { d: "Wed", v: 0.42 },
  { d: "Thu", v: 0.6 },
  { d: "Fri", v: 0.72 },
  { d: "Sat", v: 0.85 },
  { d: "Sun", v: 0.7 },
];

const themes = [
  { name: "the garden", count: 6 },
  { name: "Sam", count: 5 },
  { name: "rest vs. avoidance", count: 4 },
  { name: "your father", count: 2 },
  { name: "the deadline", count: 9 },
];

function InsightsPage() {
  const max = Math.max(...mood.map((m) => m.v));
  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[60ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-tan">
            Pattern Mirror · Week of October 14
          </p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Here's what was on your mind.
          </h1>
          <p className="mt-3 max-w-[42ch] text-[13px] text-muted-foreground">
            A short, private letter from Knole — written from your own words this week.
            No one else will ever see this.
          </p>

          {/* Streak — gentle, with Freeze */}
          <div className="mt-8 flex items-center justify-between rounded-2xl border border-rule bg-card/50 p-5">
            <div className="flex items-center gap-4">
              <div className="font-display text-[36px] italic leading-none text-tan">11</div>
              <div>
                <div className="text-[13px] text-ink">days of quiet writing</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  2 Freezes available · missed days don't count against you
                </div>
              </div>
            </div>
            <button className="rounded-full border border-rule px-3.5 py-1.5 text-[11px] text-muted-foreground hover:text-ink">
              Use a Freeze
            </button>
          </div>

          {/* The throughline */}
          <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-7">
            <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
              The throughline
            </div>
            <p className="font-display text-[22px] italic leading-snug text-ink-soft">
              You spent most of the week trying to tell the difference between rest and
              avoidance. By Friday, you'd stopped trying to decide — and the garden showed up
              in three entries in a row.
            </p>
          </div>

          {/* Mood chart */}
          <div className="mt-10">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-[22px] italic">How the week felt</h2>
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                from your own words
              </span>
            </div>
            <div className="flex h-44 items-end gap-3 rounded-xl border border-rule bg-card/40 p-6">
              {mood.map((m) => (
                <div key={m.d} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-full w-full items-end">
                    <div
                      className="w-full rounded-t-md bg-tan/60 transition-all"
                      style={{ height: `${(m.v / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {m.d}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recurring themes */}
          <div className="mt-12">
            <h2 className="mb-4 font-display text-[22px] italic">Recurring this week</h2>
            <ul className="space-y-2">
              {themes
                .sort((a, b) => b.count - a.count)
                .map((t) => (
                  <li
                    key={t.name}
                    className="flex items-center justify-between rounded-xl border border-rule bg-card/40 px-5 py-3"
                  >
                    <span className="font-display text-[18px] italic text-ink-soft">
                      {t.name}
                    </span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {t.count} mentions
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          {/* On this day */}
          <div className="mt-14 rounded-2xl border border-tan/30 bg-tan/[0.04] p-7">
            <div className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-tan">
              <span className="size-1.5 rounded-full bg-tan animate-breathe" />
              One year ago today
            </div>
            <p className="font-display text-[22px] italic leading-snug text-ink-soft">
              "I keep thinking about the kind of person I want to be by next October.
              Less reactive. More tender with myself. We'll see."
            </p>
            <p className="mt-3 text-[12px] text-muted-foreground">Oct 24 · last year</p>
            <Link
              to="/today"
              className="mt-5 inline-flex items-center gap-2 text-[12px] text-tan hover:text-ink"
            >
              answer your past self →
            </Link>
          </div>

          {/* Private Wrapped tease */}
          <div className="mt-10 rounded-2xl border border-rule bg-gradient-to-br from-tan/[0.08] to-transparent p-7">
            <div className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-tan">
              <span className="size-1.5 rounded-full bg-tan" />
              Private Wrapped · arriving Nov 1
            </div>
            <p className="font-display text-[22px] italic leading-snug text-ink-soft">
              Your October, in your own words — moods, themes, the words you used most about
              yourself. Private by default. Yours to share or never share.
            </p>
          </div>

          {/* Dreaming */}
          <div className="mt-10 rounded-xl border border-rule bg-card/40 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-[16px] italic text-ink">Dreaming</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Knole quietly reflects on your week overnight. You'll wake to one new
                  pattern in the Mirror.
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-tan">on</span>
            </div>
          </div>

          <p className="mt-12 text-center text-[12px] italic text-muted-foreground">
            That's enough looking back. Go live your week.
          </p>
        </div>
      </section>
    </Shell>
  );
}
