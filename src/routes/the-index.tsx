import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { isAuthRequired } from "@/lib/authError";
import {
  listMemoriesFn,
  setMemoryStatusFn,
  editMemoryFn,
  provenanceFn,
  settingsFn,
} from "@/server/fns";
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
  loader: async () => ({
    memories: (await listMemoriesFn()).memories,
    settings: await settingsFn(),
  }),
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

type Provenance = {
  content: string;
  sourceQuote: string | null;
  recallCount: number;
  sourceText: string | null;
  entryAt: string | null;
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

const voicePhrase: Record<string, string> = {
  warm: "with warmth and patience",
  structural: "with structure and clarity",
  honest: "directly and honestly",
  curious: "by asking me one good question at a time",
};
const freqPhrase = [
  "never to reach out unprompted",
  "to reach out about once a week",
  "to reach out a few times a week",
  "to reach out daily",
  "to reach out whenever there's something",
];
const hh = (h: number | null | undefined) => `${String(h ?? 0).padStart(2, "0")}:00`;

type KnoleSettings = {
  voice?: string | null;
  freqDial?: number | null;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
};
function knoleInstructions(s: KnoleSettings) {
  return [
    {
      text: `Speak to me ${voicePhrase[s.voice ?? "structural"] ?? "with structure and clarity"}.`,
      meta: "your voice",
    },
    {
      text: `Stay quiet between ${hh(s.quietHoursStart)} and ${hh(s.quietHoursEnd)}.`,
      meta: "quiet hours",
    },
    {
      text: `I've asked you ${freqPhrase[s.freqDial ?? 2] ?? "to reach out a few times a week"}.`,
      meta: "frequency",
    },
  ];
}

function TheIndex() {
  const { memories: initial, settings } = Route.useLoaderData();
  const knoleFacts = knoleInstructions(settings ?? {});
  const doStatus = useServerFn(setMemoryStatusFn);
  const doEdit = useServerFn(editMemoryFn);

  const [tab, setTab] = useState<"you" | "knole">("you");
  const [facts, setFacts] = useState<Memory[]>(initial);
  const [mutMsg, setMutMsg] = useState("");
  const flagError = (e?: unknown) => {
    setMutMsg(
      isAuthRequired(e)
        ? "Sign in to change your memories — you're viewing the demo."
        : "Couldn't save that change — it's been undone. Check your connection and try again.",
    );
    window.setTimeout(() => setMutMsg(""), 4000);
  };
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const doProv = useServerFn(provenanceFn);
  const [traced, setTraced] = useState<string | null>(null);
  const [prov, setProv] = useState<Provenance | null>(null);
  const [tracing, setTracing] = useState(false);

  const toggleTrace = async (id: string) => {
    if (traced === id) {
      setTraced(null);
      return;
    }
    setTraced(id);
    setProv(null);
    setTracing(true);
    try {
      setProv(await doProv({ data: { memoryId: id } }));
    } catch {
      setProv(null);
    } finally {
      setTracing(false);
    }
  };

  const togglePin = async (m: Memory) => {
    const status = m.status === "pinned" ? "active" : "pinned";
    const prev = m.status;
    setFacts((f) => f.map((x) => (x.id === m.id ? { ...x, status } : x)));
    try {
      await doStatus({ data: { id: m.id, status } });
    } catch (e) {
      setFacts((f) => f.map((x) => (x.id === m.id ? { ...x, status: prev } : x)));
      flagError(e);
    }
  };
  const forget = async (id: string) => {
    const idx = facts.findIndex((x) => x.id === id);
    const removed = facts[idx];
    setFacts((f) => f.filter((x) => x.id !== id));
    try {
      await doStatus({ data: { id, status: "forgotten" } });
    } catch (e) {
      if (removed) {
        setFacts((f) => {
          const copy = [...f];
          copy.splice(idx, 0, removed);
          return copy;
        });
      }
      flagError(e);
    }
  };
  const startEdit = (m: Memory) => {
    setEditing(m.id);
    setDraft(m.content);
  };
  const saveEdit = async () => {
    if (!editing) return;
    const id = editing;
    const content = draft.trim();
    const prev = facts.find((x) => x.id === id)?.content;
    setFacts((arr) => arr.map((x) => (x.id === id ? { ...x, content } : x)));
    setEditing(null);
    if (content) {
      try {
        await doEdit({ data: { id, content } });
      } catch (e) {
        if (prev !== undefined) {
          setFacts((arr) => arr.map((x) => (x.id === id ? { ...x, content: prev } : x)));
        }
        flagError(e);
      }
    }
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
          {mutMsg && (
            <p aria-live="polite" className="mt-3 text-[12px] text-destructive">
              {mutMsg}
            </p>
          )}

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
                      <span className="text-muted-foreground">
                        {f.recallCount > 0
                          ? `recalled ${f.recallCount}×`
                          : `noticed ${fmtDate(f.createdAt)}`}
                      </span>
                      {f.kvRef && (
                        <span title={`Stored on 0G · ${f.kvRef}`} className="text-tan">
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
                      <button
                        onClick={() => toggleTrace(f.id)}
                        className="text-[11px] text-muted-foreground hover:text-tan"
                      >
                        {traced === f.id ? "close" : "trace"}
                      </button>
                    </div>
                  </div>

                  {editing === f.id ? (
                    <div>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-lg border border-rule bg-paper p-3 text-[14px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-tan/30 max-md:text-base"
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

                  {traced === f.id && (
                    <div className="animate-fade-up mt-4 rounded-lg border border-rule bg-paper/60 p-4">
                      {tracing ? (
                        <p className="text-[12px] italic text-muted-foreground">tracing…</p>
                      ) : prov ? (
                        <>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-tan">
                            from your entry{prov.entryAt ? ` · ${fmtDate(prov.entryAt)}` : ""}
                          </div>
                          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">
                            {prov.sourceText ?? "(the source entry is no longer on file)"}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            <span>recalled {prov.recallCount}×</span>
                            {prov.kvRef && (
                              <span className="font-mono normal-case text-tan">
                                ⬡ on 0G · {prov.kvRef.slice(0, 10)}…{prov.kvRef.slice(-6)}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-[12px] italic text-muted-foreground">
                          No source on file.
                        </p>
                      )}
                    </div>
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
