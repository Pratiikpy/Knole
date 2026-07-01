import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";
import { Pulse } from "@/components/knole/Pulse";
import { CrisisCard } from "@/components/knole/CrisisCard";
import { parseRecalledHeader, type RecallPill } from "@/components/knole/recall";
import {
  nudgeFn,
  whoamiFn,
  resurfaceFn,
  mirrorStatusFn,
  onThisDayFn,
  omissionRadarFn,
  quickCheckInFn,
} from "@/server/fns";
import type { OnThisMatch } from "@/server/onThisDay";
import { useEffect, useState } from "react";

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

// Reflection lenses — the same memory, a different voice. Blunt is the anti-sycophancy mode.
const lenses = [
  { id: "gentle", label: "Gentle" },
  { id: "pattern", label: "Patterns" },
  { id: "blunt", label: "Blunt" },
  { id: "decision", label: "Decide" },
] as const;

// The one-tap nightly check-in — the friction floor (retention #1). Labels match the server enum.
const CHECKIN_MOODS = [
  { key: "heavy", label: "heavy" },
  { key: "low", label: "low" },
  { key: "okay", label: "okay" },
  { key: "good", label: "good" },
  { key: "bright", label: "bright" },
] as const;
type CheckInMood = (typeof CHECKIN_MOODS)[number]["key"];

const reflectingMsgs = [
  "Reading what you wrote…",
  "Looking for the thread…",
  "Remembering what you've shared…",
  "Sitting with it…",
];

type MirrorStatus = {
  phase: "empty" | "building" | "revealed";
  daysSinceFirst: number;
  daysToReveal: number;
  dayCount: number;
  entryCount: number;
};

