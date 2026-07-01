import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { Composing } from "@/components/knole/Composing";
import { yearInOnePageFn } from "@/server/fns";

export const Route = createFileRoute("/year")({
  head: () => ({
    meta: [
      { title: "Your Year in One Page — Knole" },
      { name: "description", content: "A whole year of your life, distilled to its throughline." },
    ],
  }),
  loader: async () => await yearInOnePageFn(),
  component: YearView,
  pendingComponent: () => <Composing label="Composing your year…" />,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Chain explorer for the anchor tx — configurable so the testnet→mainnet switch is one env var.
const OG_EXPLORER_TX =
  import.meta.env.VITE_OG_EXPLORER_TX ??
  (import.meta.env.VITE_OG_NETWORK === "mainnet"
    ? "https://chainscan.0g.ai/tx"
    : "https://chainscan-galileo.0g.ai/tx");

function YearView() {
  const y = Route.useLoaderData();
  const maxWeight = Math.max(1, ...y.threads.map((t) => t.weight));
  const monthByIdx = (i: number) =>
    y.months.find((m) => new Date(m.period + "T00:00:00Z").getUTCMonth() === i) ?? null;

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[62ch]">
          <div className="knole-stagger">
            <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-tan">{y.year}</p>
            <h1 className="font-display text-[44px] italic leading-[1.02]">
              Your year in one page.
            </h1>
            <p className="mt-3 max-w-[46ch] text-[13px] text-muted-foreground">
              A whole year, distilled — each week rolled into a month, each month into a year, into
              one throughline. Built from your own words; only you can read it.
            </p>
          </div>

          {y.phase === "empty" ? (
            <div className="mt-12 rounded-2xl border border-rule bg-card/50 p-8">
              <p className="font-display text-[20px] italic leading-snug text-muted-foreground">
                There isn't a year to show yet. Keep writing — Knole quietly distills each week into
                a month, and each month into a year, and brings it back here.
              </p>
            </div>
          ) : y.phase === "building" ? (
            <div className="mt-12 rounded-2xl border border-tan/30 bg-tan/[0.05] p-7">
              <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                Still being written
              </div>
              <p className="font-display text-[22px] italic leading-snug text-ink-soft">
                {y.monthsCovered} {y.monthsCovered === 1 ? "month" : "months"} distilled so far. A
                few more and Knole can compose the whole year's throughline.
              </p>
              <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-rule">
                <div
                  className="h-full rounded-full bg-tan"
                  style={{ width: `${Math.min(100, (y.monthsCovered / 3) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              {y.yearly && (
                <div className="mt-10 rounded-2xl border border-tan/30 bg-tan/[0.05] p-8">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                    {y.yearly.label}
                  </div>
                  <p className="font-display text-[26px] italic leading-snug text-ink">
                    {y.yearly.throughline}
                  </p>
                  <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                    {y.yearly.essence}
                  </p>
                </div>
              )}

              <div className="mt-10">
                <div className="mb-4 text-[10px] uppercase tracking-[0.22em] text-tan">
                  Month by month
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {MONTHS.map((mn, i) => {
                    const e = monthByIdx(i);
                    return (
                      <div
                        key={i}
                        className={`rounded-xl border p-4 ${e ? "border-rule bg-card/50" : "border-rule/50 bg-card/20"}`}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {mn}
                        </div>
                        {e ? (
                          <p className="mt-1 font-display text-[14px] italic leading-snug text-ink-soft">
                            {e.label}
                          </p>
                        ) : (
                          <p className="mt-1 text-[12px] italic text-muted-foreground/50">—</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {y.threads.length > 0 && (
                <div className="mt-12">
                  <h2 className="mb-4 font-display text-[22px] italic">What carried through</h2>
                  <ul className="space-y-2">
                    {y.threads.map((t) => (
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

              {y.yearly && y.yearly.shifts.length > 0 && (
                <div className="mt-12">
                  <div className="mb-4 text-[10px] uppercase tracking-[0.22em] text-tan">
                    What shifted
                  </div>
                  <ul className="space-y-3">
                    {y.yearly.shifts.map((s, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-tan/30 pl-4 text-[15px] italic leading-relaxed text-ink-soft"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {y.anchor ? (
                <div className="mt-12 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
                  <div className="text-[13px] text-ink">Anchored on-chain</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    This year's essence is committed to 0G — a tamper-evident hash of the distilled
                    state. The words stay encrypted under your key; only the hash is public.
                  </p>
                  <div className="mt-3 break-all font-mono text-[11px] text-muted-foreground">
                    {trunc(y.anchor.hash, 22)}
                  </div>
                  <a
                    href={`${OG_EXPLORER_TX}/${y.anchor.tx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-[12px] text-tan hover:text-ink"
                  >
                    view the anchor transaction →
                  </a>
                </div>
              ) : (
                <p className="mt-12 text-center text-[12px] italic text-muted-foreground">
                  This year is still open — its essence is anchored on-chain once the year closes.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </Shell>
  );
}
