import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/knole/Shell";
import { calendarMonthFn, journalAnalyticsFn } from "@/server/fns";
import type { CalendarDay, JournalStats } from "@/server/calendar";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Knole" },
      { name: "description", content: "Your days, colored by how they actually felt." },
    ],
  }),
  component: CalendarPage,
});

// Valence → a restrained five-tone scale that stays inside Knole's palette: heavy days sit dark
// and cool, bright days warm and golden. No traffic lights — a journal, not a dashboard.
const TONES = [
  { min: -1.01, cls: "bg-[#4a4457]", name: "heavy" },
  { min: -0.5, cls: "bg-[#7a7382]", name: "low" },
  { min: -0.15, cls: "bg-[#a79e90]", name: "okay" },
  { min: 0.15, cls: "bg-[#a98a5e]", name: "good" },
  { min: 0.5, cls: "bg-[#c2a15e]", name: "bright" },
];
const toneFor = (v: number | null): (typeof TONES)[number] => {
  if (v === null) return TONES[2];
  for (let i = TONES.length - 1; i >= 0; i--) if (v >= TONES[i].min) return TONES[i];
  return TONES[0];
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

type MonthData = {
  year: number;
  month: number;
  days: CalendarDay[];
  streak: { current: number; longest: number; totalDays: number };
};

function CalendarPage() {
  const load = useServerFn(calendarMonthFn);
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState<MonthData | null>(null);
  const [sel, setSel] = useState<CalendarDay | null>(null);
  const getStats = useServerFn(journalAnalyticsFn);
  const [stats, setStats] = useState<JournalStats | null>(null);
  useEffect(() => {
    let alive = true;
    getStats()
      .then((s) => alive && setStats(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    setSel(null);
    load({ data: ym })
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym.year, ym.month]);

  const move = (delta: number) => {
    setYm((c) => {
      const m = c.month + delta;
      if (m < 1) return { year: c.year - 1, month: 12 };
      if (m > 12) return { year: c.year + 1, month: 1 };
      return { year: c.year, month: m };
    });
  };

  // Build the week rows: Monday-first grid, each week split into runs of consecutive journaled
  // days (the June connected-pill look) and single empty cells.
  const weeks = useMemo(() => {
    const daysInMonth = new Date(ym.year, ym.month, 0).getDate();
    const firstDow = (new Date(ym.year, ym.month - 1, 1).getDay() + 6) % 7; // 0 = Monday
    const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
    const cells: ({ day: number; info: CalendarDay | null } | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${ym.year}-${String(ym.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, info: byDate.get(key) ?? null });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [ym.year, ym.month, data]);

  const isFutureMonth =
    ym.year > now.getFullYear() || (ym.year === now.getFullYear() && ym.month > now.getMonth() + 1);

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[64ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Calendar</h1>
            <Link to="/today" className="text-[12px] text-muted-foreground hover:text-ink">
              back to today →
            </Link>
          </div>
          <p className="mb-8 text-[15px] leading-relaxed text-muted-foreground">
            Your days, colored by how they actually felt. Consecutive days join into a run — the
            shape of a habit, visible.
          </p>

          {/* Streak tiles */}
          {data && (
            <div className="mb-8 grid grid-cols-3 gap-3">
              {[
                { n: data.streak.current, label: "day streak", live: data.streak.current > 0 },
                { n: data.streak.longest, label: "longest run", live: false },
                { n: data.streak.totalDays, label: "days written", live: false },
              ].map((s) => (
                <div
                  key={s.label}
                  className={`rounded-2xl border p-4 text-center ${
                    s.live ? "border-tan/40 bg-tan/[0.06]" : "border-rule bg-card/50"
                  }`}
                >
                  <div className="font-display text-[30px] italic leading-none text-ink">{s.n}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Month header */}
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => move(-1)}
              className="rounded-full border border-rule px-3 py-1.5 text-[13px] text-muted-foreground hover:text-ink"
              aria-label="previous month"
            >
              ←
            </button>
            <div className="font-display text-[22px] italic">
              {MONTH_NAMES[ym.month - 1]} {ym.year}
            </div>
            <button
              onClick={() => move(1)}
              disabled={isFutureMonth}
              className="rounded-full border border-rule px-3 py-1.5 text-[13px] text-muted-foreground hover:text-ink disabled:opacity-30"
              aria-label="next month"
            >
              →
            </button>
          </div>

          {/* Grid */}
          <div className="rounded-2xl border border-rule bg-card/50 p-4">
            <div className="mb-2 grid grid-cols-7 text-center">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={i}
                  className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70"
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {weeks.map((row, wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {row.map((cell, ci) => {
                    if (!cell) return <div key={ci} className="h-10" />;
                    const journaled = !!cell.info;
                    const prev = ci > 0 ? row[ci - 1] : null;
                    const next = ci < 6 ? row[ci + 1] : null;
                    const joinL = journaled && !!prev?.info;
                    const joinR = journaled && !!next?.info;
                    const tone = cell.info ? toneFor(cell.info.valence) : null;
                    return (
                      <button
                        key={ci}
                        onClick={() => cell.info && setSel(cell.info)}
                        className={`relative h-10 text-[12px] tabular-nums transition-opacity ${
                          journaled ? "text-paper hover:opacity-90" : "text-muted-foreground/60"
                        }`}
                      >
                        {journaled && (
                          <span
                            className={`absolute inset-y-1 ${tone?.cls} ${
                              joinL ? "left-0" : "left-1 rounded-l-full"
                            } ${joinR ? "right-0" : "right-1 rounded-r-full"} ${
                              sel && sel.date === cell.info?.date ? "ring-2 ring-ink/40" : ""
                            }`}
                          />
                        )}
                        <span className="relative">{cell.day}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Tone legend */}
            <div className="mt-4 flex items-center justify-center gap-3">
              {TONES.map((t) => (
                <span key={t.name} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${t.cls}`} />
                  <span className="text-[10px] text-muted-foreground">{t.name}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Selected day */}
          {sel && (
            <div className="animate-fade-up mt-4 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {new Date(`${sel.date}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
                <button
                  onClick={() => setSel(null)}
                  className="text-[11px] text-muted-foreground hover:text-ink"
                >
                  close
                </button>
              </div>
              <p className="font-display text-[18px] italic text-ink-soft">
                {sel.count} {sel.count === 1 ? "entry" : "entries"}
                {sel.label ? ` · the day read ${sel.label}` : ""}
              </p>
              <Link
                to="/history"
                className="mt-2 inline-block text-[13px] text-tan underline-offset-2 hover:text-ink hover:underline"
              >
                read the entries →
              </Link>
            </div>
          )}

          {/* The analytics dashboard (journiv): the shape of the whole practice. */}
          {stats && stats.entries > 0 && (
            <div className="mt-10">
              <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-tan">
                The shape of your practice
              </div>
              <div className="rounded-2xl border border-rule bg-card/50 p-5">
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { n: stats.entries.toLocaleString(), l: "entries" },
                    { n: stats.words.toLocaleString(), l: "words kept" },
                    { n: String(stats.avgWords), l: "avg words / entry" },
                  ].map((s) => (
                    <div key={s.l}>
                      <div className="font-display text-[24px] italic leading-none text-ink">
                        {s.n}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {s.l}
                      </div>
                    </div>
                  ))}
                </div>

                {stats.byMonth.length > 1 && (
                  <div className="mt-6">
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                      by month
                    </div>
                    <div className="flex h-16 items-end gap-1">
                      {stats.byMonth.map((m) => {
                        const max = Math.max(...stats.byMonth.map((x) => x.count));
                        return (
                          <div key={m.month} className="flex-1" title={`${m.month}: ${m.count}`}>
                            <div
                              className="w-full rounded-t bg-tan/70"
                              style={{ height: `${Math.max(6, (m.count / max) * 100)}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/60">
                      <span>{stats.byMonth[0]?.month}</span>
                      <span>{stats.byMonth[stats.byMonth.length - 1]?.month}</span>
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                    which days you write
                  </div>
                  <div className="flex h-12 items-end gap-1.5">
                    {stats.byWeekday.map((c, i) => {
                      const max = Math.max(1, ...stats.byWeekday);
                      return (
                        <div key={i} className="flex-1 text-center">
                          <div
                            className="w-full rounded-t bg-ink/25"
                            style={{ height: `${Math.max(6, (c / max) * 100)}%` }}
                          />
                          <div className="mt-0.5 text-[9px] text-muted-foreground/60">
                            {WEEKDAYS[i]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {stats.topTags.length > 0 && (
                  <div className="mt-6">
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                      what it's been about
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {stats.topTags.map((t) => (
                        <span
                          key={t.tag}
                          className="rounded-full bg-tan/[0.1] px-2.5 py-1 text-[11px] text-tan"
                        >
                          {t.tag} <span className="opacity-60">{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {data && data.days.length === 0 && (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Nothing this month{isFutureMonth ? "" : " — the pen was elsewhere"}.
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}