function TodayPage() {
  const getNudge = useServerFn(nudgeFn);
  // A demo guest can't journal (writes are auth-gated). Learn that up front so Reflect shows the
  // sign-in line directly instead of firing a doomed request that 401s into the console.
  const whoami = useServerFn(whoamiFn);
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
  const [nudge, setNudge] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  // A resurfaced "past self" memory — Knole bringing back the earliest thing you wrote, surfaced at
  // the top of Today instead of buried in the footer. Calm + dismissible: once dismissed it stays
  // quiet for the rest of the day.
  const getResurface = useServerFn(resurfaceFn);
  const [resurfaced, setResurfaced] = useState<{ text: string; date: string } | null>(null);
  const [resurfaceDismissed, setResurfaceDismissed] = useState(false);
  // On-This-Day — an entry from the same calendar day a year/month ago. Outranks the generic
  // resurface card (a more specific signal); same calm, dismissible-for-the-day behavior.
  const getOnThisDay = useServerFn(onThisDayFn);
  const [onThis, setOnThis] = useState<OnThisMatch | null>(null);
  const [onThisDismissed, setOnThisDismissed] = useState(false);
  // The Omission Radar — a single, dismissible "quiet noticing" of something gone unmentioned.
  const getRadar = useServerFn(omissionRadarFn);
  const [radar, setRadar] = useState<{ line: string } | null>(null);
  const [radarDismissed, setRadarDismissed] = useState(false);
  // The one-tap daily check-in — the friction floor (retention #1).
  const doQuickCheckIn = useServerFn(quickCheckInFn);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkedInMood, setCheckedInMood] = useState("");
  const [checkInNote, setCheckInNote] = useState("");
  // The 14-Day Mirror arc progress — a cheap day-count call (no LLM) that gives the daily loop
  // visible momentum toward the flagship reveal.
  const getMirrorStatus = useServerFn(mirrorStatusFn);
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);
  const [prompt, setPrompt] = useState(prompts[1]);
  // Start empty — the textarea shows its placeholder prompt, never pre-filled with someone else's
  // words. A new user's journal must be theirs from the first keystroke.
  const [entry, setEntry] = useState("");
  const [lens, setLens] = useState<string>("gentle");
  const [reflected, setReflected] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remembered, setRemembered] = useState<RecallPill | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);

  // Cycle a calm "thinking" line while the reflection generates (~15-18s LLM call).
  useEffect(() => {
    if (!loading) {
      setMsgIdx(0);
      return;
    }
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % reflectingMsgs.length), 2400);
    return () => clearInterval(id);
  }, [loading]);

  async function handleReflect() {
    if (!entry.trim()) return;
    setLoading(true);
    setReflection("");
    setRemembered(null);
    setReflected(false);
    setCrisis(false);
    // Known demo guest: show the sign-in line directly — no doomed fetch, no 401 in the console.
    if (demoGated) {
      setReflection(
        "Sign in to start your own Knole — your words stay private to you. Use “Sign in” above.",
      );
      setReflected(true);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/journal/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entry, lens }),
      });
      if (!res.ok || !res.body) {
        setReflection(
          res.status === 401
            ? "Sign in to start your own Knole — your words stay private to you. Use “Sign in” above."
            : "Something interrupted the reflection — try again in a moment.",
        );
        setReflected(true);
        return;
      }
      // Recalled memories ride in a header so the body stays pure reflection text — parse them into
      // the "it remembered" receipts pill (date + the user's own past words).
      setRemembered(parseRecalledHeader(res.headers.get("x-knole-recalled")));
      setCrisis(res.headers.get("x-knole-crisis") === "1");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        // Swap from the "thinking" line to the reflection view on the first real token.
        if (first && acc.trim()) {
          setReflected(true);
          first = false;
        }
        setReflection(acc);
      }
      setReflected(true);
    } catch {
      setReflection("Something interrupted the reflection — try again in a moment.");
      setReflected(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getNudge()
      .then((n) => {
        if (n.allowed) setNudge(n.nudge);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only surface a resurfaced memory if it wasn't dismissed earlier today — calm, never nagging.
    try {
      if (localStorage.getItem("knole.resurface.dismissed") === new Date().toDateString()) return;
    } catch {
      /* localStorage unavailable (private mode) — just proceed */
    }
    getResurface()
      .then((r) => {
        if (r.entry) setResurfaced({ text: r.entry.text, date: r.entry.date });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getMirrorStatus()
      .then((m) => setMirror(m))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("knole.onthisday.dismissed") === new Date().toDateString()) return;
    } catch {
      /* localStorage unavailable — just proceed */
    }
    getOnThisDay()
      .then((r) => {
        if (r.match) setOnThis(r.match);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("knole.omission.dismissed") === new Date().toDateString()) return;
    } catch {
      /* localStorage unavailable — just proceed */
    }
    getRadar()
      .then((r) => {
        if (r && r.line) setRadar({ line: r.line });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("knole.checkin.done") === new Date().toDateString())
        setCheckedIn(true);
    } catch {
      /* ignore */
    }
  }, []);

  const doCheckIn = (mood: CheckInMood) => {
    if (checkedIn) return;
    // Optimistic by design — a check-in must feel instant. Acknowledge now and persist in the
    // background, so a cold server never makes a single tap wait (and a guest gets the same ack).
    setCheckedInMood(mood);
    setCheckedIn(true);
    try {
      localStorage.setItem("knole.checkin.done", new Date().toDateString());
    } catch {
      /* ignore */
    }
    if (demoGated) return; // ephemeral in the demo
    void doQuickCheckIn({ data: { mood, note: checkInNote.trim() || undefined } }).catch(() => {});
  };

  const dismissRadar = () => {
    setRadarDismissed(true);
    try {
      localStorage.setItem("knole.omission.dismissed", new Date().toDateString());
    } catch {
      /* ignore */
    }
  };

  const dismissOnThis = () => {
    setOnThisDismissed(true);
    try {
      localStorage.setItem("knole.onthisday.dismissed", new Date().toDateString());
    } catch {
      /* ignore */
    }
  };

  const dismissResurface = () => {
    setResurfaceDismissed(true);
    try {
      localStorage.setItem("knole.resurface.dismissed", new Date().toDateString());
    } catch {
      /* ignore */
    }
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          {nudge && !nudgeDismissed && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <p className="flex-1 font-display text-[16px] italic leading-snug text-ink-soft">
                {nudge}
              </p>
              <button
                onClick={() => setNudgeDismissed(true)}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          {onThis && !onThisDismissed && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <div className="flex-1">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  {onThis.label}
                </div>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  "{onThis.text.length > 140 ? `${onThis.text.slice(0, 140)}…` : onThis.text}"
                </p>
                <Link
                  to="/on-this-day"
                  className="mt-2 inline-block text-[12px] text-tan hover:text-ink"
                >
                  see it →
                </Link>
              </div>
              <button
                onClick={dismissOnThis}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          {resurfaced && !resurfaceDismissed && !onThis && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <div className="flex-1">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  Knole brought something back
                </div>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  "
                  {resurfaced.text.length > 140
                    ? `${resurfaced.text.slice(0, 140)}…`
                    : resurfaced.text}
                  "
                </p>
                <Link
                  to="/remembered"
                  className="mt-2 inline-block text-[12px] text-tan hover:text-ink"
                >
                  hear it again →
                </Link>
              </div>
              <button
                onClick={dismissResurface}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          {radar && !radarDismissed && !nudge && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <div className="flex-1">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  A quiet noticing
                </div>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  {radar.line}
                </p>
              </div>
              <button
                onClick={dismissRadar}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          <div className="mb-10 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Today</h1>
            <span
              suppressHydrationWarning
              className="text-[12px] tabular-nums text-muted-foreground"
            >
              {today}
            </span>
          </div>

          {/* The friction floor — one tap keeps you alive long enough to reach the 14-day reveal. The
              mirror runs in the background; this never asks you to write. */}
          {checkedIn ? (
            <div className="animate-fade-up mb-8 flex items-center gap-2.5 rounded-2xl border border-tan/30 bg-tan/[0.05] px-5 py-3.5">
              <Pulse />
              <span className="font-display text-[15px] italic text-ink-soft">
                Logged{checkedInMood ? ` — ${checkedInMood}` : ""}. Knole's got it.
              </span>
            </div>
          ) : (
            <div className="animate-fade-up mb-8 rounded-2xl border border-tan/30 bg-tan/[0.04] p-6">
              <p className="mb-4 font-display text-[17px] italic text-ink-soft">
                One tap before the page — how's today landing?
              </p>
              <div className="flex flex-wrap gap-2">
                {CHECKIN_MOODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => doCheckIn(m.key)}
                    className="rounded-full border border-rule bg-card/60 px-4 py-2 text-[13px] text-ink transition-colors hover:border-tan/40"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <input
                value={checkInNote}
                onChange={(e) => setCheckInNote(e.target.value)}
                placeholder="anything on your mind? (optional)"
                className="mt-4 w-full border-none bg-transparent text-[13px] text-ink placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          )}

          {mirror && mirror.phase === "building" && (
            <Link to="/insights" className="group mb-8 block">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Day {mirror.daysSinceFirst + 1} of {mirror.daysSinceFirst + mirror.daysToReveal} ·
                  your first Pattern Mirror
                </span>
                <span className="text-[11px] text-muted-foreground transition-colors group-hover:text-ink">
                  {mirror.daysToReveal} {mirror.daysToReveal === 1 ? "day" : "days"} to go
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-rule">
                <div
                  className="h-full rounded-full bg-tan transition-all"
                  style={{
                    width: `${Math.round((mirror.daysSinceFirst / (mirror.daysSinceFirst + mirror.daysToReveal)) * 100)}%`,
                  }}
                />
              </div>
            </Link>
          )}
          {mirror && mirror.phase === "revealed" && (
            <Link
              to="/insights"
              className="animate-fade-up mb-8 flex items-center justify-between rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-3.5"
            >
              <span className="font-display text-[16px] italic text-ink-soft">
                Your Pattern Mirror is ready.
              </span>
              <span className="text-[12px] text-tan">see it →</span>
            </Link>
          )}

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
                setReflection(null);
                setRemembered(null);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleReflect();
              }}
              rows={6}
              className="mt-4 w-full resize-none border-none bg-transparent font-display text-[22px] leading-[1.5] text-ink placeholder:text-muted-foreground/60 focus:outline-none"
              placeholder="Write what's true, even if it's small."
            />

            {!reflected && entry.trim().length > 10 && (
              <div className="mt-6">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Lens
                  </span>
                  {lenses.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLens(l.id)}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        lens === l.id
                          ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                          : "text-muted-foreground hover:text-ink"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-rule pt-5">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {entry.trim().split(/\s+/).length} words
                  </span>
                  <button
                    onClick={handleReflect}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
                  >
                    {loading ? "Reflecting…" : "Reflect"}
                    <svg
                      viewBox="0 0 24 24"
                      className="size-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14M13 6l6 6-6 6"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {loading && !reflected && (
              <div className="animate-fade-up mt-8 flex items-center gap-3 border-l-2 border-tan/40 pl-6">
                <Pulse />
                <span className="font-display text-[18px] italic text-muted-foreground">
                  {reflectingMsgs[msgIdx]}
                </span>
              </div>
            )}

            {reflected && reflection && (
              <div
                data-testid="reflection"
                className="animate-fade-up mt-8 border-l-2 border-tan/40 pl-6"
              >
                {remembered && (
                  <div className="mb-3">
                    <MemoryPill label={remembered.label} receipts={remembered.receipts} />
                  </div>
                )}
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                  {reflection}
                  {loading && (
                    <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-tan align-middle" />
                  )}
                </p>
                {crisis && !loading && (
                  <div className="mt-4">
                    <CrisisCard />
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
