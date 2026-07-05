import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { lifeCanvasFn } from "@/server/fns";
import type { LifeCanvas } from "@/server/lifeCanvas";

export const Route = createFileRoute("/canvas")({
  head: () => ({
    meta: [
      { title: "Your Canvas — Knole" },
      {
        name: "description",
        content:
          "Everything Knole has learned about you, from your own words — private, and only yours.",
      },
    ],
  }),
  loader: async () => await lifeCanvasFn(),
  component: CanvasPage,
});

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// A warm→cool tint from a -1..1 tone: positive leans tan/gold, negative leans muted slate.
function toneStyle(v: number): { bg: string; ring: string; fg: string } {
  const t = clamp((v + 1) / 2, 0, 1); // 0 = low, 1 = high
  if (t >= 0.55)
    return { bg: "rgba(124,101,69,0.12)", ring: "rgba(124,101,69,0.30)", fg: "#7c6545" };
  if (t <= 0.42) return { bg: "rgba(90,95,105,0.10)", ring: "rgba(90,95,105,0.22)", fg: "#5b6068" };
  return { bg: "rgba(28,25,23,0.05)", ring: "rgba(28,25,23,0.12)", fg: "#2a2724" };
}

function MoodArc({
  points,
}: {
  points: { day: string; valence: number; label: string; snippet: string }[];
}) {
  const W = 760;
  const H = 180;
  const pad = 22;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : pad + (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => pad + (1 - (clamp(v, -1, 1) + 1) / 2) * (H - 2 * pad);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.valence).toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;
  const baseline = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Your mood over time">
      <defs>
        <linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(124,101,69,0.22)" />
          <stop offset="100%" stopColor="rgba(124,101,69,0.02)" />
        </linearGradient>
      </defs>
      <line
        x1={pad}
        y1={baseline}
        x2={W - pad}
        y2={baseline}
        stroke="rgba(28,25,23,0.12)"
        strokeDasharray="3 5"
      />
      <path d={area} fill="url(#moodFill)" />
      <path
        d={line}
        fill="none"
        stroke="#7c6545"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.valence)} r="4" fill="#faf9f6" stroke="#7c6545" strokeWidth="2">
            <title>{`${p.day} · ${p.label}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

function CanvasPage() {
  // The route loader-data type infers to a broad union under this TanStack/TS combo; pin it to the
  // source type so the whole page is properly typed.
  const c = Route.useLoaderData() as unknown as LifeCanvas;
  const { stats } = c;
  const themes = [...c.themes].sort((a, b) => b.pct - a.pct).slice(0, 10);
  const gridN = Math.min(Math.max(stats.daysSinceFirst + 1, 21), 42);
  const filled = Math.min(stats.dayCount, gridN);
  const moodPts = c.mood.points.map((p) => ({
    day: p.day,
    valence: p.valence,
    label: p.label,
    snippet: p.snippet,
  }));

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[68ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-tan">The Canvas</p>
          <h1 className="font-display text-balance text-[46px] italic leading-[1.02] md:text-[56px]">
            Your life, in one view.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
            Everything Knole has learned about you — your moods, the themes you circle, the people
            in your life, the shape of your months — drawn entirely from your own words. No one else
            can see this, and no other product can make it: it's the artifact only your own data
            draws.
          </p>

          {/* stat row */}
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { n: stats.entryCount, l: "entries" },
              { n: stats.dayCount, l: "days written" },
              { n: stats.memoryCount, l: "memories" },
              { n: themes.length, l: "themes" },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl border border-rule bg-card/40 px-5 py-4">
                <div className="font-display text-[34px] leading-none text-ink">{s.n}</div>
                <div className="mt-1.5 text-[12px] text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>

          {/* mood arc */}
          <div className="mt-6 rounded-2xl border border-rule bg-card/40 p-6">
            <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-tan">
              Your emotional weather
            </div>
            <p className="mb-4 text-[13px] text-muted-foreground">
              Your own mood, traced across the days you wrote.
            </p>
            {moodPts.length >= 2 ? (
              <MoodArc points={moodPts} />
            ) : (
              <p className="font-display text-[17px] italic text-muted-foreground">
                This fills in once Knole has read a few more days — your mood, traced over time.
              </p>
            )}
          </div>

          {/* theme constellation */}
          <div className="mt-6 rounded-2xl border border-rule bg-card/40 p-6">
            <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-tan">
              What you keep circling
            </div>
            <p className="mb-5 text-[13px] text-muted-foreground">
              The themes across your writing — bigger means more present, warmer means it lands
              well.
            </p>
            {themes.length ? (
              <div className="flex flex-wrap items-center gap-3">
                {themes.map((t) => {
                  const size = 15 + clamp(t.pct, 0, 0.6) * 34;
                  const s = toneStyle(t.avgValence);
                  return (
                    <span
                      key={t.topic}
                      title={t.line}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-display leading-none"
                      style={{
                        fontSize: `${size}px`,
                        background: s.bg,
                        boxShadow: `inset 0 0 0 1px ${s.ring}`,
                        color: s.fg,
                      }}
                    >
                      {t.topic}
                      {t.trend === "rising" && <span className="text-[0.6em] opacity-70">↑</span>}
                      {t.trend === "declining" && (
                        <span className="text-[0.6em] opacity-70">↓</span>
                      )}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="font-display text-[17px] italic text-muted-foreground">
                Your themes surface once Knole has read a handful of entries.
              </p>
            )}
          </div>

          {/* cast of characters */}
          <div className="mt-6 rounded-2xl border border-rule bg-card/40 p-6">
            <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-tan">
              The people in your life
            </div>
            <p className="mb-5 text-[13px] text-muted-foreground">
              Who keeps appearing in your words, in Knole's own read.
            </p>
            {c.cast.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {c.cast.map((m, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-rule bg-paper/40 px-4 py-3 text-[14px] leading-relaxed text-ink-soft"
                  >
                    {m}
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-display text-[17px] italic text-muted-foreground">
                The people you write about will gather here as Knole gets to know your world.
              </p>
            )}
          </div>

          {/* journey grid */}
          <div className="mt-6 rounded-2xl border border-rule bg-card/40 p-6">
            <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-tan">
              Days you showed up
            </div>
            <p className="mb-5 text-[13px] text-muted-foreground">
              {stats.dayCount} {stats.dayCount === 1 ? "day" : "days"} of quiet writing — missed
              days don't count against you.
            </p>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
            >
              {Array.from({ length: gridN }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square rounded-[3px] ${i < filled ? "bg-tan/70" : "bg-ink/[0.06]"}`}
                />
              ))}
            </div>
          </div>

          <p className="mt-8 text-center text-[12px] text-muted-foreground">
            🔒 Private · encrypted on 0G · only you can see this ·{" "}
            <Link to="/insights" className="text-tan hover:text-ink">
              back to your mirror
            </Link>
          </p>
        </div>
      </section>
    </Shell>
  );
}
