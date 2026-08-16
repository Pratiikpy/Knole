import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { passportFn, passportBundleFn } from "@/server/fns";
import type { PassportView } from "@/server/passport";

// The Memory Passport (B5): what the self-model contains, EXACTLY what a granted agent would see
// per scope, the on-chain version line, and the portable bundle download. Every platform owns its
// AI's memory of you; this page is the argument that Knole's is owned by you — shown, not claimed.

const TYPE_LABEL: Record<string, string> = {
  fact: "facts",
  pattern: "patterns",
  commitment: "commitments",
  relationship: "relationships",
  preference: "preferences",
  value: "values",
  emotion: "feelings",
};

const EXPLORER = "https://chainscan.0g.ai";

export function PassportCard() {
  const load = useServerFn(passportFn);
  const loadBundle = useServerFn(passportBundleFn);
  const [view, setView] = useState<PassportView | null>(null);
  const [scope, setScope] = useState<"summary" | "full">("summary");
  const [exporting, setExporting] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load()
      .then((v) => alive && setView(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const bundle = await loadBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      // Safari and Firefox need the anchor in the document, and the object URL must outlive the
      // click - revoking on the next line killed the download before the fetch for it started.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "knole-passport.json";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDlError(null);
    } catch {
      setDlError("Export didn't start — try again in a moment.");
    } finally {
      setExporting(false);
    }
  };

  if (!view) return null;
  const preview = scope === "summary" ? view.agentPreview.summary : view.agentPreview.full;

  return (
    <div className="mt-10">
      <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-tan">Memory Passport</div>

      {/* what the self-model contains */}
      <div className="rounded-2xl border border-rule bg-card/50 p-5">
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Your self-model holds{" "}
          <span className="font-medium text-ink">{view.stats.memories} memories</span> drawn from{" "}
          <span className="font-medium text-ink">{view.stats.daysWritten} days</span> of writing
          {view.stats.entities.length > 0 && (
            <>
              {" "}
              — the people and places it knows best:{" "}
              {view.stats.entities.map((e) => e.name).join(", ")}
            </>
          )}
          .
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(view.stats.byType).map(([t, n]) => (
            <span key={t} className="rounded-full bg-tan/[0.1] px-2.5 py-1 text-[11px] text-tan">
              {n} {TYPE_LABEL[t] ?? t}
            </span>
          ))}
        </div>
        {view.versions && (
          <p className="mt-3 border-t border-rule pt-3 text-[12px] text-muted-foreground">
            On-chain: iNFT #{view.versions.tokenId} · v{view.versions.version} ·{" "}
            {view.versions.network}
            {view.versions.contract && (
              <>
                {" · "}
                <a
                  href={`${EXPLORER}/address/${view.versions.contract}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-tan hover:text-ink"
                >
                  contract ↗
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {/* what a granted agent would see — verbatim */}
      <div className="mt-4 rounded-2xl border border-rule bg-card/50 p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            What a granted agent would see
          </div>
          <div className="flex gap-1.5">
            {(["summary", "full"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                  scope === s
                    ? "bg-ink text-paper"
                    : "border border-rule text-muted-foreground hover:text-ink"
                }`}
              >
                {s} scope
              </button>
            ))}
          </div>
        </div>
        <pre className="max-h-64 overflow-auto rounded-xl border border-rule bg-paper/70 p-4 font-mono text-[11px] leading-relaxed text-ink-soft">
          {JSON.stringify(preview, null, 2)}
        </pre>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          This is the exact payload a grant serves — durable traits only, never an entry. Summary
          scope stops at values and patterns.
        </p>
      </div>

      {/* the portable bundle */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-rule bg-card/50 p-5">
        <div>
          <div className="text-[14px] text-ink">Take it with you</div>
          <p className="mt-0.5 max-w-[38ch] text-[12px] leading-relaxed text-muted-foreground">
            A structured bundle of your self-model, stamped with its on-chain provenance — readable
            by any agent you trust.
          </p>
        </div>
        <button
          onClick={() => void download()}
          disabled={exporting}
          className="shrink-0 rounded-full bg-ink px-4 py-2 text-[12px] text-paper transition-opacity disabled:opacity-50"
        >
          {exporting ? "Packing…" : "Export passport"}
        </button>
      </div>
      {dlError && <p className="mt-3 text-[12px] text-ink-soft">{dlError}</p>}
    </div>
  );
}
