import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { listMemoriesFn, setMemoryStatusFn, editMemoryFn } from "@/server/fns";
import { useState } from "react";

export const Route = createFileRoute("/the-index")({
  head: () => ({
    meta: [
      { title: "The Index — what Knole knows about you" },
      {
        name: "description",
        content: "Every memory Knole holds. Editable, pinnable, forgettable. Only you can read it.",
      },
    ],
  }),
  loader: async () => await listMemoriesFn(),
  component: TheIndex,
});

type Memory = {
  id: string;
  content: string;
  type: string;
  status: string;
  sourceQuote: string | null;
  recallCount: number;
  createdAt: string;
  kvRef: string | null;
};

const typeLabel: Record<string, string> = {
  fact: "Fact",
  pattern: "Core pattern",
  commitment: "Commitment",
  relationship: "Relationship",
  preference: "Preference",
  value: "Value",
  emotion: "Feeling",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const knoleFacts = [
  { text: "You asked me to speak with structure and clarity.", meta: "set during onboarding" },
  { text: "You don't want pings before 9am or after 9pm.", meta: "quiet hours · your choice" },
  { text: "You'd rather I ask one question than offer three answers.", meta: "your rule" },
];

function TheIndex() {
  const { memories: initial } = Route.useLoaderData();
  const doStatus = useServerFn(setMemoryStatusFn);
  const doEdit = useServerFn(editMemoryFn);

  const [tab, setTab] = useState<"you" | "knole">("you");
  const [facts, setFacts] = useState<Memory[]>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const togglePin = async (m: Memory) => {
    const status = m.status === "pinned" ? "active" : "pinned";
    setFacts((f) => f.map((x) => (x.id === m.id ? { ...x, status } : x)));
    await doStatus({ data: { id: m.id, status } });
  };
  const forget = async (id: string) => {
    setFacts((f) => f.filter((x) => x.id !== id));
    await doStatus({ data: { id, status: "forgotten" } });
  };
  const startEdit = (m: Memory) => {
    setEditing(m.id);
    setDraft(m.content);
  };
  const saveEdit = async () => {
    if (!editing) return;
    const id = editing;
    const content = draft.trim();
    setFacts((arr) => arr.map((x) => (x.id === id ? { ...x, content } : x)));
    setEditing(null);
    if (content) await doEdit({ data: { id, content } });
  };

  const sorted = [...facts].sort(
    (a, b) => Number(b.status === "pinned") - Number(a.status === "pinned"),
  );

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">The Index</h1>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {facts.length} {facts.length === 1 ? "memory" : "memories"}
            </span>
          </div>
          <p className="mt-4 max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
            Everything Knole remembers about you, in your own words. Edit anything. Pin what
            matters. Forget what doesn't.
          </p>

          <div className="mt-8 flex w-fit items-center gap-1 rounded-full border border-rule p-1">
            {(["you", "knole"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-full px-4 py-1.5 text-[12px] transition-colors ${
                  tab === k ? "bg-ink text-paper" : "text-muted-foreground hover:text-ink"
                }`}
              >
                {k === "you" ? "About you" : "About Knole"}
              </button>
            ))}
          </div>

          {tab === "you" && facts.length === 0 && (
            <p className="mt-12 text-[15px] italic leading-relaxed text-muted-foreground">
              Knole hasn't learned anything about you yet. Write a few entries on Today — it starts
              remembering from the first one.
            </p>
          )}

          {tab === "you" && facts.length > 0 && (
            <ul className="mt-10 space-y-3">
              {sorted.map((f) => (
                <li
                  key={f.id}
                  className="group rounded-xl border border-rule bg-card/50 p-5 transition-colors hover:border-ink/15"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {f.status === "pinned" && (
                        <svg viewBox="0 0 24 24" className="size-3 text-tan" fill="currentColor">
                          <path d="M12 2l1.7 4.6L18 8l-3.5 2.8.8 4.7L12 13.8l-3.3 1.7.8-4.7L6 8l4.3-1.4z" />
                        </svg>
                      )}
                      <span>{typeLabel[f.type] ?? f.type}</span>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="text-muted-foreground/70">
                        {f.recallCount > 0
                          ? `recalled ${f.recallCount}×`
                          : `noticed ${fmtDate(f.createdAt)}`}
                      </span>
                      {f.kvRef && (
                        <span title={`Stored on 0G · ${f.kvRef}`} className="text-tan/80">
                          ⬡ 0G
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => togglePin(f)}
                        className="text-[11px] text-muted-foreground hover:text-tan"
                      >
                        {f.status === "pinned" ? "unpin" : "pin"}
                      </button>
                      <button
                        onClick={() => startEdit(f)}
                        className="text-[11px] text-muted-foreground hover:text-ink"
                      >
                        edit
                      </button>
                      <button
                        onClick={() => forget(f.id)}
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        forget
                      </button>
                    </div>
                  </div>

                  {editing === f.id ? (
                    <div>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-lg border border-rule bg-paper p-3 text-[14px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-tan/30"
                      />
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          onClick={() => setEditing(null)}
                          className="text-[11px] text-muted-foreground"
                        >
                          cancel
                        </button>
                        <button
                          onClick={saveEdit}
                          className="rounded-full bg-ink px-3 py-1.5 text-[11px] text-paper"
                        >
                          save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[15px] leading-relaxed text-ink">{f.content}</p>
                      {f.sourceQuote && (
                        <p className="mt-2 border-l-2 border-tan/30 pl-3 text-[12px] italic leading-relaxed text-muted-foreground">
                          “{f.sourceQuote}”
                        </p>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {tab === "knole" && (
            <ul className="mt-10 space-y-3">
              {knoleFacts.map((f, i) => (
                <li key={i} className="rounded-xl border border-rule bg-card/50 p-5">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    your instruction · {f.meta}
                  </div>
                  <p className="text-[15px] leading-relaxed text-ink">{f.text}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-14 flex items-center gap-4">
            <div className="h-px flex-1 bg-rule" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Only you can read this
            </span>
            <div className="h-px flex-1 bg-rule" />
          </div>

          <p className="mt-6 text-center text-[12px] leading-relaxed text-muted-foreground">
            Encrypted on your own key, stored on 0G. We can't read it, can't reset it, can't take it
            away.
            <br />
            Export anything, anytime.
          </p>
        </div>
      </section>
    </Shell>
  );
}
