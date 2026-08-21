import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { peopleListFn } from "@/server/fns";
import type { PersonSummary } from "@/server/people";

// Everyone the journal knows. The entity and edge tables have held this since they shipped, but
// nothing ever showed it back — so the one thing an ordinary journal cannot do, tell you how a
// relationship actually changed, was invisible. Read-only; the story lives on /person/$name.

export const Route = createFileRoute("/people")({
  loader: async () => await peopleListFn(),
  head: () => ({
    meta: [
      { title: "People — Knole" },
      { name: "description", content: "The people and places your journal keeps returning to." },
    ],
  }),
  component: PeoplePage,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

function PeoplePage() {
  const { people } = Route.useLoaderData() as { people: PersonSummary[] };

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">People</p>
          <h1 className="mb-3 font-display text-[34px] italic leading-none sm:text-[44px]">
            Who keeps appearing.
          </h1>
          <p className="mb-10 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
            The people and places your own words keep returning to — and, where Knole has learned
            it, how each one has changed over time. Nobody else can see this.
          </p>

          {people.length === 0 ? (
            <div className="rounded-2xl border border-rule bg-card/50 p-6">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Nobody yet. Write about the people in your life and they'll gather here — with the
                turns their stories take, dated from your own entries.{" "}
                <Link to="/today" className="text-tan underline-offset-2 hover:underline">
                  Start today →
                </Link>
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {people.map((p) => {
                const bits = [
                  p.memories > 0 && `${p.memories} ${p.memories === 1 ? "memory" : "memories"}`,
                  p.liveTies > 0 && `${p.liveTies} current ${p.liveTies === 1 ? "tie" : "ties"}`,
                  p.endedTies > 0 && `${p.endedTies} ended`,
                ].filter(Boolean) as string[];
                return (
                  <li key={p.name}>
                    <Link
                      to="/person/$name"
                      params={{ name: p.name }}
                      className="group flex items-baseline justify-between gap-4 rounded-2xl border border-rule bg-card/50 px-5 py-4 transition-colors hover:border-tan/40"
                    >
                      <span className="min-w-0">
                        <span className="block font-display text-[19px] italic text-ink">
                          {p.name}
                        </span>
                        {bits.length > 0 && (
                          <span className="mt-0.5 block text-[12px] text-muted-foreground">
                            {bits.join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground/70">
                        {fmt(p.lastSeen) ?? ""}
                        <span className="ml-2 text-tan opacity-0 transition-opacity group-hover:opacity-100">
                          →
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </Shell>
  );
}
