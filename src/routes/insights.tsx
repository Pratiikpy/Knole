import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { Composing } from "@/components/knole/Composing";
import { mirrorFn } from "@/server/fns";

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
  loader: async () => await mirrorFn(),
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

function InsightsPage() {
  const m = Route.useLoaderData();
  const maxWeight = Math.max(1, ...m.themes.map((t) => t.weight));

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[60ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-tan">Pattern Mirror</p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Here's what was on your mind.
          </h1>
          <p className="mt-3 max-w-[42ch] text-[13px] text-muted-foreground">
            A short, private letter from Knole — written from your own words. No one else will ever
            see this.
          </p>

          {!m.ready ? (
            <div className="mt-12 rounded-2xl border border-rule bg-card/50 p-8">
              <p className="font-display text-[20px] italic leading-snug text-muted-foreground">
                Knole needs a few more entries before it can show you a pattern. Write on Today for
                a few days, then come back — the mirror fills in from your own words.
              </p>
            </div>
          ) : (
            <>
              {/* Streak — real */}
              <div className="mt-8 flex items-center gap-4 rounded-2xl border border-rule bg-card/50 p-5">
                <div className="font-display text-[36px] italic leading-none text-tan">
                  {m.dayCount}
                </div>
                <div>
                  <div className="text-[13px] text-ink">
                    {m.dayCount === 1 ? "day" : "days"} of quiet writing
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {m.entryCount} {m.entryCount === 1 ? "entry" : "entries"} · missed days don't
                    count against you
                  </div>
                </div>
              </div>

              {/* The throughline */}
              <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-7">
                <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                  The throughline
                </div>
                <p className="font-display text-[22px] italic leading-snug text-ink-soft">
                  {m.throughline}
                </p>
              </div>

              {/* Signature reveal — only what the words actually support */}
              <Reveal label="The loop you're in" text={m.loop} />
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
                    <span className="size-1.5 animate-breathe rounded-full bg-tan" />
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

              <p className="mt-12 text-center text-[12px] italic text-muted-foreground">
                That's enough looking back. Go live your week.
              </p>
            </>
          )}
        </div>
      </section>
    </Shell>
  );
}
