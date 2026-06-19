import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { useState } from "react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Begin — Knole" },
      { name: "description", content: "A warm first conversation with Knole." },
    ],
  }),
  component: Onboarding,
});

const voices = [
  { id: "warm", name: "Warm & patient", note: "A soft presence that encourages reflection." },
  {
    id: "structural",
    name: "Structural & clear",
    note: "Helps organize thoughts and find patterns.",
  },
  { id: "honest", name: "Direct & honest", note: "Cuts to the core of what you're saying." },
  { id: "curious", name: "Quietly curious", note: "Asks one good question at a time." },
];

type Step = 0 | 1 | 2 | 3;

function Onboarding() {
  const [step, setStep] = useState<Step>(0);
  const [opener, setOpener] = useState("");
  const [voice, setVoice] = useState<string>("warm");
  const [thing, setThing] = useState<string>("");

  return (
    <Shell hideNav>
      <section className="px-6 pb-28 pt-16">
        <div className="mx-auto max-w-[48ch]">
          <div className="mb-12 flex items-center gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-px transition-all ${i <= step ? "w-10 bg-ink" : "w-6 bg-rule"}`}
              />
            ))}
            <span className="ml-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {["Hello", "Voice", "A question", "And so"][step]}
            </span>
          </div>

          {step === 0 && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                A first hello
              </p>
              <h1 className="font-display text-[44px] leading-[1.02] italic">
                What was on your mind today?
              </h1>
              <p className="mt-4 max-w-[40ch] text-[14px] leading-relaxed text-muted-foreground">
                One sentence is plenty. There's no right answer — Knole is just trying to meet you.
              </p>

              <textarea
                value={opener}
                onChange={(e) => setOpener(e.target.value)}
                rows={3}
                placeholder="Something small or something heavy…"
                className="mt-8 w-full resize-none rounded-xl border border-rule bg-card/60 p-5 font-display text-[20px] italic leading-snug text-ink placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-tan/30"
              />

              <div className="mt-8 flex items-center justify-between">
                <Link to="/" className="text-[12px] text-muted-foreground hover:text-ink">
                  ← back
                </Link>
                <button
                  disabled={opener.trim().length < 3}
                  onClick={() => setStep(1)}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-opacity disabled:opacity-30"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                Your voice
              </p>
              <h1 className="font-display text-[40px] leading-[1.04] italic">
                How should Knole speak to you?
              </h1>
              <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
                You can change this whenever you like.
              </p>

              <div className="mt-8 grid gap-3">
                {voices.map((v) => {
                  const active = voice === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setVoice(v.id)}
                      className={`flex items-center justify-between rounded-xl border p-4 text-left transition-all ${
                        active
                          ? "border-tan/40 bg-tan/[0.06]"
                          : "border-rule bg-card/40 hover:border-ink/15"
                      }`}
                    >
                      <div>
                        <div
                          className={`text-[14px] font-medium ${active ? "text-ink" : "text-ink"}`}
                        >
                          {v.name}
                        </div>
                        <div className="mt-0.5 text-[12px] text-muted-foreground">{v.note}</div>
                      </div>
                      <span
                        className={`size-3.5 rounded-full ring-2 ring-offset-2 ring-offset-paper transition-all ${
                          active ? "bg-tan ring-tan/30" : "bg-transparent ring-rule"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="mt-10 flex items-center justify-between">
                <button
                  onClick={() => setStep(0)}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  ← back
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                A small question
              </p>
              <h1 className="font-display text-[40px] leading-[1.04] italic">
                Name one thing that's been quietly on your mind this week.
              </h1>

              <div className="mt-8 grid gap-2">
                {[
                  "Something at work",
                  "Someone I love",
                  "A creative thing",
                  "My body",
                  "The future",
                  "Something I keep avoiding",
                ].map((t) => (
                  <button
                    key={t}
                    onClick={() => setThing(t)}
                    className={`rounded-full px-4 py-2 text-left text-[13px] transition-colors ${
                      thing === t
                        ? "bg-ink text-paper"
                        : "border border-rule text-ink hover:border-ink/20"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="mt-10 flex items-center justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  ← back
                </button>
                <button
                  disabled={!thing}
                  onClick={() => setStep(3)}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper disabled:opacity-30"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-tan">
                The first reflection
              </p>
              <h1 className="font-display text-[40px] leading-[1.05] italic">
                Then let's start there.
              </h1>

              <div className="mt-8 border-l-2 border-tan/40 pl-5">
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  You told me{" "}
                  <span className="italic">"{opener.trim() || "what was on your mind"}"</span>, and
                  that the thing quietly with you is{" "}
                  <span className="italic">{thing.toLowerCase()}</span>.
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
                  That's a lot for one Tuesday. We don't have to solve it — only notice it. I'll sit
                  with this, and when you come back tomorrow, I'll still be here.
                </p>
              </div>

              <div className="animate-fade-up mt-8 inline-flex items-center gap-2 rounded-full bg-tan/[0.08] px-4 py-2 text-[12px] text-tan ring-1 ring-tan/20">
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
                    d="M12 8v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Knole will remember: <span className="italic">{thing.toLowerCase()}</span> is
                quietly with you this week.
              </div>

              <div className="mt-12 flex items-center justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  ← back
                </button>
                <Link
                  to="/today"
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper"
                >
                  Open today
                  <svg
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
