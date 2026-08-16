import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import {
  listIntentionsFn,
  createIntentionFn,
  setIntentionStatusFn,
  suggestIntentionsFn,
  intentionMovementFn,
} from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/intentions")({
  head: () => ({
    meta: [
      { title: "Intentions — Knole" },
      { name: "description", content: "What you're working toward, measured from your own words." },
    ],
  }),
  component: IntentionsPage,
});

type Intention = { id: string; text: string; status: string; source: string; createdAt: string };
type Movement = {
  direction: "toward" | "drifted" | "none";
  quote: string | null;
  entryDate: string | null;
  note: string | null;
};

const MAX_ACTIVE = 3;

function IntentionsPage() {
  const list = useServerFn(listIntentionsFn);
  const create = useServerFn(createIntentionFn);
  const setStatus = useServerFn(setIntentionStatusFn);
  const suggest = useServerFn(suggestIntentionsFn);
  const movementFn = useServerFn(intentionMovementFn);

  const [items, setItems] = useState<Intention[] | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [movements, setMovements] = useState<Record<string, Movement | "loading">>({});

  const refresh = () =>
    list()
      .then((r) => setItems(r.intentions))
      .catch(() => setItems([]));
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = (items ?? []).filter((i) => i.status === "active");
  const past = (items ?? []).filter((i) => i.status !== "active");

  async function add(t: string, source: "user" | "suggested") {
    const v = t.trim();
    // A double-tap (and the Cmd+Enter path) created several intentions at once, immediately
    // tripping the user's own "hold 3 at a time" limit.
    if (!v || adding) return;
    setAdding(true);
    setNote(null);
    try {
      const r = await create({ data: { text: v, source } });
      if (!r.ok) {
        setNote(
          r.reason === "too_many"
            ? `You can hold ${MAX_ACTIVE} at a time — release one first.`
            : "Couldn't set that intention. Try again in a moment.",
        );
        return;
      }
      setText("");
      setCandidates((c) => (c ? c.filter((x) => x !== t) : c));
      refresh();
    } catch {
      // There was no catch at all: signed out or rate-limited meant a dead button and an
      // unhandled rejection, with the note cleared so nothing at all was on screen.
      setNote("Couldn't set that intention. Try again in a moment.");
    } finally {
      setAdding(false);
    }
  }

  async function doSuggest() {
    setSuggesting(true);
    try {
      const r = await suggest();
      setCandidates(r.candidates);
    } catch {
      setCandidates([]);
    } finally {
      setSuggesting(false);
    }
  }

  async function checkMovement(i: Intention) {
    setMovements((m) => ({ ...m, [i.id]: "loading" }));
    try {
      const r = await movementFn({ data: { text: i.text } });
      setMovements((m) => ({ ...m, [i.id]: r }));
    } catch {
      setMovements((m) => {
        const c = { ...m };
        delete c[i.id];
        return c;
      });
    }
  }

  const dirLabel = (d: Movement["direction"]) =>
    d === "toward"
      ? "moving toward it"
      : d === "drifted"
        ? "drifted a little"
        : "no clear signal yet";

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Intentions</h1>
            <Link to="/today" className="text-[12px] text-muted-foreground hover:text-ink">
              back to today →
            </Link>
          </div>
          <p className="mb-10 max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">
            What you're working toward, in your own words. Knole reads your entries for movement —
            and shows the line that proves it. Never a streak, never a failure.
          </p>

          {/* Add / suggest */}
          {active.length < MAX_ACTIVE && (
            <div className="mb-8 rounded-2xl border border-rule bg-card/50 p-6">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add(text, "user");
                }}
                rows={2}
                placeholder="Be less reactive when I'm tired · Decide about the job · …"
                className="w-full resize-none border-none bg-transparent font-display text-[18px] italic leading-snug text-ink placeholder:text-muted-foreground/50 focus:outline-none"
              />
              <div className="mt-3 flex items-center justify-between border-t border-rule pt-4">
                <button
                  onClick={doSuggest}
                  disabled={suggesting}
                  className="text-[12px] text-muted-foreground hover:text-ink disabled:opacity-50"
                >
                  {suggesting ? "reading your writing…" : "suggest from my writing"}
                </button>
                <button
                  onClick={() => add(text, "user")}
                  disabled={!text.trim()}
                  className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
                >
                  Set intention
                </button>
              </div>
              {note && <p className="mt-3 text-[12px] text-tan">{note}</p>}
              {candidates && (
                <div className="mt-4 border-t border-rule pt-4">
                  {candidates.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">
                      Nothing clear yet — keep writing and check back.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        from your entries
                      </p>
                      {candidates.map((c) => (
                        <button
                          key={c}
                          onClick={() => add(c, "suggested")}
                          className="block w-full rounded-lg border border-rule px-3 py-2 text-left text-[14px] text-ink-soft transition-colors hover:border-tan/40"
                        >
                          + {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active intentions */}
          {items === null ? (
            <p className="text-[14px] text-muted-foreground">Loading…</p>
          ) : active.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              No intentions yet. Name one above, or let Knole suggest from what you've written.
            </p>
          ) : (
            <div className="space-y-4">
              {active.map((i) => {
                const mv = movements[i.id];
                return (
                  <div key={i.id} className="rounded-2xl border border-rule bg-card/50 p-6">
                    <p className="mb-3 font-display text-[20px] italic leading-snug text-ink">
                      {i.text}
                    </p>
                    {mv && mv !== "loading" && (
                      <div className="mb-4 border-l-2 border-tan/40 pl-4">
                        <p className="text-[13px] font-medium text-tan">{dirLabel(mv.direction)}</p>
                        {mv.quote && (
                          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
                            "{mv.quote}"
                            {mv.entryDate && (
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                — {mv.entryDate}
                              </span>
                            )}
                          </p>
                        )}
                        {mv.note && (
                          <p className="mt-1 text-[13px] italic text-muted-foreground">{mv.note}</p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-[12px]">
                      <button
                        onClick={() => checkMovement(i)}
                        disabled={mv === "loading"}
                        className="rounded-full border border-rule px-3 py-1.5 text-ink transition-colors hover:border-tan/40 disabled:opacity-50"
                      >
                        {mv === "loading" ? "reading your entries…" : "check movement"}
                      </button>
                      <button
                        onClick={() =>
                          setStatus({ data: { id: i.id, status: "achieved" } }).then(refresh)
                        }
                        className="text-muted-foreground hover:text-ink"
                      >
                        mark achieved
                      </button>
                      <button
                        onClick={() =>
                          setStatus({ data: { id: i.id, status: "released" } }).then(refresh)
                        }
                        className="text-muted-foreground hover:text-ink"
                      >
                        release
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {past.length > 0 && (
            <div className="mt-10">
              <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                held before
              </p>
              <div className="space-y-2">
                {past.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between rounded-xl border border-rule/60 px-4 py-3"
                  >
                    <span className="text-[14px] text-muted-foreground">{i.text}</span>
                    <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                      {i.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
