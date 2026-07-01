import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { Shell } from "@/components/knole/Shell";
import { onboardFn, syncSessionFn, importFn, affirmAgeFn } from "@/server/fns";
import { splitHistory } from "@/lib/splitHistory";
import { CrisisCard } from "@/components/knole/CrisisCard";
import { isAuthRequired } from "@/lib/authError";
import { useState, useEffect } from "react";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Begin — Knole" },
      { name: "description", content: "A warm first conversation with Knole." },
    ],
  }),
  component: Onboarding,
});

// Privy is scoped to this route (code-splits the ~2MB react-auth into the onboarding chunk) so the
// guest can claim their first reflection inline — no bounce to the bottom of Settings, the aha stays
// on screen through sign-in.
function Onboarding() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "light", accentColor: "#7c6545" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <OnboardingInner />
    </PrivyProvider>
  );
}

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

function OnboardingInner() {
  const doOnboard = useServerFn(onboardFn);
  const doSync = useServerFn(syncSessionFn);
  const doImport = useServerFn(importFn);
  const doAffirmAge = useServerFn(affirmAgeFn);
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);
  // The refugee wedge: paste an export and land in a Mirror seeded from it (Dot cold-start fix).
  const [mode, setMode] = useState<"fresh" | "import">("fresh");
  const [importText, setImportText] = useState("");
  const [passageCount, setPassageCount] = useState(0);
  const [step, setStep] = useState<Step>(0);
  // SB243: self-attested age gate (persisted to localStorage + server on sign-in) + crisis flag.
  const [affirmed, setAffirmed] = useState(false);
  const [crisis, setCrisis] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("knole.age.affirmed") === "1") setAffirmed(true);
    } catch {
      /* ignore */
    }
  }, []);
  const affirm = (v: boolean) => {
    setAffirmed(v);
    try {
      localStorage.setItem("knole.age.affirmed", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const [opener, setOpener] = useState("");
  const [voice, setVoice] = useState<string>("warm");
  const [thing, setThing] = useState<string>("");
  const [reflection, setReflection] = useState<string | null>(null);
  // Whether the reflection was saved. A guest gets the aha ephemerally (false) → "sign in to keep it";
  // a signed-in user persists it (true) → "Knole will remember…".
  const [persisted, setPersisted] = useState(false);
  const [generating, setGenerating] = useState(false);

  const begin = async () => {
    setStep(3);
    setGenerating(true);
    try {
      const res = await doOnboard({
        data: {
          opener,
          voice: voice as "warm" | "structural" | "honest" | "curious",
          thing: thing || undefined,
        },
      });
      setReflection(res.reflection);
      setPersisted(res.persisted);
      setCrisis(res.crisis === true);
    } catch (e) {
      setReflection(
        isAuthRequired(e)
          ? "Sign in to start your own Knole — your words stay private to you."
          : "I'm here, and I've got this. Come back tomorrow and we'll pick up the thread.",
      );
    } finally {
      setGenerating(false);
    }
  };

  // When the guest signs in from the step-3 aha: sync the server session, persist their first entry
  // (re-run onboard, now authenticated → it writes the entry + reply + memory + 0G), then move into
  // Today. The reflection promise is honored without the bounce to the bottom of Settings.
  useEffect(() => {
    if (!ready || !authenticated || persisted || claiming) return;
    // Import path: weave the pasted history into memories, then land on the seeded Mirror.
    if (mode === "import") {
      if (importText.trim().length < 40) return;
      setClaiming(true);
      void (async () => {
        try {
          const token = await getAccessToken();
          if (token) await doSync({ data: { token } });
          void doAffirmAge().catch(() => {});
          await doImport({ data: { text: importText, source: "import" } });
          await navigate({ to: "/insights" });
        } catch {
          setClaiming(false);
        }
      })();
      return;
    }
    // Fresh path: persist the first reflection, then land on Today.
    if (!reflection) return;
    setClaiming(true);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (token) await doSync({ data: { token } });
        void doAffirmAge().catch(() => {});
        await doOnboard({
          data: {
            opener,
            voice: voice as "warm" | "structural" | "honest" | "curious",
            thing: thing || undefined,
          },
        });
        await navigate({ to: "/today" });
      } catch {
        setClaiming(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, reflection, persisted, mode]);

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

          {step === 0 && mode === "fresh" && (
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

              <label className="mt-5 flex items-start gap-2.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={affirmed}
                  onChange={(e) => affirm(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-tan"
                />
                <span>I'm 18 or older.</span>
              </label>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
                Knole is an AI reflection — not a person, and not a substitute for professional
                care.
              </p>

              <div className="mt-8 flex items-center justify-between">
                <Link to="/" className="text-[12px] text-muted-foreground hover:text-ink">
                  ← back
                </Link>
                <button
                  disabled={opener.trim().length < 3 || !affirmed}
                  onClick={() => setStep(1)}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-opacity disabled:opacity-30"
                >
                  Continue
                </button>
              </div>
              <button
                onClick={() => setMode("import")}
                className="mt-6 text-[12px] text-tan hover:text-ink"
              >
                Already have history with another AI? Bring it →
              </button>
            </div>
          )}

          {step === 0 && mode === "import" && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                Bring your history
              </p>
              <h1 className="font-display text-[40px] leading-[1.04] italic">
                Paste what another AI knew about you.
              </h1>
              <p className="mt-4 max-w-[42ch] text-[14px] leading-relaxed text-muted-foreground">
                A ChatGPT or Replika export, old journal entries — anything in your own words. Knole
                reads it, privately, and starts already knowing you.
              </p>
              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setPassageCount(splitHistory(e.target.value).length);
                }}
                rows={6}
                placeholder="Paste your history here…"
                className="mt-8 w-full resize-none rounded-xl border border-rule bg-card/60 p-5 font-display text-[16px] leading-snug text-ink placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-tan/30"
              />
              {passageCount >= 2 && (
                <p className="mt-2 text-[12px] text-tan">
                  Knole found ~{passageCount} passages to read.
                </p>
              )}
              <label className="mt-5 flex items-start gap-2.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={affirmed}
                  onChange={(e) => affirm(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-tan"
                />
                <span>I'm 18 or older.</span>
              </label>
              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => setMode("fresh")}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  ← start fresh instead
                </button>
                <button
                  disabled={importText.trim().length < 40 || !affirmed}
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
                  onClick={() => setStep(mode === "import" ? 3 : 2)}
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
                  onClick={begin}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper disabled:opacity-30"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && mode === "fresh" && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-tan">
                The first reflection
              </p>
              <h1 className="font-display text-[40px] leading-[1.05] italic">
                Then let's start there.
              </h1>

              <div className="mt-8 border-l-2 border-tan/40 pl-5">
                {generating ? (
                  <p className="font-display text-[18px] italic text-muted-foreground">
                    Knole is reading your first words…
                  </p>
                ) : (
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                    {reflection}
                  </p>
                )}
              </div>

              {crisis ? (
                <div className="mt-8">
                  <CrisisCard />
                </div>
              ) : (
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
                  {persisted ? (
                    <>
                      Knole will remember: <span className="italic">{thing.toLowerCase()}</span> is
                      quietly with you this week.
                    </>
                  ) : (
                    <>
                      This reflection is yours. <span className="italic">Sign in to keep it</span> —
                      Knole starts remembering from here.
                    </>
                  )}
                </div>
              )}

              <div className="mt-12 flex items-center justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  ← back
                </button>
                {persisted ? (
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
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14M13 6l6 6-6 6"
                      />
                    </svg>
                  </Link>
                ) : (
                  <button
                    onClick={() => login()}
                    disabled={!ready || claiming}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-opacity disabled:opacity-40"
                  >
                    {claiming ? "Saving your reflection…" : "Sign in to keep this"}
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
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
                )}
              </div>
            </div>
          )}

          {step === 3 && mode === "import" && (
            <div className="animate-fade-up">
              <p className="mb-3 text-[12px] uppercase tracking-[0.18em] text-tan">
                Your first mirror
              </p>
              <h1 className="font-display text-[40px] leading-[1.05] italic">
                Knole is about to read all of you.
              </h1>
              <p className="mt-6 max-w-[42ch] text-[15px] leading-relaxed text-ink-soft">
                You've brought {passageCount} passage{passageCount === 1 ? "" : "s"}. Sign in and
                Knole weaves every one into memories — then composes your first Pattern Mirror from
                your own words.
              </p>
              <div className="mt-12 flex items-center justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  ← back
                </button>
                <button
                  onClick={() => login()}
                  disabled={!ready || claiming}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-opacity disabled:opacity-40"
                >
                  {claiming ? "Knole is reading your history…" : "Sign in & build my Mirror"}
                  <svg
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
