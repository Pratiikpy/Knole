import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { researchFn, creditPacksFn } from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Research — Knole" },
      {
        name: "description",
        content: "Research anything privately — the query never leaves tied to you.",
      },
    ],
  }),
  component: ResearchPage,
});

function ResearchPage() {
  const doResearch = useServerFn(researchFn);
  const getPacks = useServerFn(creditPacksFn);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);

  useEffect(() => {
    getPacks()
      .then((r) => {
        setCredits(r.credits);
        setUnlimited(r.unlimited);
      })
      .catch(() => {});
  }, [getPacks]);

  async function run() {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    setErr(null);
    setAnswer(null);
    try {
      const r = await doResearch({ data: { question } });
      if (r.ok) {
        setAnswer(r.answer);
        if (typeof r.credits === "number") setCredits(r.credits);
      } else if (r.reason === "need_credits") {
        setCredits(r.credits);
        setErr("You're out of credits — top up on Create, or go unlimited with the Deeper plan.");
      } else {
        setErr(
          r.reason === "not_configured"
            ? "Research isn't turned on in this environment."
            : "Couldn't research that one — try rephrasing.",
        );
      }
    } catch {
      setErr("Something interrupted it — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[62ch]">
          <h1 className="mb-1 font-display text-[44px] italic leading-none">Research</h1>
          <p className="mb-4 max-w-[54ch] text-[15px] leading-relaxed text-muted-foreground">
            Ask a real question and get a researched answer — on 0G, and private: your name is
            stripped before the search runs, so the query never leaves tied to you. Web research,
            without the surveillance.
          </p>
          {!unlimited && credits !== null && (
            <p className="mb-4 text-[12px] text-muted-foreground">
              {credits} credits · 3 per query ·{" "}
              <Link to="/create" className="text-tan hover:text-ink">
                top up
              </Link>{" "}
              ·{" "}
              <Link to="/upgrade" className="text-tan hover:text-ink">
                go unlimited
              </Link>
            </p>
          )}
          {unlimited && (
            <p className="mb-4 text-[12px] text-tan">Unlimited — you own your Knole.</p>
          )}

          <div className="mb-6 rounded-2xl border border-rule bg-card/50 p-4">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
              }}
              rows={3}
              placeholder="What are the trade-offs between a Roth and a traditional IRA for someone in their 30s?"
              className="w-full resize-none border-none bg-transparent text-[16px] leading-relaxed text-ink placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">anonymised · on 0G</span>
              <button
                onClick={run}
                disabled={busy || q.trim().length < 3}
                className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
              >
                {busy ? "Researching…" : "Research"}
              </button>
            </div>
          </div>

          {err && <p className="mb-4 text-[13px] text-tan">{err}</p>}

          {busy && (
            <div className="rounded-2xl border border-rule bg-card/30 p-6">
              <span className="font-display text-[16px] italic text-muted-foreground">
                searching privately — this can take a moment…
              </span>
            </div>
          )}

          {answer && !busy && (
            <div className="animate-fade-up rounded-2xl border border-rule bg-card/50 p-6">
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                {answer}
              </p>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
