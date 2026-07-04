import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { listProgramsFn, startProgramFn } from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/programs")({
  head: () => ({
    meta: [
      { title: "Programs — Knole" },
      { name: "description", content: "Guided journaling programs — never face a blank page." },
    ],
  }),
  component: ProgramsPage,
});

type ProgramState = {
  id: string;
  title: string;
  blurb: string;
  totalDays: number;
  currentDay: number;
  status: "none" | "active" | "completed" | "abandoned";
};

function ProgramsPage() {
  const list = useServerFn(listProgramsFn);
  const start = useServerFn(startProgramFn);
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<ProgramState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    list()
      .then((r) => setPrograms(r.programs))
      .catch(() => setPrograms([]));
  }, [list]);

  async function begin(id: string) {
    setBusy(id);
    try {
      const r = await start({ data: { programId: id } });
      if (r.ok) navigate({ to: "/today" });
      else setBusy(null);
    } catch {
      setBusy(null);
    }
  }

  const label = (p: ProgramState) => {
    if (p.status === "active") return `Continue — day ${p.currentDay + 1} of ${p.totalDays}`;
    if (p.status === "completed") return "Completed · start again";
    if (p.status === "abandoned") return "Pick back up";
    return `Start · ${p.totalDays} days`;
  };

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Programs</h1>
            <Link to="/today" className="text-[12px] text-muted-foreground hover:text-ink">
              back to today →
            </Link>
          </div>
          <p className="mb-10 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
            When the page feels blank, start a guided arc — a few minutes a day, always yours to
            leave.
          </p>

          {programs === null ? (
            <p className="text-[14px] text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              {programs.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-rule bg-card/50 p-6 transition-colors hover:border-tan/40"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-[22px] italic text-ink">{p.title}</h2>
                    {p.status === "active" && (
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-tan">
                        in progress
                      </span>
                    )}
                    {p.status === "completed" && (
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        completed
                      </span>
                    )}
                  </div>
                  <p className="mb-4 text-[14px] leading-relaxed text-muted-foreground">
                    {p.blurb}
                  </p>
                  {p.status === "active" && (
                    <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-rule">
                      <div
                        className="h-full rounded-full bg-tan transition-all"
                        style={{ width: `${Math.round((p.currentDay / p.totalDays) * 100)}%` }}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => begin(p.id)}
                    disabled={busy === p.id}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
                  >
                    {busy === p.id ? "Opening…" : label(p)}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
