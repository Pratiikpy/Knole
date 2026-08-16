import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Shell } from "@/components/knole/Shell";
import { Composing } from "@/components/knole/Composing";
import { Pulse } from "@/components/knole/Pulse";
import { MoodWeather } from "@/components/knole/MoodWeather";
import { MirrorCeremony } from "@/components/knole/MirrorCeremony";
import { SealedBadge } from "@/components/knole/SealedBadge";
import {
  mirrorFn,
  mirrorComposeFn,
  moodTrajectoryFn,
  moodBaselineFn,
  markMirrorSeenFn,
  correlationsFn,
  themesFn,
  journalStatsFn,
  mintProofFn,
} from "@/server/fns";

const EXPLORER = "https://chainscan.0g.ai";

// Proof-of-journaling (#11) — a provable habit, committed on-chain without revealing a word.
function ProofOfJournaling() {
  const getStats = useServerFn(journalStatsFn);
  const mint = useServerFn(mintProofFn);
  const [stats, setStats] = useState<{ distinctDays: number; currentStreak: number } | null>(null);
  const [proof, setProof] = useState<{ distinctDays: number; txHash: string; asOf: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getStats()
      .then((r) => {
        setStats(r.stats);
        setProof(r.proof);
      })
      .catch(() => {});
  }, [getStats]);
  if (!stats || stats.distinctDays < 1) return null;
  async function commit() {
    setBusy(true);
    try {
      const r = await mint();
      if (r.ok) setProof(r.proof);
    } catch {
      /* leave as-is */
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-6">
      <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-tan">
        Proof of journaling
      </div>
      <p className="font-display text-[20px] italic leading-snug text-ink-soft">
        You've reflected on {stats.distinctDays} {stats.distinctDays === 1 ? "day" : "days"}
        {stats.currentStreak > 1 ? ` · ${stats.currentStreak}-day streak` : ""}.
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Commit it on 0G Chain — a timestamped proof of the habit that reveals nothing you wrote.
      </p>
      {proof ? (
        <div className="mt-3 text-[12px]">
          <span className="text-tan">
            ✓ committed ({proof.distinctDays} days, {proof.asOf})
          </span>{" "}
          <a
            href={`${EXPLORER}/tx/${proof.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-muted-foreground hover:text-ink"
          >
            verify on 0G ↗
          </a>
        </div>
      ) : (
        <button
          onClick={commit}
          disabled={busy}
          className="mt-3 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
        >
          {busy ? "Committing on-chain…" : "Commit on-chain"}
        </button>
      )}
    </div>
  );
}

type Theme = { topic: string; pct: number; trend: "rising" | "declining" | "steady"; line: string };

// Themes / topics view (#34) — what you write about most, with tone + trend. Client-fetched, gated.
function Themes() {
  const getThemes = useServerFn(themesFn);
  const [items, setItems] = useState<Theme[] | null>(null);
  useEffect(() => {
    getThemes()
      .then((r) => setItems(r.ready ? r.themes : []))
      .catch(() => setItems([]));
  }, [getThemes]);
  if (!items || items.length === 0) return null;
  const arrow = (t: Theme["trend"]) => (t === "rising" ? "↗" : t === "declining" ? "↘" : "→");
  return (
    <div className="mt-8">
      <div className="mb-4 text-[10px] uppercase tracking-[0.22em] text-tan">
        What you write about
      </div>
      <div className="space-y-3">
        {items.map((t) => (
          <div key={t.topic} className="rounded-2xl border border-rule bg-card/50 p-5">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="font-display text-[18px] italic text-ink">{t.topic}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {t.pct}% · {arrow(t.trend)}
              </span>
            </div>
            <p className="text-[14px] leading-relaxed text-muted-foreground">{t.line}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type Correlation = {
  kind: "activity" | "topic" | "weekday";
  subject: string;
  delta: number;
  n: number;
  phrasing: string;
};

// Correlations over the person's own words (#1) — client-fetched so it never blocks the mirror loader,
// and only renders once there's enough data to be honest. The screenshot-able aha.
function Correlations() {
  const getCorrelations = useServerFn(correlationsFn);
  const [items, setItems] = useState<Correlation[] | null>(null);
  useEffect(() => {
    getCorrelations()
      .then((r) => setItems(r.ready ? r.correlations : []))
      .catch(() => setItems([]));
  }, [getCorrelations]);
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-8">
      <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-tan">
        Patterns in your days
      </div>
      <p className="mb-4 text-[12px] text-muted-foreground">
        Gentle correlations from your own entries — tendencies, not certainties.
      </p>
      <div className="space-y-3">
        {items.map((c) => (
          <div
            key={`${c.kind}:${c.subject}`}
            className="rounded-2xl border border-rule bg-card/50 p-5"
          >
            <p className="text-[16px] leading-relaxed text-ink-soft">{c.phrasing}</p>
            <div className="mt-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {c.kind} · {c.n} {c.n === 1 ? "day" : "days"} · {c.delta > 0 ? "+" : ""}
              {c.delta.toFixed(1)} mood
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Pattern Mirror — Knole" },
      {
        name: "description",
        content:
          "A private letter from yourself, about yourself. The throughline you couldn't see.",
      },
    ],
  }),
  loader: async () => {
    const [mirror, mood, baseline] = await Promise.all([
      mirrorFn(),
      moodTrajectoryFn(),
      moodBaselineFn(),
    ]);
    return { mirror, mood, baseline };
  },
  component: InsightsPage,
  pendingComponent: () => <Composing label="Composing your mirror…" />,
});

function Reveal({ label, text }: { label: string; text: string }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-7">
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">{label}</div>
      <p className="font-display text-[20px] italic leading-snug text-ink-soft">{text}</p>
    </div>
  );
}

/** The humble framing under the baseline overlay — and the once-a-week scale-drift notice.
 * A baseline shown too early is noise wearing a trendline, so before 21 logged days this only
 * says how far along it is. */
function BaselineNote({ baseline }: { baseline: import("@/server/baseline").BaselineResult }) {
  if (baseline.ready === false) {
    if (baseline.daysLogged < 3) return null; // brand-new journal — the chart's own empty state covers it
    return (
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        Your personal baseline appears after {baseline.daysNeeded} logged days — you're at{" "}
        {baseline.daysLogged}. It's a slow line on purpose: it should mean something.
      </p>
    );
  }
  return (
    <>
      {baseline.drift && (
        <div className="animate-fade-up mt-3 rounded-2xl border border-rule bg-card/60 p-5">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
            Your scale has shifted
          </div>
          <p className="max-w-[56ch] text-[13px] leading-relaxed text-ink-soft">
            The last ten days you called "about usual" have averaged{" "}
            {baseline.drift.direction === "up" ? "noticeably brighter" : "noticeably heavier"} than
            your center. That usually means your normal itself has moved — worth a line in tonight's
            entry about what changed.
          </p>
        </div>
      )}
    </>
  );
}

function Streak({ dayCount, entryCount }: { dayCount: number; entryCount: number }) {
  return (
    <div className="mt-8 flex items-center gap-4 rounded-2xl border border-rule bg-card/50 p-5">
      <div className="font-display text-[36px] italic leading-none text-tan">{dayCount}</div>
      <div>
        <div className="text-[13px] text-ink">
          {dayCount === 1 ? "day" : "days"} of quiet writing
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {entryCount} {entryCount === 1 ? "entry" : "entries"} · missed days don't count against
          you
        </div>
      </div>
    </div>
  );
}

function InsightsPage() {
  const { mirror: loadedMirror, mood, baseline } = Route.useLoaderData();
  const composeMirror = useServerFn(mirrorComposeFn);
  // The loader returns fast (never blocks SSR on the ~60s compose). When it comes back `composing`,
  // fetch the composition here and swap it in, showing an anticipation state meanwhile.
  const [m, setM] = useState(loadedMirror);
  const [mirrorFailed, setMirrorFailed] = useState(false);
  useEffect(() => {
    if (loadedMirror.composing)
      composeMirror()
        .then(setM)
        // A ~60s sealed LLM call is the most timeout-prone request in the app; without this the
        // page sat on "Composing your mirror…" forever with no error and no retry.
        .catch(() => setMirrorFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const retryMirror = () => {
    setMirrorFailed(false);
    composeMirror()
      .then(setM)
      .catch(() => setMirrorFailed(true));
  };
  const maxWeight = Math.max(1, ...m.themes.map((t) => t.weight));
  const markMirrorSeen = useServerFn(markMirrorSeenFn);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    // Property access on localStorage THROWS (SecurityError) in Safari private mode and with
    // "block all cookies" — an uncaught throw here took out the first Mirror reveal entirely.
    let alreadySeen = false;
    try {
      alreadySeen = !!localStorage.getItem("knole.mirror.ceremony.v1");
    } catch {
      alreadySeen = false;
    }
    if (
      !m.composing &&
      m.phase === "revealed" &&
      m.firstReveal &&
      typeof window !== "undefined" &&
      !alreadySeen &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setPlay(true);
    }
  }, [m.phase, m.firstReveal, m.composing]);

  if (m.composing) {
    return (
      <Shell>
        <section className="px-6 pb-28 pt-12">
          <div className="mx-auto max-w-[60ch]">
            <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-tan">Pattern Mirror</p>
            <h1 className="mb-8 font-display text-[44px] italic leading-[1.02]">
              {mirrorFailed ? "The mirror didn't come back." : "Composing your mirror…"}
            </h1>
            {mirrorFailed && (
              <div className="mb-8">
                <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">
                  Composing takes a minute and the connection dropped. Nothing is lost — your
                  entries are untouched.
                </p>
                <button
                  onClick={retryMirror}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
                >
                  Compose it again
                </button>
              </div>
            )}
            <Composing label="Reading your fortnight — this takes a moment." />
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[60ch]">
          <div className="knole-stagger">
            <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-tan">Pattern Mirror</p>
            <h1 className="font-display text-[44px] italic leading-[1.02]">
              Here's what was on your mind.
            </h1>
            <p className="mt-3 max-w-[42ch] text-[13px] text-muted-foreground">
              A short, private letter from Knole — written from your own words. No one else will
              ever see this.
            </p>

            {m.phase !== "empty" && (
              <Link
                to="/wrapped"
                className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-tan hover:text-ink"
              >
                Make a shareable card — the shape, never the words →
              </Link>
            )}
            {m.phase !== "empty" && (
              <Link
                to="/year"
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-tan hover:text-ink"
              >
                See your year in one page →
              </Link>
            )}
          </div>

          {m.phase === "empty" ? (
            <div className="mt-12 rounded-2xl border border-rule bg-card/50 p-8">
              <p className="font-display text-[20px] italic leading-snug text-muted-foreground">
                Knole needs a few more entries before it can show you a pattern. Write on Today for
                a few days, then come back — the mirror fills in from your own words.
              </p>
            </div>
          ) : m.phase === "building" ? (
            <>
              <Streak dayCount={m.dayCount} entryCount={m.entryCount} />
              <MoodWeather data={mood} baseline={baseline} />
              <BaselineNote baseline={baseline} />
              <Correlations />
              <Themes />
              <ProofOfJournaling />

              {/* The anticipation — the day-15 arc building toward the reveal */}
              <div className="mt-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-7">
                <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                  Your first Mirror
                </div>
                <p className="font-display text-[24px] italic leading-snug text-ink-soft">
                  {m.daysToReveal === 1 ? "One more day." : `${m.daysToReveal} more days.`} On day
                  15, Knole shows you a pattern about yourself that no ordinary journal could see —
                  drawn from your own words, receipts and all.
                </p>
                <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-rule">
                  <div
                    className="h-full rounded-full bg-tan"
                    style={{ width: `${Math.min(100, (m.daysSinceFirst / 14) * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Day {m.daysSinceFirst} of 14 · keep writing on Today
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Streak — real */}
              <Streak dayCount={m.dayCount} entryCount={m.entryCount} />
              <MoodWeather data={mood} baseline={baseline} />
              <BaselineNote baseline={baseline} />
              <Correlations />
              <Themes />
              <ProofOfJournaling />

              {/* The throughline — the opening */}
              <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-7">
                <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                  The throughline
                </div>
                <p className="font-display text-[22px] italic leading-snug text-ink-soft">
                  {m.throughline}
                </p>
              </div>

              {/* The recurring patterns — each PROVEN with the user's own words (the receipt) */}
              {m.patterns.length > 0 && (
                <div className="mt-8">
                  <div className="mb-4 text-[10px] uppercase tracking-[0.22em] text-tan">
                    What keeps coming up
                  </div>
                  <div className="space-y-5">
                    {m.patterns.map((p, i) => (
                      <div key={i} className="rounded-2xl border border-rule bg-card/50 p-7">
                        <p className="font-display text-[20px] italic leading-snug text-ink-soft">
                          {p.text}
                        </p>
                        {p.quote && (
                          <div className="mt-4 border-l-2 border-tan/30 pl-4">
                            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              {p.date} · your own words
                            </div>
                            <p className="text-[14px] italic leading-relaxed text-muted-foreground">
                              "{p.quote}"
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Signature reveal — only what the words actually support */}
              <Reveal label="The contradiction" text={m.contradiction} />
              <Reveal label="The thing you're circling" text={m.avoided} />

              {/* Recurring themes — real */}
              {m.themes.length > 0 && (
                <div className="mt-12">
                  <h2 className="mb-4 font-display text-[22px] italic">Recurring</h2>
                  <ul className="space-y-2">
                    {m.themes.map((t) => (
                      <li
                        key={t.name}
                        className="flex items-center gap-4 rounded-xl border border-rule bg-card/40 px-5 py-3"
                      >
                        <span className="flex-1 font-display text-[18px] italic text-ink-soft">
                          {t.name}
                        </span>
                        <span
                          className="h-1.5 rounded-full bg-tan/60"
                          style={{ width: `${(t.weight / maxWeight) * 84 + 12}px` }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Dreaming — last night's overnight noticing */}
              {m.dream ? (
                <div className="mt-12 rounded-2xl border border-tan/30 bg-tan/[0.04] p-7">
                  <div className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                    <Pulse />
                    Dreaming · last night Knole noticed
                  </div>
                  <p className="font-display text-[20px] italic leading-snug text-ink-soft">
                    {m.dream.observation}
                  </p>
                </div>
              ) : (
                <div className="mt-12 rounded-xl border border-rule bg-card/40 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display text-[16px] italic text-ink">Dreaming</div>
                      <div className="mt-0.5 max-w-[44ch] text-[11px] text-muted-foreground">
                        Knole reflects on your days overnight and surfaces one new pattern here.
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      soon
                    </span>
                  </div>
                </div>
              )}

              {/* The proof — only you can read this */}
              <div className="mt-12 flex items-start gap-3 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
                <svg
                  className="mt-px size-4 shrink-0 text-tan"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
                </svg>
                <div>
                  <div className="text-[13px] text-ink">Anonymised before any AI saw it</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    Built from your own words and nothing else — names and places stripped out
                    before any AI read them. Your entries are encrypted and stored on 0G; seal them
                    to your wallet and not even we can read that copy.
                  </p>
                  <div className="mt-3">
                    <SealedBadge />
                  </div>
                </div>
              </div>

              <p className="mt-12 text-center text-[12px] italic text-muted-foreground">
                That's enough looking back. Go live your week.
              </p>
            </>
          )}
        </div>
      </section>
      {play && (
        <MirrorCeremony
          throughline={m.throughline}
          patterns={m.patterns}
          onDone={() => {
            setPlay(false);
            try {
              localStorage.setItem("knole.mirror.ceremony.v1", "1");
            } catch {
              /* ignore */
            }
            void markMirrorSeen().catch(() => {});
          }}
        />
      )}
    </Shell>
  );
}
