import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { selfPortraitFn } from "@/server/fns";
import { wordDiff } from "@/lib/editMatch";

// The Overnight Self-Portrait — the model's own evolving read of who this person is, rewritten
// nightly relative to its previous version. The card shows the living text; "what changed
// overnight" reveals the word-diff against the version it replaced. This is the one surface
// where the memory engine stops being an index and becomes a document you can watch evolve.

type Portrait = { text: string; createdAt: string; previous: string | null };

export function SelfPortraitCard() {
  const load = useServerFn(selfPortraitFn);
  const [p, setP] = useState<Portrait | null | undefined>(undefined);
  const [showDiff, setShowDiff] = useState(false);
  useEffect(() => {
    load()
      .then((r) => setP(r.portrait))
      .catch(() => setP(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (p === undefined) return null; // loading — the page doesn't jump
  if (p === null) {
    return (
      <div className="rounded-2xl border border-rule bg-card/50 p-6">
        <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">Self-portrait</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          After a few days of writing, Knole starts keeping a short portrait of who you're becoming
          — rewritten each night, with the changes shown to you. It hasn't formed yet.
        </p>
      </div>
    );
  }

  const when = new Date(p.createdAt);
  const fresh = Date.now() - when.getTime() < 36 * 3600_000;

  return (
    <div className="rounded-2xl border border-tan/30 bg-tan/[0.04] p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-tan">Self-portrait</p>
        <span className="text-[11px] text-muted-foreground">
          rewritten {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>

      {!showDiff && (
        <p className="whitespace-pre-line font-display text-[17px] italic leading-relaxed text-ink-soft">
          {p.text}
        </p>
      )}

      {showDiff && p.previous && (
        <p className="whitespace-pre-line text-[15px] leading-relaxed">
          {wordDiff(p.previous, p.text).map((part, i) =>
            part.kind === "same" ? (
              <span key={i} className="text-ink-soft">
                {part.text}
              </span>
            ) : part.kind === "del" ? (
              <del key={i} className="mr-1 rounded-sm bg-rose-500/10 px-0.5 text-ink-soft/50">
                {part.text}
              </del>
            ) : (
              <ins key={i} className="rounded-sm bg-tan/[0.18] px-0.5 text-ink no-underline">
                {part.text}
              </ins>
            ),
          )}
        </p>
      )}

      <div className="mt-4 flex items-center gap-4">
        {p.previous && (
          <button
            onClick={() => setShowDiff((v) => !v)}
            className="text-[12px] text-tan underline-offset-2 hover:underline"
          >
            {showDiff
              ? "read it clean"
              : fresh
                ? "what changed overnight"
                : "what changed last time"}
          </button>
        )}
        <span className="text-[11px] text-muted-foreground/70">
          Knole's own read — your entries are the only source, and your bio always outranks it.
        </span>
      </div>
    </div>
  );
}
