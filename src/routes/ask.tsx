import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { askPresetsFn } from "@/server/fns";
import type { AskPreset } from "@/server/askPresets";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask My Life — Knole" },
      {
        name: "description",
        content: "Search your own past. Knole answers with receipts from your own words.",
      },
    ],
  }),
  component: AskPage,
});

// Category order for the preset library (gnothi): the curated questions are always free;
// free-tier custom questions draw from a small daily allowance.
const CATEGORY_ORDER = ["feelings", "patterns", "people", "decisions", "reframe", "growth"];

type Receipt = { date: string; quote: string; tag: string };
type AskResult = {
  summary: string;
  receipts: Receipt[];
  privacy: { sealed: boolean; anonymised: boolean };
};

function AskPage() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [gated, setGated] = useState<string | null>(null);
  const getPresets = useServerFn(askPresetsFn);
  const [presets, setPresets] = useState<AskPreset[]>([]);
  const [unlimited, setUnlimited] = useState(true);
  useEffect(() => {
    let alive = true;
    getPresets()
      .then((r) => {
        if (!alive) return;
        setPresets(r.presets);
        setUnlimited(r.unlimited);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (text: string, presetId?: string) => {
    if (!text.trim() || loading) return;
    setAsked(text);
    setQ(text);
    setLoading(true);
    setResult(null);
    setGated(null);
    setThinking("Reading your question");
    const fail = () =>
      setResult({
        summary: "Something interrupted the search — try again in a moment.",
        receipts: [],
        privacy: { sealed: false, anonymised: false },
      });
    try {
      const res = await fetch("/ask/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, presetId }),
      });
      if (res.status === 402) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setGated(j?.message ?? "Today's custom questions are used up - presets stay open.");
        setResult(null);
        setAsked(null);
        return;
      }
      if (!res.ok || !res.body) {
        fail();
        return;
      }
      // Framed protocol: \x1e{json}\x1e control frames (status / receipts / privacy) interleaved
      // with plain answer text. Statuses narrate the retrieval live — khoj's train-of-thought —
      // so a multi-second search never looks frozen.
      setResult({ summary: "", receipts: [], privacy: { sealed: false, anonymised: true } });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let answer = "";
      let receipts: Receipt[] = [];
      let live = { sealed: false, anonymised: true };
      const takeFrame = (json: string) => {
        try {
          const j = JSON.parse(json) as {
            status?: string;
            receipts?: Receipt[];
            privacy?: { sealed: boolean; anonymised: boolean };
          };
          if (j.status) setThinking(j.status);
          if (j.receipts) receipts = j.receipts;
          if (j.privacy) live = j.privacy;
        } catch {
          /* malformed frame — skip */
        }
      };
      const drain = (final: boolean) => {
        for (;;) {
          const a = acc.indexOf("\x1e");
          if (a < 0) {
            answer += acc;
            acc = "";
            return;
          }
          const b = acc.indexOf("\x1e", a + 1);
          if (b < 0) {
            answer += acc.slice(0, a);
            if (final) {
              takeFrame(acc.slice(a + 1)); // legacy trailing frame with no closer
              acc = "";
            } else {
              acc = acc.slice(a); // frame still arriving — keep from the marker
            }
            return;
          }
          answer += acc.slice(0, a);
          takeFrame(acc.slice(a + 1, b));
          acc = acc.slice(b + 1);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          drain(true);
          break;
        }
        acc += dec.decode(value, { stream: true });
        drain(false);
        if (answer) setThinking(null); // first answer text retires the status line
        setResult({ summary: answer, receipts, privacy: live });
      }
      setThinking(null);
      setResult({ summary: answer, receipts, privacy: live });
    } catch {
      fail();
    } finally {
      setThinking(null);
      setLoading(false);
    }
  };

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Ask My Life
          </p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Your past, with receipts.
          </h1>
          <p className="mt-4 max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
            Search your own words. Knole will quote you back to yourself — never paraphrase without
            showing where it came from.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(q);
            }}
            className="mt-10 flex items-center gap-2 rounded-2xl border border-rule bg-card px-4 py-3 focus-within:ring-2 focus-within:ring-tan/30"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask anything you've ever said to yourself…"
              className="flex-1 bg-transparent font-display text-[19px] italic text-ink placeholder:text-muted-foreground/60 focus:outline-none"
            />
            {q && (
              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
              >
                {loading ? "…" : "Ask"}
              </button>
            )}
          </form>

          {gated && (
            <div className="animate-fade-up mt-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-5">
              <p className="text-[13px] leading-relaxed text-ink-soft">{gated}</p>
              <Link
                to="/upgrade"
                className="mt-2 inline-block text-[13px] text-tan underline-offset-2 hover:text-ink hover:underline"
              >
                see Deep →
              </Link>
            </div>
          )}

          {!asked && presets.length > 0 && (
            <div className="mt-8 space-y-4">
              {CATEGORY_ORDER.filter((c) => presets.some((p) => p.category === c)).map((cat) => (
                <div key={cat}>
                  <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    {cat}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {presets
                      .filter((p) => p.category === cat)
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => submit(p.label, p.id)}
                          className="rounded-full border border-rule px-3.5 py-1.5 text-[12px] italic text-muted-foreground hover:border-ink/20 hover:text-ink"
                        >
                          {p.label}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
              {!unlimited && (
                <p className="text-[11px] text-muted-foreground/80">
                  Presets are always free · custom questions: three a day on the free plan.
                </p>
              )}
            </div>
          )}

          {asked && loading && !result?.summary && (
            <div className="animate-fade-up mt-12">
              {/* Train of thought — the retrieval narrates itself while it runs. */}
              <div className="flex items-center gap-2.5">
                <span className="size-2 shrink-0 animate-breathe rounded-full bg-tan/70" />
                <p
                  key={thinking ?? "start"}
                  className="animate-fade-up font-display text-[20px] italic text-muted-foreground"
                >
                  {thinking ?? "Reading back through your own words"}…
                </p>
              </div>
            </div>
          )}

          {asked && result && result.summary && (
            <div className="animate-fade-up mt-12">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                The throughline
              </div>
              <p className="whitespace-pre-line font-display text-[22px] italic leading-snug text-ink-soft">
                {result.summary}
                {loading && (
                  <span className="ml-0.5 inline-block h-5 w-px translate-y-1 animate-breathe bg-tan align-middle" />
                )}
              </p>

              {!loading && result.receipts.length > 0 && (
                <div className="mt-10">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-rule" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      receipts · your own words
                    </span>
                    <div className="h-px flex-1 bg-rule" />
                  </div>

                  <ul className="space-y-4">
                    {result.receipts.map((r, i) => (
                      <li key={i} className="rounded-xl border border-rule bg-card/50 p-5">
                        <div className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          <span>{r.date}</span>
                          <span>{r.tag}</span>
                        </div>
                        <p className="font-display text-[17px] italic leading-snug text-ink-soft">
                          "{r.quote}"
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!loading && (result.privacy.sealed || result.privacy.anonymised) && (
                <div className="mt-10 flex items-start gap-2 border-t border-rule pt-5 text-[11px] leading-relaxed text-muted-foreground">
                  <svg
                    viewBox="0 0 24 24"
                    className="mt-px size-3.5 shrink-0 text-tan"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
                  </svg>
                  <span>
                    {result.privacy.sealed
                      ? "Composed inside a sealed enclave (TEE) — only your key can read this."
                      : "Anonymised before the AI saw it — names and places were masked, and the answer is grounded only in your own words."}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
