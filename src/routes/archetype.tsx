import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Shell } from "@/components/knole/Shell";
import { archetypeStatusFn, archetypeRevealFn } from "@/server/fns";
import type { Archetype, RevealContent } from "@/server/archetypes";

export const Route = createFileRoute("/archetype")({
  head: () => ({
    meta: [
      { title: "Archetype — Knole" },
      {
        name: "description",
        content: "Who you were this month — named from your own words, with receipts.",
      },
    ],
  }),
  component: ArchetypePage,
});

const FAMILY_LABEL: Record<string, string> = {
  makers: "The Makers",
  carriers: "The Carriers",
  movers: "The Movers",
  keepers: "The Keepers",
};

const FAMILY_TONE: Record<string, string> = {
  makers: "#a98a5e",
  carriers: "#7a7382",
  movers: "#7c6545",
  keepers: "#c2a15e",
};

const monthName = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

type Status = {
  sealed: { monthKey: string; entryCount: number; daysUntilReveal: number };
  timeline: { monthKey: string; archetypeId: string | null }[];
  taxonomy: Archetype[];
  letterUnlocked: boolean;
};

type Reveal =
  | { state: "ready"; content: RevealContent; entryCount: number }
  | { state: "thin"; entryCount: number; needed: number }
  | { state: "sealed" }
  | { state: "error" };

