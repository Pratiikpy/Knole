import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { journalFn, nudgeFn } from "@/server/fns";
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

const reflectingMsgs = [
  "Reading what you wrote…",
  "Looking for the thread…",
  "Remembering what you've shared…",
  "Sitting with it…",
];

const sampleEntry =
  "I'm thinking about the garden project again. It's been months since I actually sat out there and just enjoyed the silence. I feel like I've been running on a treadmill of minor tasks. Maybe the soil is ready now.";

function TodayPage() {
  const doReflect = useServerFn(journalFn);
  const getNudge = useServerFn(nudgeFn);
  const [nudge, setNudge] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [prompt, setPrompt] = useState(prompts[1]);
  const [entry, setEntry] = useState(sampleEntry);
  const [reflected, setReflected] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recalled, setRecalled] = useState<{ content: string; quote: string | null }[]>([]);
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
    try {
      const res = await doReflect({ data: { entry } });
      setReflection(res.reflection);
      setRecalled(res.recalled ?? []);
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
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-tan animate-breathe" />
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
          <div className="mb-10 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Today</h1>
            <span
              suppressHydrationWarning
              className="text-[12px] tabular-nums text-muted-foreground"
            >
              {today}
            </span>
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
                setReflection(null);
                setRecalled([]);
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            )}

            {loading && !reflected && (
              <div className="animate-fade-up mt-8 flex items-center gap-3 border-l-2 border-tan/40 pl-6">
                <span className="size-1.5 shrink-0 animate-breathe rounded-full bg-tan" />
                <span className="font-display text-[18px] italic text-muted-foreground">
                  {reflectingMsgs[msgIdx]}
                </span>
              </div>
            )}

            {reflected && reflection && (
              <div className="animate-fade-up mt-8 border-l-2 border-tan/40 pl-6">
                {recalled.length > 0 && (
                  <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-tan">
                    ↳ drew on {recalled.length} thing{recalled.length > 1 ? "s" : ""} you've shared
                    before
                  </p>
                )}
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                  {reflection}
                </p>
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
