import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/knole/Shell";
import { CrisisCard } from "@/components/knole/CrisisCard";
import { wellbeingStatusFn, submitInstrumentFn, saveThoughtRecordFn } from "@/server/fns";
import type { InstrumentId, Distortion } from "@/server/wellbeing";

export const Route = createFileRoute("/wellbeing")({
  head: () => ({
    meta: [
      { title: "Wellbeing — Knole" },
      {
        name: "description",
        content: "Check in with yourself, untangle a thought, breathe. Not therapy — a toolbox.",
      },
    ],
  }),
  component: WellbeingPage,
});

type Status = {
  history: { instrument: string; score: number; band: string; at: string }[];
  due: InstrumentId[];
  instruments: Record<InstrumentId, { name: string; stem: string; items: string[]; mcid: number }>;
  options: string[];
  distortions: Distortion[];
};

type View = "home" | "phq9" | "gad7" | "record" | "breathe" | "ground" | "worry" | "patterns";

function WellbeingPage() {
  const load = useServerFn(wellbeingStatusFn);
  const [status, setStatus] = useState<Status | null>(null);
  const [view, setView] = useState<View>("home");

  const refresh = () =>
    load()
      .then((s) => setStatus(s))
      .catch(() => {});
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          {view === "home" && (
            <>
              <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Wellbeing
              </p>
              <h1 className="font-display text-[44px] italic leading-[1.02]">
                A toolbox, not a couch.
              </h1>
              <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
                Small, well-made tools for hard moments — check in with yourself, untangle one
                thought, breathe. Knole is not therapy and not a substitute for professional care.
              </p>

              {status && (
                <div className="mt-8 space-y-3">
                  {/* check-ins */}
                  {(["phq9", "gad7"] as InstrumentId[]).map((inst) => {
                    const last = status.history.find((h) => h.instrument === inst);
                    const due = status.due.includes(inst);
                    return (
                      <button
                        key={inst}
                        onClick={() => setView(inst)}
                        className={`block w-full rounded-2xl border p-5 text-left transition-colors hover:border-tan/40 ${
                          due ? "border-tan/30 bg-tan/[0.05]" : "border-rule bg-card/50"
                        }`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className="text-[14px] text-ink">
                            {inst === "phq9" ? "Mood check-in" : "Worry check-in"}{" "}
                            <span className="text-[11px] text-muted-foreground">
                              ({status.instruments[inst].name})
                            </span>
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {due
                              ? last
                                ? "two weeks since last — due"
                                : "first one"
                              : last
                                ? `last: ${last.score} · ${last.band}`
                                : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          Nine{inst === "gad7" ? " — seven" : ""} questions about the last two
                          weeks. A number you can watch over time, not a diagnosis.
                        </p>
                      </button>
                    );
                  })}

                  {/* thought record */}
                  <button
                    onClick={() => setView("record")}
                    className="block w-full rounded-2xl border border-rule bg-card/50 p-5 text-left transition-colors hover:border-tan/40"
                  >
                    <span className="text-[14px] text-ink">Untangle a thought</span>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      Five steps from "the thought that bit" to a fairer sentence — the classic
                      thought-record method, saved into your journal.
                    </p>
                  </button>

                  {/* exercises */}
                  <div className="grid grid-cols-3 gap-3">
                    {(
                      [
                        ["breathe", "Box breathing", "4-4-4-4, guided"],
                        ["ground", "5-4-3-2-1", "come back to the room"],
                        ["worry", "Worry shelf", "park it till later"],
                      ] as const
                    ).map(([v, label, hint]) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className="rounded-2xl border border-rule bg-card/50 p-4 text-left transition-colors hover:border-tan/40"
                      >
                        <div className="text-[13px] text-ink">{label}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setView("patterns")}
                    className="block w-full rounded-2xl border border-rule bg-card/50 p-5 text-left transition-colors hover:border-tan/40"
                  >
                    <span className="text-[14px] text-ink">The thirteen thinking patterns</span>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      A field guide to the mind's shortcuts — catastrophizing, mind reading,
                      all-or-nothing and their cousins.
                    </p>
                  </button>

                  {/* score history */}
                  {status.history.length > 0 && (
                    <div className="rounded-2xl border border-rule bg-card/50 p-5">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        your check-ins
                      </div>
                      <div className="space-y-1">
                        {status.history.slice(0, 8).map((h, i) => (
                          <div key={i} className="flex items-baseline justify-between text-[12px]">
                            <span className="text-muted-foreground">
                              {new Date(h.at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}{" "}
                              · {h.instrument === "phq9" ? "mood" : "worry"}
                            </span>
                            <span className="tabular-nums text-ink-soft">
                              {h.score} <span className="text-muted-foreground">({h.band})</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Scores are private, stored like everything else you write. If you're preparing
                    for a session with a professional,{" "}
                    <Link to="/therapy" className="text-tan hover:text-ink">
                      the session brief
                    </Link>{" "}
                    can carry them.
                  </p>
                </div>
              )}
            </>
          )}

          {(view === "phq9" || view === "gad7") && status && (
            <InstrumentFlow
              inst={view}
              def={status.instruments[view]}
              options={status.options}
              onDone={() => {
                setView("home");
                void refresh();
              }}
            />
          )}

          {view === "record" && status && (
            <ThoughtRecord distortions={status.distortions} onDone={() => setView("home")} />
          )}
          {view === "breathe" && <BoxBreathing onDone={() => setView("home")} />}
          {view === "ground" && <Grounding onDone={() => setView("home")} />}
          {view === "worry" && <WorryShelf onDone={() => setView("home")} />}
          {view === "patterns" && status && (
            <Patterns distortions={status.distortions} onDone={() => setView("home")} />
          )}
        </div>
      </section>
    </Shell>
  );
}

function BackRow({ onDone, label = "back" }: { onDone: () => void; label?: string }) {
  return (
    <button onClick={onDone} className="mb-6 text-[12px] text-muted-foreground hover:text-ink">
      ← {label}
    </button>
  );
}

// ── the check-in flow: one item at a time, crisis gate before anything else ──
function InstrumentFlow({
  inst,
  def,
  options,
  onDone,
}: {
  inst: InstrumentId;
  def: { name: string; stem: string; items: string[]; mcid: number };
  options: string[];
  onDone: () => void;
}) {
  const submit = useServerFn(submitInstrumentFn);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{
    score: number;
    band: string;
    crisis: boolean;
    change: { delta: number; meaningful: boolean; direction: string } | null;
  } | null>(null);
  const idx = answers.length;

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const send = async (all: number[]) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await submit({ data: { instrument: inst, answers: all } });
      if ("error" in r) throw new Error(String(r.error));
      setResult(r);
    } catch {
      // A completed clinical instrument must never vanish. The answers stay in state and the
      // user gets a real retry instead of a blank "10 of 9" screen with live buttons.
      setSubmitError("That didn't send. Your answers are safe — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const answer = async (v: number) => {
    if (submitting || idx >= def.items.length) return;
    const next = [...answers, v];
    setAnswers(next);
    if (next.length === def.items.length) await send(next);
  };

  // All questions answered but not yet accepted by the server: show progress or a retry, never
  // an undefined question.
  if (!result && idx >= def.items.length) {
    return (
      <div className="animate-fade-up rounded-2xl border border-rule bg-card/50 p-6 text-center">
        {submitting ? (
          <p className="font-display text-[18px] italic text-ink-soft">Scoring your answers…</p>
        ) : (
          <>
            <p className="mb-4 text-[15px] text-ink-soft">{submitError ?? "Ready to score."}</p>
            <button
              onClick={() => send(answers)}
              className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  if (result) {
    return (
      <div className="animate-fade-up">
        <BackRow onDone={onDone} label="wellbeing" />
        {result.crisis && (
          <div className="mb-6">
            <CrisisCard />
          </div>
        )}
        <div className="rounded-2xl border border-rule bg-card/50 p-6">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">{def.name}</div>
          <p className="font-display text-[32px] italic leading-none text-ink">
            {result.score}{" "}
            <span className="text-[16px] text-muted-foreground">· {result.band}</span>
          </p>
          {result.change && (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
              {result.change.direction === "better" ? "Down" : "Up"} {Math.abs(result.change.delta)}{" "}
              from last time
              {result.change.meaningful
                ? " — a change big enough to mean something."
                : " — within the ordinary wobble."}
            </p>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            A number to watch over weeks, not a verdict. If it stays high or climbs, that's worth
            bringing to a professional.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackRow onDone={onDone} label="wellbeing" />
      <p className="text-[12px] uppercase tracking-[0.2em] text-muted-foreground">
        {def.name} · {idx + 1} of {def.items.length}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{def.stem}</p>
      <p className="mt-5 min-h-[64px] max-w-[46ch] font-display text-[22px] italic leading-snug text-ink">
        {def.items[idx]}
      </p>
      <div className="mt-6 grid gap-2">
        {options.map((o, v) => (
          <button
            key={o}
            onClick={() => void answer(v)}
            className="rounded-xl border border-rule bg-card/50 px-4 py-3 text-left text-[14px] text-ink transition-colors hover:border-tan/40"
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── the thought record: five steps, our own wording ──
function ThoughtRecord({ distortions, onDone }: { distortions: Distortion[]; onDone: () => void }) {
  const save = useServerFn(saveThoughtRecordFn);
  const [step, setStep] = useState(0);
  const [situation, setSituation] = useState("");
  const [thought, setThought] = useState("");
  const [feeling, setFeeling] = useState("");
  const [before, setBefore] = useState(70);
  const [picked, setPicked] = useState<string[]>([]);
  const [reframe, setReframe] = useState("");
  const [after, setAfter] = useState(50);
  const [saved, setSaved] = useState<number | null>(null);

  const steps = [
    {
      title: "What happened?",
      hint: "Just the facts of the moment — where you were, what occurred. No interpretation yet.",
      body: (
        <Field
          value={situation}
          onChange={setSituation}
          placeholder="The meeting ran over and my point never got heard…"
        />
      ),
      ready: situation.trim().length > 0,
    },
    {
      title: "What did your mind say?",
      hint: "The automatic sentence, word for word, however unfair it sounds.",
      body: (
        <Field
          value={thought}
          onChange={setThought}
          placeholder='"Nobody takes me seriously here."'
        />
      ),
      ready: thought.trim().length > 0,
    },
    {
      title: "How did that feel?",
      hint: "One word for the feeling, and how strong it was.",
      body: (
        <div>
          <Field value={feeling} onChange={setFeeling} placeholder="deflated" rows={1} />
          <Slider value={before} onChange={setBefore} />
        </div>
      ),
      ready: feeling.trim().length > 0,
    },
    {
      title: "Any patterns at work?",
      hint: "Tap the ones that fit. Naming the shortcut is half of loosening it.",
      body: (
        <div className="flex flex-wrap gap-2">
          {distortions.map((d) => (
            <button
              key={d.id}
              onClick={() =>
                setPicked((p) =>
                  p.includes(d.id) ? p.filter((x) => x !== d.id) : p.length < 4 ? [...p, d.id] : p,
                )
              }
              title={d.definition}
              className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                picked.includes(d.id)
                  ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                  : "border border-rule text-muted-foreground hover:text-ink"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      ),
      ready: true,
    },
    {
      title: "Say it fairer",
      hint: "Not forced positivity — the version a fair witness would write, with the facts kept in.",
      body: (
        <div>
          <Field
            value={reframe}
            onChange={setReframe}
            placeholder='"The meeting was badly run. Two people did nod at my point — I can follow up in writing."'
          />
          <p className="mb-1 mt-4 text-[12px] text-muted-foreground">
            And the feeling now, after writing it down?
          </p>
          <Slider value={after} onChange={setAfter} />
        </div>
      ),
      ready: reframe.trim().length > 0,
    },
  ];

  const finish = async () => {
    try {
      const r = await save({
        data: {
          situation,
          thought,
          feeling,
          intensityBefore: before,
          distortions: picked,
          reframe,
          intensityAfter: after,
        },
      });
      if ("ok" in r) setSaved(r.relief);
    } catch {
      /* stays on the last step; the user can retry */
    }
  };

  if (saved !== null) {
    return (
      <div className="animate-fade-up">
        <BackRow onDone={onDone} label="wellbeing" />
        <div className="rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
          <p className="font-display text-[22px] italic text-ink">
            {saved > 0
              ? `The feeling came down ${saved} points just from untangling it.`
              : "Written down and kept — untangling counts even when the number holds."}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            The whole record is saved in your journal, patterns and all — the mirror will remember
            how you did this.
          </p>
        </div>
      </div>
    );
  }

  const s = steps[step];
  return (
    <div>
      <BackRow onDone={onDone} label="wellbeing" />
      <p className="text-[12px] uppercase tracking-[0.2em] text-muted-foreground">
        Untangle a thought · {step + 1} of {steps.length}
      </p>
      <h2 className="mt-2 font-display text-[28px] italic leading-tight text-ink">{s.title}</h2>
      <p className="mt-1 max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
        {s.hint}
      </p>
      <div className="mt-5">{s.body}</div>
      <div className="mt-6 flex items-center gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep((x) => x - 1)}
            className="text-[13px] text-muted-foreground hover:text-ink"
          >
            back
          </button>
        )}
        <button
          onClick={() => (step < steps.length - 1 ? setStep((x) => x + 1) : void finish())}
          disabled={!s.ready}
          className="rounded-full bg-ink px-5 py-2.5 text-[13px] text-paper transition-opacity disabled:opacity-40"
        >
          {step < steps.length - 1 ? "next" : "keep this"}
        </button>
      </div>
    </div>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-none rounded-xl border border-rule bg-card/40 px-4 py-3 font-display text-[17px] leading-relaxed text-ink placeholder:text-muted-foreground/50 focus:border-tan/40 focus:outline-none"
    />
  );
}

function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#7c6545]"
      />
      <span className="w-14 text-right font-display text-[18px] italic tabular-nums text-ink">
        {value}/100
      </span>
    </div>
  );
}

// ── box breathing: a pure CSS/JS guided square, no audio ──
function BoxBreathing({ onDone }: { onDone: () => void }) {
  const PHASES = ["breathe in", "hold", "breathe out", "hold"];
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(4);
  const [rounds, setRounds] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timer.current = setInterval(() => {
      setCount((c) => {
        if (c > 1) return c - 1;
        setPhase((p) => {
          const np = (p + 1) % 4;
          if (np === 0) setRounds((r) => r + 1);
          return np;
        });
        return 4;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);
  const growing = phase === 0;
  const shrinking = phase === 2;
  return (
    <div>
      <BackRow onDone={onDone} label="wellbeing" />
      <div className="flex flex-col items-center py-10">
        <div
          className="flex items-center justify-center rounded-3xl border-2 border-tan/50 bg-tan/[0.06] transition-all duration-1000 ease-in-out"
          style={{
            width: growing ? 220 : shrinking ? 130 : phase === 1 ? 220 : 130,
            height: growing ? 220 : shrinking ? 130 : phase === 1 ? 220 : 130,
          }}
        >
          <span className="font-display text-[40px] italic text-ink">{count}</span>
        </div>
        <p className="mt-8 font-display text-[22px] italic text-ink-soft">{PHASES[phase]}</p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {rounds === 0
            ? "four seconds a side — settle into the square"
            : `${rounds} ${rounds === 1 ? "round" : "rounds"} done · three is a good reset`}
        </p>
      </div>
    </div>
  );
}

// ── 5-4-3-2-1 grounding ──
function Grounding({ onDone }: { onDone: () => void }) {
  const STEPS = [
    {
      n: 5,
      sense: "things you can see",
      hint: "Name them, slowly. The lamp counts. The dust counts.",
    },
    { n: 4, sense: "things you can touch", hint: "The chair under you. The fabric on your arm." },
    { n: 3, sense: "things you can hear", hint: "Further away first, then closer." },
    { n: 2, sense: "things you can smell", hint: "Or two you like the memory of." },
    { n: 1, sense: "thing you can taste", hint: "Even just the inside of your own mouth." },
  ];
  const [i, setI] = useState(0);
  if (i >= STEPS.length)
    return (
      <div className="animate-fade-up">
        <BackRow onDone={onDone} label="wellbeing" />
        <p className="py-10 text-center font-display text-[24px] italic text-ink">
          You're here. The room held you the whole time.
        </p>
      </div>
    );
  const s = STEPS[i];
  return (
    <div>
      <BackRow onDone={onDone} label="wellbeing" />
      <div className="py-10 text-center">
        <div className="font-display text-[72px] italic leading-none text-tan">{s.n}</div>
        <p className="mt-3 font-display text-[24px] italic text-ink">{s.sense}</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-[13px] leading-relaxed text-muted-foreground">
          {s.hint}
        </p>
        <button
          onClick={() => setI((x) => x + 1)}
          className="mt-8 rounded-full bg-ink px-6 py-3 text-[14px] text-paper"
        >
          done — next
        </button>
      </div>
    </div>
  );
}

// ── worry postponement: park it, on purpose, in writing ──
function WorryShelf({ onDone }: { onDone: () => void }) {
  const [worry, setWorry] = useState("");
  const [shelved, setShelved] = useState(false);
  if (shelved)
    return (
      <div className="animate-fade-up">
        <BackRow onDone={onDone} label="wellbeing" />
        <div className="rounded-2xl border border-rule bg-card/50 p-6 text-center">
          <p className="font-display text-[22px] italic text-ink">Shelved.</p>
          <p className="mx-auto mt-2 max-w-[40ch] text-[13px] leading-relaxed text-muted-foreground">
            The worry is written and safe — it doesn't need you to hold it for the next few hours.
            If it still matters at worry o'clock, it'll be right here in your journal.
          </p>
        </div>
      </div>
    );
  return (
    <div>
      <BackRow onDone={onDone} label="wellbeing" />
      <h2 className="font-display text-[28px] italic text-ink">The worry shelf</h2>
      <p className="mt-1 max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
        Worry postponement, the studied kind: write the worry down, appoint a later time for it, and
        let the writing hold it until then. Most shelved worries weigh less at pickup.
      </p>
      <textarea
        value={worry}
        onChange={(e) => setWorry(e.target.value)}
        rows={3}
        placeholder="What's circling?"
        className="mt-5 w-full resize-none rounded-xl border border-rule bg-card/40 px-4 py-3 font-display text-[17px] leading-relaxed text-ink placeholder:text-muted-foreground/50 focus:border-tan/40 focus:outline-none"
      />
      <WorryShelfSave worry={worry} onSaved={() => setShelved(true)} />
    </div>
  );
}

function WorryShelfSave({ worry, onSaved }: { worry: string; onSaved: () => void }) {
  const save = useServerFn(saveThoughtRecordFn);
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={() => {
        if (!worry.trim() || busy) return;
        setBusy(true);
        save({
          data: {
            situation: "Shelving a worry for later, on purpose.",
            thought: worry,
            feeling: "worried",
            intensityBefore: 60,
            distortions: [],
            reframe:
              "This worry is written down and parked until worry o'clock. It does not need carrying until then.",
            intensityAfter: 40,
          },
        })
          .then(onSaved)
          .catch(() => setBusy(false));
      }}
      disabled={!worry.trim() || busy}
      className="mt-4 rounded-full bg-ink px-5 py-2.5 text-[13px] text-paper transition-opacity disabled:opacity-40"
    >
      {busy ? "Shelving…" : "Shelve it till later"}
    </button>
  );
}

// ── the field guide ──
function Patterns({ distortions, onDone }: { distortions: Distortion[]; onDone: () => void }) {
  return (
    <div>
      <BackRow onDone={onDone} label="wellbeing" />
      <h2 className="font-display text-[28px] italic text-ink">The thirteen thinking patterns</h2>
      <p className="mt-1 max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
        The mind's habitual shortcuts, catalogued in the cognitive tradition of Aaron Beck and David
        Burns — in our own words. Spotting one mid-thought is the skill.
      </p>
      <div className="mt-6 space-y-3">
        {distortions.map((d) => (
          <div key={d.id} className="rounded-2xl border border-rule bg-card/50 p-5">
            <div className="text-[14px] text-ink">{d.name}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{d.definition}</p>
            <p className="mt-1.5 font-display text-[14px] italic text-muted-foreground">
              {d.example}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