function ArchetypePage() {
  const getStatus = useServerFn(archetypeStatusFn);
  const doReveal = useServerFn(archetypeRevealFn);
  const [status, setStatus] = useState<Status | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [revealing, setRevealing] = useState(false);
  // The ceremony: staged tap-through, archetype LAST.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let alive = true;
    getStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = (id: string) => status?.taxonomy.find((a) => a.id === id) ?? null;

  const open = async () => {
    if (revealing) return;
    setRevealing(true);
    setStage(0);
    try {
      const r = await doReveal({ data: {} });
      setReveal(r);
    } catch {
      setReveal({ state: "error" });
    } finally {
      setRevealing(false);
    }
  };

  const lastMonthKey = status
    ? (() => {
        const [y, m] = status.sealed.monthKey.split("-").map(Number);
        return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
      })()
    : "";

  const archetype = reveal?.state === "ready" ? byId(reveal.content.archetypeId) : null;

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            The Archetype
          </p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Who you were this month.
          </h1>
          <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
            Named from your own words — never a horoscope. Every reveal carries receipts: the exact
            lines of yours it stands on.
          </p>

          {/* The sealed current month — the anticipation mechanic */}
          {status && (
            <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-6">
              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                {monthName(status.sealed.monthKey)} · sealed
              </div>
              <p className="font-display text-[20px] italic leading-snug text-ink">
                {status.sealed.daysUntilReveal === 0
                  ? "It opens today."
                  : `It opens in ${status.sealed.daysUntilReveal} ${status.sealed.daysUntilReveal === 1 ? "day" : "days"}.`}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {status.sealed.entryCount} {status.sealed.entryCount === 1 ? "entry" : "entries"} in
                the envelope so far — every one sharpens the read. No early access, for anyone.
              </p>
            </div>
          )}

          {/* Last month: the envelope */}
          {status && !reveal && (
            <div className="mt-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6 text-center">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                {monthName(lastMonthKey)}
              </div>
              <p className="font-display text-[22px] italic text-ink">Your month is ready.</p>
              <button
                onClick={() => void open()}
                disabled={revealing}
                className="mt-4 rounded-full bg-ink px-6 py-3 text-[14px] text-paper transition-opacity disabled:opacity-50"
              >
                {revealing ? "Breaking the seal…" : "Open it"}
              </button>
            </div>
          )}

          {/* Thin month */}
          {reveal?.state === "thin" && (
            <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-6">
              <p className="font-display text-[18px] italic text-ink-soft">
                The month ran thin — {reveal.entryCount}{" "}
                {reveal.entryCount === 1 ? "entry" : "entries"}, and an honest read needs{" "}
                {reveal.needed}.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                No archetype gets invented from too little. This month is already collecting —{" "}
                <Link to="/today" className="text-tan hover:text-ink">
                  give it a line today →
                </Link>
              </p>
            </div>
          )}

          {reveal?.state === "error" && (
            <p className="mt-6 text-[13px] text-muted-foreground">
              The reader couldn't finish just now — nothing was decided without evidence. Try again
              in a moment.
            </p>
          )}

          {/* The ceremony: tap-through, archetype LAST */}
          {reveal?.state === "ready" && archetype && (
            <div className="mt-6">
              {stage === 0 && (
                <button onClick={() => setStage(1)} className="block w-full text-left">
                  <div className="animate-fade-up rounded-2xl border border-rule bg-card/50 p-7">
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {reveal.entryCount} entries. A month of your own words, read closely.
                    </p>
                    <p className="mt-3 font-display text-[20px] italic text-ink">
                      First — what it stood on. Tap.
                    </p>
                  </div>
                </button>
              )}
              {stage === 1 && (
                <button onClick={() => setStage(2)} className="block w-full text-left">
                  <div className="animate-fade-up rounded-2xl border border-rule bg-card/50 p-7">
                    <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-tan">
                      The receipts
                    </div>
                    <div className="space-y-4">
                      {reveal.content.claims.map((c, i) => (
                        <div key={i}>
                          <p className="text-[13px] leading-relaxed text-ink-soft">{c.claim}</p>
                          <p className="mt-1 border-l-2 border-tan/40 pl-3 font-display text-[15px] italic text-ink">
                            "{c.quote}"
                            <span className="ml-2 text-[10px] not-italic text-muted-foreground">
                              {c.entryDate}
                            </span>
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-[13px] text-muted-foreground">
                      Your own words, verified against your entries. Tap for the name.
                    </p>
                  </div>
                </button>
              )}
              {stage >= 2 && (
                <div className="animate-fade-up">
                  <div
                    className="rounded-2xl border p-8 text-center"
                    style={{
                      borderColor: `${FAMILY_TONE[archetype.family]}55`,
                      background: `${FAMILY_TONE[archetype.family]}0d`,
                    }}
                  >
                    <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      {monthName(lastMonthKey)} · {FAMILY_LABEL[archetype.family]}
                    </div>
                    <h2 className="mt-3 font-display text-[40px] italic leading-none text-ink">
                      {archetype.name}
                    </h2>
                    <p className="mx-auto mt-4 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">
                      {archetype.essence}
                    </p>
                    <p className="mx-auto mt-3 max-w-[44ch] text-[12px] italic leading-relaxed text-muted-foreground">
                      {archetype.shadow}
                    </p>
                  </div>

                  {/* The letter — the paid layer; the locked letter IS the conversion moment */}
                  <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-6">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                      The letter
                    </div>
                    {status?.letterUnlocked ? (
                      <p className="whitespace-pre-line font-display text-[16px] italic leading-relaxed text-ink-soft">
                        {reveal.content.letter}
                      </p>
                    ) : (
                      <div>
                        <p className="font-display text-[16px] italic leading-relaxed text-muted-foreground/60 [mask-image:linear-gradient(to_bottom,black_20%,transparent_90%)]">
                          {reveal.content.letter.slice(0, 140)}…
                        </p>
                        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                          A letter about your month, written from your own words, is waiting.
                        </p>
                        <Link
                          to="/upgrade"
                          className="mt-2 inline-block text-[13px] text-tan underline-offset-2 hover:text-ink hover:underline"
                        >
                          unlock the letter with Deep →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Evolution timeline */}
          {status && status.timeline.filter((t) => t.archetypeId).length > 0 && (
            <div className="mt-10">
              <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-tan">
                The evolution
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {status.timeline
                  .filter((t) => t.archetypeId)
                  .map((t, i, arr) => (
                    <span key={t.monthKey} className="flex items-center gap-2">
                      <span className="rounded-full border border-rule bg-card/50 px-3 py-1.5 text-[12px] text-ink">
                        <span className="mr-1.5 text-muted-foreground">
                          {monthName(t.monthKey).split(" ")[0].slice(0, 3)}
                        </span>
                        {byId(t.archetypeId!)?.name ?? t.archetypeId}
                      </span>
                      {i < arr.length - 1 && <span className="text-muted-foreground/50">→</span>}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
