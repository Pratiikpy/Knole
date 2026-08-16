import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { sessionPrepFn, postSessionFn } from "@/server/fns";
import type { SessionPrep } from "@/server/therapy";
import { useState } from "react";

export const Route = createFileRoute("/therapy")({
  head: () => ({
    meta: [
      { title: "Therapy prep — Knole" },
      {
        name: "description",
        content: "Prepare for your session from your own words — you choose what to share.",
      },
    ],
  }),
  component: TherapyPage,
});

// Use the source type directly — the server-fn's inferred return type resolves to `never` under this
// TanStack Start + TS combo, which would silently untype the whole page.
type Prep = SessionPrep;

function TherapyPage() {
  const prepFn = useServerFn(sessionPrepFn);
  const postFn = useServerFn(postSessionFn);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [busy, setBusy] = useState(false);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ cameUp: "", homework: "", howIFelt: "" });
  const [captured, setCaptured] = useState(false);

  async function runPrep() {
    setBusy(true);
    setCopied(false);
    try {
      const r = await prepFn();
      setPrep(r);
      if (r.ready) {
        const inc: Record<string, boolean> = {};
        r.talkingPoints.forEach((_, i) => (inc[`tp${i}`] = true));
        r.unresolved.forEach((_, i) => (inc[`un${i}`] = true));
        r.wins.forEach((_, i) => (inc[`win${i}`] = true));
        r.spikes.forEach((_, i) => (inc[`sp${i}`] = true));
        setInclude(inc);
      }
    } catch {
      setPrep(null);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k: string) => setInclude((s) => ({ ...s, [k]: !s[k] }));

  function buildText(p: Prep): string {
    const lines: string[] = [`Session prep — since ${p.since}`, ""];
    const tps = p.talkingPoints.filter((_, i) => include[`tp${i}`]);
    if (tps.length) {
      lines.push("To talk about:");
      tps.forEach((tp) => lines.push(`• ${tp.point}\n   "${tp.quote}" (${tp.date})`));
      lines.push("");
    }
    const uns = p.unresolved.filter((_, i) => include[`un${i}`]);
    if (uns.length) {
      lines.push("Still open:");
      uns.forEach((u) => lines.push(`• ${u}`));
      lines.push("");
    }
    const wins = p.wins.filter((_, i) => include[`win${i}`]);
    if (wins.length) {
      lines.push("Went well:");
      wins.forEach((w) => lines.push(`• ${w.text}${w.date ? ` (${w.date})` : ""}`));
    }
    return lines.join("\n").trim();
  }

  async function copyForSession(p: Prep) {
    try {
      await navigator.clipboard.writeText(buildText(p));
      setCopied(true);
    } catch {
      /* clipboard denied — the text is still visible to copy by hand */
    }
  }

  async function capture() {
    if (!form.cameUp.trim() && !form.homework.trim() && !form.howIFelt.trim()) return;
    setCaptured(true);
    await postFn({ data: form }).catch(() => {});
  }

  const p = prep && prep.ready ? prep : null;

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[60ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Therapy prep</h1>
            <Link to="/today" className="text-[12px] text-muted-foreground hover:text-ink">
              back to today →
            </Link>
          </div>
          <p className="mb-8 max-w-[50ch] text-[15px] leading-relaxed text-muted-foreground">
            Bring your clearest self to your session. Knole gathers what's been alive since last
            time — grounded in your own words, dated. You choose what to take, and nothing leaves
            unless you copy it.
          </p>

          {!prep && (
            <button
              onClick={runPrep}
              disabled={busy}
              className="rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-opacity disabled:opacity-50"
            >
              {busy ? "Reading your recent entries…" : "Prep me for my session"}
            </button>
          )}

          {prep && !prep.ready && (
            <p className="text-[14px] text-muted-foreground">
              Not enough recent writing to prepare from yet. Write on Today for a few days, then
              come back.
            </p>
          )}

          {p && (
            <div className="space-y-6">
              {p.themes.length > 0 && (
                <div className="rounded-2xl border border-rule bg-card/50 p-6">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                    On your mind lately
                  </div>
                  <p className="text-[15px] text-ink-soft">{p.themes.join(" · ")}</p>
                </div>
              )}

              {p.talkingPoints.length > 0 && (
                <div>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-tan">
                    Things to raise · quoted from your entries
                  </div>
                  <div className="space-y-3">
                    {p.talkingPoints.map((tp, i) => (
                      <Item key={i} on={!!include[`tp${i}`]} onToggle={() => toggle(`tp${i}`)}>
                        <p className="text-[16px] leading-relaxed text-ink">{tp.point}</p>
                        <p className="mt-1 border-l-2 border-tan/40 pl-3 text-[14px] italic text-ink-soft">
                          "{tp.quote}"{" "}
                          <span className="text-[11px] not-italic text-muted-foreground">
                            — {tp.date}
                          </span>
                        </p>
                      </Item>
                    ))}
                  </div>
                </div>
              )}

              {p.unresolved.length > 0 && (
                <div>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-tan">
                    Still open
                  </div>
                  <div className="space-y-3">
                    {p.unresolved.map((u, i) => (
                      <Item key={i} on={!!include[`un${i}`]} onToggle={() => toggle(`un${i}`)}>
                        <p className="text-[15px] text-ink-soft">{u}</p>
                      </Item>
                    ))}
                  </div>
                </div>
              )}

              {p.wins.length > 0 && (
                <div>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-tan">
                    Worth naming
                  </div>
                  <div className="space-y-3">
                    {p.wins.map((w, i) => (
                      <Item key={i} on={!!include[`win${i}`]} onToggle={() => toggle(`win${i}`)}>
                        <p className="text-[15px] text-ink-soft">
                          {w.text}
                          {w.date && (
                            <span className="ml-2 text-[11px] text-muted-foreground">
                              — {w.date}
                            </span>
                          )}
                        </p>
                      </Item>
                    ))}
                  </div>
                </div>
              )}

              {/* Validated measures — the numbers a clinician can use, from /wellbeing check-ins. */}
              {p.measures.length > 0 && (
                <div>
                  <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-tan">
                    Check-ins since last session
                  </div>
                  <div className="space-y-1.5">
                    {p.measures.map((m, i) => (
                      <p key={i} className="text-[14px] text-ink-soft">
                        {m.instrument}: <span className="tabular-nums">{m.score}</span>{" "}
                        <span className="text-muted-foreground">({m.band})</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">— {m.date}</span>
                      </p>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                    PHQ-9 and GAD-7, self-reported in Knole — screening numbers, not a diagnosis.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-4 border-t border-rule pt-6">
                <button
                  onClick={() => copyForSession(p)}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
                >
                  {copied ? "Copied ✓" : "Copy the ticked items"}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Only what you tick is copied. Your raw journal never leaves.
                </span>
              </div>
            </div>
          )}

          {/* Post-session capture — closes the loop, feeds the next prep. */}
          <div className="mt-12 border-t border-rule pt-8">
            <h2 className="mb-1 font-display text-[24px] italic">After your session</h2>
            <p className="mb-4 text-[13px] text-muted-foreground">
              A few lines now make the next prep sharper — and resets the window.
            </p>
            {captured ? (
              <p className="font-display text-[16px] italic text-ink-soft">
                Saved. Knole's holding it for next time.
              </p>
            ) : (
              <div className="space-y-3">
                {(
                  [
                    ["cameUp", "What came up?"],
                    ["homework", "Anything to work on?"],
                    ["howIFelt", "How did you feel after?"],
                  ] as const
                ).map(([k, label]) => (
                  <textarea
                    key={k}
                    value={form[k]}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                    rows={2}
                    placeholder={label}
                    className="w-full resize-none rounded-xl border border-rule bg-card/50 px-4 py-3 text-[14px] text-ink placeholder:text-muted-foreground/60 focus:border-tan/40 focus:outline-none"
                  />
                ))}
                <button
                  onClick={capture}
                  className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
                >
                  Save & mark session
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </Shell>
  );
}

function Item({
  on,
  onToggle,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 transition-colors ${
        on ? "border-tan/40 bg-card/50" : "border-rule bg-card/20 opacity-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          aria-pressed={on}
          className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
            on ? "border-tan bg-tan/20 text-tan" : "border-rule text-transparent"
          }`}
        >
          ✓
        </button>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
