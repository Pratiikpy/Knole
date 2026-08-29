import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { personStoryFn } from "@/server/fns";
import type { PersonStory } from "@/server/people";

// One person's story. The part no ordinary journal can show: not just what is true now, but what
// USED to be true and when it stopped — read straight off the bi-temporal edges and the superseded
// memories that retrieval normally hides.

export const Route = createFileRoute("/person/$name")({
  loader: async ({ params }) => await personStoryFn({ data: { name: params.name } }),
  head: ({ params }) => ({
    meta: [{ title: `${params.name} — Knole` }],
  }),
  component: PersonPage,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(iso: string | null): string {
  if (!iso) return "undated";
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
/** WORKS_AT → "works at". The relation is stored as the machine token; people read prose. */
const say = (relation: string) => relation.replace(/_/g, " ").toLowerCase();

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{children}</p>
  );
}

function PersonPage() {
  const s = Route.useLoaderData() as PersonStory;
  const { name, live, past, timeline, entries } = s;
  // Superseded memories are the turns in the story — retrieval hides them, this page is the one
  // place they belong.
  const superseded = timeline.filter((t) => t.status === "superseded").length;

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <h1 className="font-display text-[34px] italic leading-none sm:text-[44px]">{name}</h1>
            <Link
              to="/people"
              className="shrink-0 text-[12px] text-muted-foreground hover:text-ink"
            >
              ← everyone
            </Link>
          </div>
          <p className="mb-10 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
            {s.known
              ? "Drawn only from what you wrote. Lines that have ended are kept, not deleted — that's the story."
              : "Knole hasn't learned anything about them yet."}
          </p>

          {live.length > 0 && (
            <div className="mb-8">
              <Label>How things stand</Label>
              <ul className="space-y-2">
                {live.map((e, i) => (
                  <li
                    key={`${e.source}-${e.relation}-${e.target}-${i}`}
                    className="rounded-2xl border border-tan/30 bg-tan/[0.04] px-5 py-4"
                  >
                    <p className="text-[12px] text-tan">
                      {e.source} <span className="text-tan/70">{say(e.relation)}</span> {e.target}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{e.fact}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">since {fmt(e.validAt)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {past.length > 0 && (
            <div className="mb-8">
              <Label>What changed</Label>
              <ul className="space-y-2">
                {past.map((e, i) => (
                  <li
                    key={`${e.source}-${e.relation}-${e.target}-past-${i}`}
                    className="rounded-2xl border border-rule bg-card/40 px-5 py-4"
                  >
                    <p className="text-[12px] text-muted-foreground">
                      {e.source} <span className="line-through">{say(e.relation)}</span> {e.target}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                      {e.fact}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      true from {fmt(e.validAt)} until {fmt(e.invalidAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {timeline.length > 0 && (
            <div className="mb-8">
              <Label>
                The story, in order
                {superseded > 0 && ` · ${superseded} since revised`}
              </Label>
              <ol className="space-y-0">
                {timeline.map((t, i) => {
                  const old = t.status === "superseded";
                  return (
                    <li key={`${t.content}-${i}`} className="relative pb-5 pl-6">
                      {/* the thread: a line down the left, a node per turn */}
                      {i < timeline.length - 1 && (
                        <span className="absolute left-[3px] top-2 h-full w-px bg-rule" />
                      )}
                      <span
                        className={`absolute left-0 top-[6px] size-[7px] rounded-full ${old ? "bg-rule" : "bg-tan"}`}
                      />
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
                        {fmt(t.validAt)}
                        {old && " · later revised"}
                      </p>
                      <p
                        className={`mt-1 text-[14px] leading-relaxed ${old ? "text-muted-foreground" : "text-ink-soft"}`}
                      >
                        {t.content}
                      </p>
                      {old && t.supersededBy && (
                        <p className="mt-1 text-[12px] leading-relaxed text-tan">
                          became: {t.supersededBy}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {entries.length > 0 && (
            <div>
              <Label>In your own words</Label>
              <ul className="space-y-2">
                {entries.map((e) => (
                  <li key={e.id} className="rounded-2xl border border-rule bg-card/40 px-5 py-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {fmt(e.date)}
                    </p>
                    <p className="mt-1 font-display text-[15px] italic leading-relaxed text-ink-soft">
                      “{e.text.length > 260 ? `${e.text.slice(0, 257)}…` : e.text}”
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!s.known && (
            <div className="rounded-2xl border border-rule bg-card/50 p-6">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Write about them and their story starts filling in here.{" "}
                <Link to="/today" className="text-tan underline-offset-2 hover:underline">
                  Today →
                </Link>
              </p>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
