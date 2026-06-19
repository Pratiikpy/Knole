import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
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
  component: TheIndex,
});

type Fact = {
  id: string;
  kind: "core" | "detail" | "preference" | "relationship";
  text: string;
  meta: string;
  pinned?: boolean;
};

const initial: Fact[] = [
  {
    id: "1",
    kind: "core",
    text: "You find clarity in physical labor when cognitive tasks feel overwhelming. This usually signals a need for a screen-free week.",
    meta: "observed across 12 entries since March",
    pinned: true,
  },
  {
    id: "2",
    kind: "relationship",
    text: "Sam is your partner. You met working in a bookshop in 2019. They make you laugh in a way no one else has.",
    meta: "mentioned in 47 entries",
    pinned: true,
  },
  {
    id: "3",
    kind: "detail",
    text: "The rainy week in March 2024 in Brussels was a trip with your sister Rossi. You felt both guilt and relief.",
    meta: "from your entry on Mar 14",
  },
  {
    id: "4",
    kind: "preference",
    text: "You write best in the hour after sunset. Mornings feel performative to you.",
    meta: "inferred from timestamps",
  },
  {
    id: "5",
    kind: "core",
    text: "You read the garden as a metaphor for your inner life. When the garden is neglected, so are you.",
    meta: "recurring theme · 9 entries",
  },
  {
    id: "6",
    kind: "detail",
    text: "The scent of rosemary brings back your grandmother's kitchen in winter.",
    meta: "your entry on Jan 11",
  },
];

const knoleFacts = [
  { text: "You asked me to speak with structure and clarity.", meta: "set during onboarding" },
  { text: "You don't want pings before 9am or after 9pm.", meta: "quiet hours · your choice" },
  { text: "You'd rather I ask one question than offer three answers.", meta: "your rule" },
];

const kindLabel: Record<Fact["kind"], string> = {
  core: "Core pattern",
  detail: "Detail",
  preference: "Preference",
  relationship: "Relationship",
};

function TheIndex() {
  const [tab, setTab] = useState<"you" | "knole">("you");
  const [facts, setFacts] = useState<Fact[]>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const togglePin = (id: string) =>
    setFacts((f) => f.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));
  const forget = (id: string) => setFacts((f) => f.filter((x) => x.id !== id));
  const startEdit = (f: Fact) => {
    setEditing(f.id);
    setDraft(f.text);
  };
  const saveEdit = () =>
    setFacts((arr) =>
      arr.map((x) => (x.id === editing ? { ...x, text: draft, meta: "edited by you" } : x))
    );

  const sorted = [...facts].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">The Index</h1>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {facts.length} memories
            </span>
          </div>
          <p className="mt-4 max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
            Everything Knole remembers about you, in your own words. Edit anything. Pin what
            matters. Forget what doesn't.
          </p>

          <div className="mt-8 flex items-center gap-1 rounded-full border border-rule p-1 w-fit">
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

          {tab === "you" && (
            <ul className="mt-10 space-y-3">
              {sorted.map((f) => (
                <li
                  key={f.id}
                  className="group rounded-xl border border-rule bg-card/50 p-5 transition-colors hover:border-ink/15"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {f.pinned && (
                        <svg viewBox="0 0 24 24" className="size-3 text-tan" fill="currentColor">
                          <path d="M12 2l1.7 4.6L18 8l-3.5 2.8.8 4.7L12 13.8l-3.3 1.7.8-4.7L6 8l4.3-1.4z" />
                        </svg>
                      )}
                      <span>{kindLabel[f.kind]}</span>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="text-muted-foreground/70">{f.meta}</span>
                    </div>
                    <div className="flex gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => togglePin(f.id)}
                        className="text-[11px] text-muted-foreground hover:text-tan"
                      >
                        {f.pinned ? "unpin" : "pin"}
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
                          onClick={() => {
                            saveEdit();
                            setEditing(null);
                          }}
                          className="rounded-full bg-ink px-3 py-1.5 text-[11px] text-paper"
                        >
                          save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[15px] leading-relaxed text-ink">{f.text}</p>
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
            Encrypted on your own key. We can't read it, can't reset it, can't take it away.
            <br />
            Export anything, anytime.
          </p>
        </div>
      </section>
    </Shell>
  );
}
