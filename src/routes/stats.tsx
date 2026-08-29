import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { publicStats, type PublicStats } from "@/server/publicStats";

// The public stats page — live, honest aggregates with the receipts to check them. No personal
// data can appear here by construction (counts only; see publicStats.ts). This is the traction
// surface: real numbers a judge or visitor can verify against the chain.

const statsFn = createServerFn({ method: "GET" }).handler(async () => publicStats());

export const Route = createFileRoute("/stats")({
  loader: () => statsFn(),
  head: () => ({
    meta: [
      { title: "Live stats — Knole" },
      { name: "description", content: "Knole's real usage, live — with on-chain receipts." },
    ],
  }),
  component: StatsPage,
});

const CONTRACTS = [
  {
    label: "Proof-of-journaling anchor",
    addr: "0xBf3865adb21Ad909BBDe235EDc9176C6d6fe28Ac",
  },
  {
    label: "Commitment staking",
    addr: "0xD79fAc63E06BE184F5C4583BB35907D83670f415",
  },
  {
    label: "Memory Agentic ID (ERC-7857)",
    addr: "0x0Fdbe7060Fd484343B7Ee3bF1F2965d4428957ca",
  },
];

function StatsPage() {
  const s = Route.useLoaderData() as PublicStats;
  const tiles: { n: number; label: string }[] = [
    { n: s.entriesWritten, label: "entries written" },
    { n: s.daysJournaled, label: "journaled days" },
    { n: s.memoriesHeld, label: "memories held" },
    { n: s.onchainAnchors, label: "on-chain receipts" },
    { n: s.journalers, label: "journals started" },
    { n: s.reflectionsShared, label: "reflections shared" },
  ];
  return (
    <main className="min-h-screen bg-paper px-6 py-16 text-ink">
      <div className="mx-auto max-w-[64ch]">
        <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Live stats
        </p>
        <h1 className="mb-3 font-display text-[38px] italic leading-tight">
          Real usage, counted honestly.
        </h1>
        <p className="mb-10 max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground">
          Aggregates only — nothing here can identify anyone. The on-chain numbers carry their own
          receipts: check them on the explorer, not on our word.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-rule bg-card/50 p-5">
              <div className="font-display text-[32px] italic leading-none text-ink tabular-nums">
                {t.n.toLocaleString()}
              </div>
              <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-rule" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              check the chain yourself
            </span>
            <div className="h-px flex-1 bg-rule" />
          </div>
          <ul className="space-y-2">
            {CONTRACTS.map((c) => (
              <li key={c.addr} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="text-ink-soft">{c.label}</span>
                <a
                  href={`https://chainscan.0g.ai/address/${c.addr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono text-[12px] text-tan underline-offset-2 hover:underline"
                >
                  {c.addr.slice(0, 8)}…{c.addr.slice(-6)} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-12 text-center text-[11px] text-muted-foreground">
          updated {new Date(s.asOf).toLocaleTimeString()} · cached five minutes ·{" "}
          <Link to="/" className="text-tan underline-offset-2 hover:underline">
            what Knole is →
          </Link>
        </p>
      </div>
    </main>
  );
}
